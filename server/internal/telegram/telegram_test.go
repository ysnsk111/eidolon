package telegram_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

func TestTelegram_StartPairingFollowedByMessage123(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "tg_test_start123_*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempDir)

	dbPath := filepath.Join(tempDir, "test.db")
	configPath := filepath.Join(tempDir, "config.json")
	initialConfig := []byte(`{"bot":{"allowedUsers":[]}}`)
	if err := os.WriteFile(configPath, initialConfig, 0600); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	deletedMessages := []map[string]interface{}{}
	sentMessages := []map[string]interface{}{}
	pollCount := 0

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()

		switch r.URL.Path {
		case "/botMOCK_TOKEN/getUpdates":
			pollCount++
			if pollCount == 1 {
				// Deliver BOTH /start and 123 in the same batch from un-allowed user 8287471787
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
						{
							"update_id": 1002,
							"message": map[string]interface{}{
								"message_id": 43,
								"from": map[string]interface{}{
									"id":         8287471787,
									"first_name": "TestUser",
									"username":   "test_user",
								},
								"chat": map[string]interface{}{
									"id": 8287471787,
								},
								"date": int(time.Now().Unix()),
								"text": "123",
							},
						},
					},
				})
			} else {
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
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 500, MinDelayMs: 500})
	orch := runtime.NewOrchestrator(store, personaMgr, memEng, sched, runtime.LLMConfig{})

	cfg := telegram.Config{
		Token:          "MOCK_TOKEN",
		AllowedUsers:   []string{}, // Initially empty!
		PollTimeout:    1,
		SimulateTyping: false,
		ConfigPath:     configPath,
	}

	bot := telegram.NewBotService(cfg, orch, store)
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
	// Wait for poll and dispatch of both messages (latency + processing)
	time.Sleep(1200 * time.Millisecond)
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

	// 2. Verify /start produced zero text, but 123 got a real response!
	if len(sentMessages) != 1 {
		t.Fatalf("Expected exactly 1 message sent in response to 123 (with zero extra for /start), got %d: %v", len(sentMessages), sentMessages)
	}

	// 3. Verify user was paired in config
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

func TestTelegram_DistillationProgressAndAllClear(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to init storage: %v", err)
	}

	configPath := filepath.Join(tempDir, "config.json")
	initialConfig := []byte(`{"bot":{"allowedUsers":["8287471787"]}}`)
	if err := os.WriteFile(configPath, initialConfig, 0600); err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	var mu sync.Mutex
	var deletedMessageIDs []int
	var sentMessages []map[string]interface{}
	nextMsgID := 100
	pollCount := 0
	var deliverDistillMessage bool

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		defer mu.Unlock()

		switch r.URL.Path {
		case "/botMOCK_TOKEN/getUpdates":
			pollCount++
			if pollCount == 1 {
				// Poll 1: user sends /start (message 50)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"ok": true,
					"result": []map[string]interface{}{
						{
							"update_id": 2001,
							"message": map[string]interface{}{
								"message_id": 50,
								"from": map[string]interface{}{
									"id":         8287471787,
									"first_name": "TestUser",
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
			} else if deliverDistillMessage {
				// Message arrives precisely while distillation is in progress!
				deliverDistillMessage = false
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"ok": true,
					"result": []map[string]interface{}{
						{
							"update_id": 2002,
							"message": map[string]interface{}{
								"message_id": 51,
								"from": map[string]interface{}{
									"id":         8287471787,
									"first_name": "TestUser",
								},
								"chat": map[string]interface{}{
									"id": 8287471787,
								},
								"date": int(time.Now().Unix()),
								"text": "测试蒸馏中发消息",
							},
						},
					},
				})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"ok":     true,
					"result": []map[string]interface{}{},
				})
			}

		case "/botMOCK_TOKEN/deleteMessage":
			body, _ := io.ReadAll(r.Body)
			var req map[string]interface{}
			_ = json.Unmarshal(body, &req)
			if mid, ok := req["message_id"].(float64); ok {
				deletedMessageIDs = append(deletedMessageIDs, int(mid))
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":     true,
				"result": true,
			})

		case "/botMOCK_TOKEN/sendMessage":
			body, _ := io.ReadAll(r.Body)
			var req map[string]interface{}
			_ = json.Unmarshal(body, &req)
			nextMsgID++
			req["sent_id"] = nextMsgID
			sentMessages = append(sentMessages, req)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok": true,
				"result": map[string]interface{}{
					"message_id": nextMsgID,
				},
			})

		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer mockServer.Close()

	personaMgr := persona.NewPersonaManager(tempDir)
	memEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 500})
	orch := runtime.NewOrchestrator(store, personaMgr, memEng, sched, runtime.LLMConfig{})

	cfg := telegram.Config{
		Token:        "MOCK_TOKEN",
		AllowedUsers: []string{"8287471787"},
		PollTimeout:  1,
		ConfigPath:   configPath,
	}

	bot := telegram.NewBotService(cfg, orch, store)
	testClient := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			targetURL := mockServer.URL + req.URL.Path
			newReq, _ := http.NewRequest(req.Method, targetURL, req.Body)
			newReq.Header = req.Header
			return http.DefaultClient.Do(newReq)
		}),
	}
	bot.SetHTTPClient(testClient)

	_ = bot.Start()
	// Wait for /start to be processed
	time.Sleep(250 * time.Millisecond)

	// Check Pairing Status
	pairingStatus := bot.GetPairingStatus()
	if !pairingStatus["paired"].(bool) {
		t.Fatalf("Expected bot to be paired after /start, got %v", pairingStatus)
	}

	// 1. Trigger Distillation Start
	bot.StartDistillation(8287471787)

	// Tell mockServer to deliver message 51 during distillation
	mu.Lock()
	deliverDistillMessage = true
	mu.Unlock()

	// 2. Report Progress
	bot.ReportDistillationProgress(1, 8, "Ingestion & Normalization")
	bot.ReportDistillationProgress(2, 8, "Chunking & Segmentation")

	// Wait for message 51 to be polled and processed during distillation
	time.Sleep(350 * time.Millisecond)

	mu.Lock()
	foundPleaseWait := false
	for _, m := range sentMessages {
		if text, ok := m["text"].(string); ok && (strings.Contains(text, "Please wait") || strings.Contains(text, "请稍候")) {
			foundPleaseWait = true
			break
		}
	}
	mu.Unlock()

	if !foundPleaseWait {
		t.Errorf("Expected bot to reply 'please wait' when message received during distillation")
	}

	// 3. Complete Distillation (All-Clear)
	bot.FinishDistillation("ms_yawen", 0.85)

	time.Sleep(200 * time.Millisecond)
	bot.Stop()

	mu.Lock()
	defer mu.Unlock()

	// 4. Verify ALL-CLEAR: progress messages and please-wait messages were all deleted!
	if len(deletedMessageIDs) < 3 {
		t.Errorf("Expected at least 3 deleted messages (start, progress, please wait, incoming), got %d: %v", len(deletedMessageIDs), deletedMessageIDs)
	}

	// 5. Verify distilled persona opening greeting was sent!
	lastSent := sentMessages[len(sentMessages)-1]
	if text, ok := lastSent["text"].(string); !ok || !strings.Contains(text, "我在呢") {
		t.Errorf("Expected final message to be persona greeting, got: %v", lastSent)
	}
}

