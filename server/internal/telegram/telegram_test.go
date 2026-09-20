package telegram_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/runtime"
	"eidolon/server/internal/scheduler"
	"eidolon/server/internal/storage"
	"eidolon/server/internal/telegram"
)

func TestTelegram_PolicyAndAllowlist(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to init storage: %v", err)
	}

	personaMgr := persona.NewPersonaManager(tempDir)
	memEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 1000})
	orch := runtime.NewOrchestrator(store, personaMgr, memEng, sched, runtime.LLMConfig{})

	cfg := telegram.Config{
		Token:          "mock_token",
		AllowedUsers:   []string{"8287471787", "10001"},
		PollTimeout:    1,
		SimulateTyping: true,
		LogSalt:        "test_salt",
	}

	bot := telegram.NewBotService(cfg, orch, store)
	if bot == nil {
		t.Fatal("Failed to create BotService")
	}
}

func TestTelegram_StartPairingAndDeletion(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to init storage: %v", err)
	}

	configPath := filepath.Join(tempDir, "config.json")
	initialConfig := []byte(`{"bot":{"allowedUsers":[]}}`)
	if err := os.WriteFile(configPath, initialConfig, 0600); err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	var mu sync.Mutex
	var deletedMessages []map[string]interface{}
	var sentMessages []map[string]interface{}
	pollCount := 0

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		defer mu.Unlock()

		switch r.URL.Path {
		case "/botMOCK_TOKEN/getUpdates":
			pollCount++
			if pollCount == 1 {
				// Deliver /start from un-allowed user 8287471787
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"ok": true,
					"result": []map[string]interface{}{
						{
							"update_id": 1001,
							"message": map[string]interface{}{
								"message_id": 42,
								"from": map[string]interface{}{
									"id":         8287471787,
									"first_name": "TestUser",
									"username":   "test_user",
								},
								"chat": map[string]interface{}{
									"id": 8287471787,
								},
								"date": int(time.Now().Unix()),
								"text": "/start",
							},
						},
					},
				})
			} else {
				// Empty update to allow shutdown
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"ok":     true,
					"result": []map[string]interface{}{},
				})
			}

		case "/botMOCK_TOKEN/deleteMessage":
			body, _ := io.ReadAll(r.Body)
			var req map[string]interface{}
			_ = json.Unmarshal(body, &req)
			deletedMessages = append(deletedMessages, req)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":     true,
				"result": true,
			})

		case "/botMOCK_TOKEN/sendMessage":
			body, _ := io.ReadAll(r.Body)
			var req map[string]interface{}
			_ = json.Unmarshal(body, &req)
			sentMessages = append(sentMessages, req)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok": true,
				"result": map[string]interface{}{
					"message_id": 999,
				},
			})

		case "/botMOCK_TOKEN/sendChatAction":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	personaMgr := persona.NewPersonaManager(tempDir)
	memEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 1000})
	orch := runtime.NewOrchestrator(store, personaMgr, memEng, sched, runtime.LLMConfig{})

	// Inject custom HTTP client URL redirect in test via mock
	cfg := telegram.Config{
		Token:          "MOCK_TOKEN",
		AllowedUsers:   []string{}, // Initially empty!
		PollTimeout:    1,
		SimulateTyping: false,
		ConfigPath:     configPath,
	}

	bot := telegram.NewBotService(cfg, orch, store)
	// Inject transport pointing to mockServer
	testClient := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			targetURL := mockServer.URL + req.URL.Path
			if req.URL.RawQuery != "" {
				targetURL += "?" + req.URL.RawQuery
			}
			newReq, _ := http.NewRequest(req.Method, targetURL, req.Body)
			newReq.Header = req.Header
			return http.DefaultClient.Do(newReq)
		}),
	}
	bot.SetHTTPClient(testClient)

	_ = bot.Start()
	// Wait for poll and dispatch
	time.Sleep(300 * time.Millisecond)
	bot.Stop()

	mu.Lock()
	defer mu.Unlock()

	// 1. Verify /start message 42 was deleted
	if len(deletedMessages) == 0 {
		t.Fatalf("Expected deleteMessage to be called for /start")
	}
	delMsgID := int(deletedMessages[0]["message_id"].(float64))
	if delMsgID != 42 {
		t.Errorf("Expected message_id 42 to be deleted, got %d", delMsgID)
	}

	// 2. Verify "无其他多余": no extra greeting text sent
	if len(sentMessages) > 0 {
		t.Errorf("Expected NO messages to be sent on /start ('无其他多余'), but sent %d messages: %v", len(sentMessages), sentMessages)
	}

	// 3. Verify user was paired into config
	cfgBytes, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("Failed to read config file: %v", err)
	}
	var parsedConfig struct {
		Bot struct {
			AllowedUsers []string `json:"allowedUsers"`
		} `json:"bot"`
	}
	_ = json.Unmarshal(cfgBytes, &parsedConfig)
	found := false
	for _, u := range parsedConfig.Bot.AllowedUsers {
		if u == "8287471787" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Expected user 8287471787 to be persisted in config, got %v", parsedConfig.Bot.AllowedUsers)
	}
}

type roundTripperFunc func(req *http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
