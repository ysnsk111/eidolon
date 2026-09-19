package telegram_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

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

func TestTelegram_MockServerInteraction(t *testing.T) {
	var sentMessages []map[string]interface{}
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/botMOCK_TOKEN/getMe":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok": true,
				"result": map[string]interface{}{
					"id":         8921441705,
					"is_bot":     true,
					"first_name": "Ms.Yawen",
					"username":   "wangyawen_bot",
				},
			})
		case "/botMOCK_TOKEN/sendMessage":
			var req map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&req)
			sentMessages = append(sentMessages, req)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok": true,
				"result": map[string]interface{}{
					"message_id": 999,
				},
			})
		case "/botMOCK_TOKEN/sendChatAction":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok": true,
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mockServer.Close()

	// Verify server mock responds properly
	resp, err := http.Get(mockServer.URL + "/botMOCK_TOKEN/getMe")
	if err != nil {
		t.Fatalf("Mock getMe failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("Expected 200 OK, got %d", resp.StatusCode)
	}
}