func TestTelegram_CommandDuringDistillation_InterceptedAndAllClear(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to init storage: %v", err)
	}

	configPath := filepath.Join(tempDir, "config.json")
	initialConfig := []byte(`{"bot":{"allowedUsers":["8287471787"]}}`)
	if err := os.WriteFile(configPath, initialConfig, 0600); err != nil {
		t.Fatalf("Failed to write test config: %v", err)
	}

	var mu sync.Mutex
	var deletedMessageIDs []int
	var sentMessages []map[string]interface{}
	nextMsgID := 300
	pollCount := 0

	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		defer mu.Unlock()

		switch r.URL.Path {
		case "/botMOCK_TOKEN/getUpdates":
			pollCount++
			if pollCount == 1 {
				// Deliver /start command while distillation is already marked active
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"ok": true,
					"result": []map[string]interface{}{
						{
							"update_id": 3001,
							"message": map[string]interface{}{
								"message_id": 77,
								"from": map[string]interface{}{
									"id":         8287471787,
									"first_name": "TestUser",
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
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"ok":     true,
					"result": []map[string]interface{}{},
				})
			}

		case "/botMOCK_TOKEN/deleteMessage":
			body, _ := io.ReadAll(r.Body)
			var req map[string]interface{}
			_ = json.Unmarshal(body, &req)
			if mid, ok := req["message_id"].(float64); ok {
				deletedMessageIDs = append(deletedMessageIDs, int(mid))
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":     true,
				"result": true,
			})

		case "/botMOCK_TOKEN/sendMessage":
			body, _ := io.ReadAll(r.Body)
			var req map[string]interface{}
			_ = json.Unmarshal(body, &req)
			nextMsgID++
			req["sent_id"] = nextMsgID
			sentMessages = append(sentMessages, req)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok": true,
				"result": map[string]interface{}{
					"message_id": nextMsgID,
				},
			})

		default:
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer mockServer.Close()

	personaMgr := persona.NewPersonaManager(tempDir)
	memEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 500})
	orch := runtime.NewOrchestrator(store, personaMgr, memEng, sched, runtime.LLMConfig{})

	cfg := telegram.Config{
		Token:        "MOCK_TOKEN",
		AllowedUsers: []string{"8287471787"},
		PollTimeout:  1,
		ConfigPath:   configPath,
	}

	bot := telegram.NewBotService(cfg, orch, store)
	testClient := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			targetURL := mockServer.URL + req.URL.Path
			newReq, _ := http.NewRequest(req.Method, targetURL, req.Body)
			newReq.Header = req.Header
			return http.DefaultClient.Do(newReq)
		}),
	}
	bot.SetHTTPClient(testClient)

	// Mark distillation active BEFORE starting poll loop
	bot.StartDistillation(8287471787)

	_ = bot.Start()
	time.Sleep(300 * time.Millisecond)

	mu.Lock()
	foundPleaseWait := false
	for _, m := range sentMessages {
		if text, ok := m["text"].(string); ok && (strings.Contains(text, "Please wait") || strings.Contains(text, "请稍候")) {
			foundPleaseWait = true
			break
		}
	}
	mu.Unlock()

	if !foundPleaseWait {
		t.Errorf("Expected command /start during distillation to receive 'please wait' reply")
	}

	// Finish distillation
	bot.FinishDistillation("persona_123", 0.88)
	time.Sleep(200 * time.Millisecond)
	bot.Stop()

	mu.Lock()
	defer mu.Unlock()

	// Verify command message ID 77 is among the deleted messages in all-clear
	foundDelCommand := false
	for _, id := range deletedMessageIDs {
		if id == 77 {
			foundDelCommand = true
			break
		}
	}
	if !foundDelCommand {
		t.Errorf("Expected command message ID 77 to be deleted in all-clear sweep, deleted list: %v", deletedMessageIDs)
	}
}

type roundTripperFunc func(req *http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
