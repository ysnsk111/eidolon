package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/runtime"
	"eidolon/server/internal/storage"
)

type Server struct {
	addr       string
	webDir     string
	store      *storage.Storage
	personaMgr *persona.PersonaManager
	memoryEng  *memory.Engine
	orch       *runtime.Orchestrator
	httpServer *http.Server
}

func NewServer(
	host string,
	port int,
	webDir string,
	store *storage.Storage,
	personaMgr *persona.PersonaManager,
	memoryEng *memory.Engine,
	orch *runtime.Orchestrator,
) *Server {
	addr := fmt.Sprintf("%s:%d", host, port)
	s := &Server{
		addr:       addr,
		webDir:     webDir,
		store:      store,
		personaMgr: personaMgr,
		memoryEng:  memoryEng,
		orch:       orch,
	}

	mux := http.NewServeMux()

	// API Routes
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/persona", s.handlePersona)
	mux.HandleFunc("/api/memory", s.handleMemory)
	mux.HandleFunc("/api/evaluation", s.handleEvaluation)
	mux.HandleFunc("/api/logs", s.handleLogs)
	mux.HandleFunc("/api/chat", s.handleChat)

	// Static Web Dashboard Files
	fileServer := http.FileServer(http.Dir(webDir))
	mux.Handle("/", fileServer)

	s.httpServer = &http.Server{
		Addr:    addr,
		Handler: corsMiddleware(mux),
	}

	return s
}

func (s *Server) Start() error {
	s.store.Log("server", "INFO", fmt.Sprintf("EIDOLON HTTP Server listening on %s", s.addr))
	return s.httpServer.ListenAndServe()
}

func (s *Server) Stop() error {
	return s.httpServer.Close()
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"status":    "healthy",
		"timestamp": fmt.Sprint(r.Context()),
		"version":   "1.0.0",
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	stats := s.store.GetStats()
	activeP := s.personaMgr.GetActivePersona()

	personaName := "None"
	dsiScore := 0.0
	if activeP != nil {
		personaName = activeP.Persona.Name
		if dsi, ok := activeP.Manifest["dsi_score"].(float64); ok {
			dsiScore = dsi
		}
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"runtime_status":   "RUNNING",
		"active_persona":   personaName,
		"dsi_score":        dsiScore,
		"total_memories":   stats.TotalMemories,
		"total_sessions":   stats.TotalSessions,
		"total_messages":   stats.TotalMessages,
		"l0_count":         stats.L0Count,
		"l1_count":         stats.L1Count,
		"l2_count":         stats.L2Count,
		"l3_count":         stats.L3Count,
	})
}

func (s *Server) handlePersona(w http.ResponseWriter, r *http.Request) {
	activeP := s.personaMgr.GetActivePersona()
	if activeP == nil {
		jsonResponse(w, http.StatusOK, map[string]interface{}{"active": false, "message": "No active persona"})
		return
	}
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"active":     true,
		"id":         activeP.ID,
		"persona":    activeP.Persona,
		"manifest":   activeP.Manifest,
		"style":      activeP.Style,
		"behavior":   activeP.Behavior,
		"world":      activeP.World,
		"memory_seed": activeP.MemorySeed,
	})
}

func (s *Server) handleMemory(w http.ResponseWriter, r *http.Request) {
	layer := r.URL.Query().Get("layer")
	activeP := s.personaMgr.GetActivePersona()
	personaID := ""
	if activeP != nil {
		personaID = activeP.ID
	}

	memories := s.store.QueryMemories(personaID, layer)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"count":    len(memories),
		"memories": memories,
	})
}

func (s *Server) handleEvaluation(w http.ResponseWriter, r *http.Request) {
	activeP := s.personaMgr.GetActivePersona()
	if activeP == nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"error": "No active persona"})
		return
	}

	reportPath := filepath.Join(activeP.PackagePath, "evaluation", "report.json")
	if data, err := os.ReadFile(reportPath); err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
		return
	}

	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"dsi":    activeP.Manifest["dsi_score"],
		"status": activeP.Manifest["evaluation_status"],
	})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	logs := s.store.GetLogs(100)
	jsonResponse(w, http.StatusOK, map[string]interface{}{
		"logs": logs,
	})
}

func (s *Server) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Message   string `json:"message"`
		SessionID string `json:"session_id"`
		UserID    string `json:"user_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Message) == "" {
		jsonResponse(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	if body.SessionID == "" {
		body.SessionID = "web_session_default"
	}
	if body.UserID == "" {
		body.UserID = "web_user"
	}

	res, err := s.orch.ProcessMessage(body.SessionID, body.UserID, body.Message)
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	jsonResponse(w, http.StatusOK, res)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func jsonResponse(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
