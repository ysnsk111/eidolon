package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"eidolon/server/internal/api"
	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/runtime"
	"eidolon/server/internal/scheduler"
	"eidolon/server/internal/storage"
	"eidolon/server/internal/telegram"
)

type Config struct {
	ActivePersona string `json:"activePersona"`
	LLM           struct {
		BaseURL     string  `json:"baseUrl"`
		APIKey      string  `json:"apiKey"`
		Model       string  `json:"model"`
		Temperature float64 `json:"temperature"`
		TimeoutMs   int     `json:"timeoutMs"`
	} `json:"llm"`
	Bot struct {
		TelegramToken  string   `json:"telegramToken"`
		AllowedUsers   []string `json:"allowedUsers"`
		PollTimeout    int      `json:"pollTimeout"`
		SimulateTyping bool     `json:"enableTypingSimulation"`
	} `json:"bot"`
	Server struct {
		Host    string `json:"host"`
		Port    int    `json:"port"`
		DBPath  string `json:"dbPath"`
		LogPath string `json:"logPath"`
	} `json:"server"`
	Storage struct {
		CompletedResultDir string `json:"completedResultDir"`
	} `json:"storage"`
}

func main() {
	fmt.Print(`
  ███████╗██╗██████╗  ██████╗ ██╗      ██████╗ ███╗   ██╗
  ██╔════╝██║██╔══██╗██╔═══██╗██║     ██╔═══██╗████╗  ██║
  █████╗  ██║██║  ██║██║   ██║██║     ██║   ██║██╔██╗ ██║
  ██╔══╝  ██║██║  ██║██║   ██║██║     ██║   ██║██║╚██╗██║
  ███████╗██║██████╔╝╚██████╔╝███████╗╚██████╔╝██║ ╚████║
  ╚══════╝╚═╝╚═════╝  ╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝
  Persona Distillation & Memory Runtime v1.0.0
  «Preserve expression. Reconstruct context. Measure fidelity.»
`)

	configPath := os.Getenv("EIDOLON_CONFIG")
	if configPath == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Fatalf("Failed to get home dir: %v", err)
		}
		configPath = filepath.Join(homeDir, ".config", "eidolon", "config.json")
	}

	configData, err := os.ReadFile(configPath)
	if err != nil {
		log.Fatalf("Failed to read config from %s: %v", configPath, err)
	}

	var cfg Config
	if err := json.Unmarshal(configData, &cfg); err != nil {
		log.Fatalf("Failed to parse config: %v", err)
	}

	// Fallback completed result directory
	if cfg.Storage.CompletedResultDir == "" {
		cwd, _ := os.Getwd()
		cfg.Storage.CompletedResultDir = filepath.Join(cwd, "completed_result")
	}

	// 1. Initialize Storage
	store, err := storage.NewStorage(cfg.Server.DBPath)
	if err != nil {
		log.Fatalf("Storage init error: %v", err)
	}
	store.Log("system", "INFO", "EIDOLON persistent storage initialized")

	// 2. Initialize Persona Manager
	personaMgr := persona.NewPersonaManager(cfg.Storage.CompletedResultDir)
	if cfg.ActivePersona != "" {
		if _, err := personaMgr.LoadPersona(cfg.ActivePersona); err != nil {
			store.Log("persona", "WARN", fmt.Sprintf("Failed to load active persona %s: %v", cfg.ActivePersona, err))
		} else {
			store.Log("persona", "INFO", fmt.Sprintf("Active persona loaded: %s", cfg.ActivePersona))
		}
	}

	// 3. Initialize Memory Engine
	memoryEng := memory.NewEngine(store)

	// 4. Initialize Scheduler
	sched := scheduler.NewScheduler(scheduler.Config{
		BaseDelayMs:       2500,
		DoubleMessageProb: 0.08,
	})

	// 5. Initialize Runtime Orchestrator
	orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{
		BaseURL:     cfg.LLM.BaseURL,
		APIKey:      cfg.LLM.APIKey,
		Model:       cfg.LLM.Model,
		Temperature: cfg.LLM.Temperature,
		TimeoutMs:   cfg.LLM.TimeoutMs,
	})

	// 6. Start Telegram Bot Service if token provided
	botService := telegram.NewBotService(telegram.Config{
		Token:          cfg.Bot.TelegramToken,
		AllowedUsers:   cfg.Bot.AllowedUsers,
		PollTimeout:    cfg.Bot.PollTimeout,
		SimulateTyping: cfg.Bot.SimulateTyping,
	}, orch, store)

	if err := botService.Start(); err != nil {
		store.Log("telegram", "ERROR", fmt.Sprintf("Bot start error: %v", err))
	}

	// 7. Locate Web Dashboard Assets
	webDir := os.Getenv("EIDOLON_WEB_DIR")
	if webDir == "" {
		cwd, _ := os.Getwd()
		webDir = filepath.Join(cwd, "server", "web")
		if _, err := os.Stat(webDir); os.IsNotExist(err) {
			webDir = filepath.Join(cwd, "web")
		}
	}

	// 8. Start HTTP API & Web Dashboard Server
	apiServer := api.NewServer(
		cfg.Server.Host,
		cfg.Server.Port,
		webDir,
		store,
		personaMgr,
		memoryEng,
		orch,
	)

	go func() {
		if err := apiServer.Start(); err != nil {
			store.Log("server", "INFO", fmt.Sprintf("HTTP Server stopped: %v", err))
		}
	}()

	fmt.Printf("✔ EIDOLON Runtime Server running on http://%s:%d\n", cfg.Server.Host, cfg.Server.Port)
	fmt.Printf("✔ Active Persona: %s\n", cfg.ActivePersona)
	fmt.Printf("✔ Telegram Allowlist: %v\n", cfg.Bot.AllowedUsers)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh

	fmt.Println("\nShutting down EIDOLON Runtime...")
	botService.Stop()
	_ = apiServer.Stop()
	store.Log("system", "INFO", "EIDOLON shutdown complete")
	fmt.Println("Goodbye.")
}
