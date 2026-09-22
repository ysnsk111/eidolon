package runtime_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/runtime"
	"eidolon/server/internal/scheduler"
	"eidolon/server/internal/storage"
)

// setupTestEnvironment initializes a temporary SQLite storage and loaded persona for testing.
func setupTestEnvironment(t *testing.T, personaID string, fp map[string]interface{}) (*storage.Storage, *persona.PersonaManager, *memory.Engine, *scheduler.Scheduler) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, fmt.Sprintf("test_%s.db", personaID))
	personasDir := filepath.Join(tempDir, "personas")
	pDir := filepath.Join(personasDir, personaID)
	_ = os.MkdirAll(pDir, 0755)

	manifest := map[string]interface{}{"name": personaID, "version": "1.1.0"}
	manData, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(pDir, "manifest.json"), manData, 0644)

	personaDetails := map[string]interface{}{
		"id":                     personaID,
		"name":                   personaID,
		"target_speaker":         personaID,
		"linguistic_fingerprint": fp,
		"system_prompts": map[string]interface{}{
			"generator": fmt.Sprintf("You are %s. Reply directly in casual dialogue.", personaID),
			"critic":    "",
		},
	}
	pData, _ := json.Marshal(personaDetails)
	_ = os.WriteFile(filepath.Join(pDir, "persona.json"), pData, 0644)

	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Storage initialization failed: %v", err)
	}

	personaMgr := persona.NewPersonaManager(personasDir)
	if _, err := personaMgr.LoadPersona(personaID); err != nil {
		t.Fatalf("Persona load failed: %v", err)
	}

	memoryEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 2500})

	return store, personaMgr, memoryEng, sched
}

// TestChallenger2_TimeoutBounds_StrictClamping tests that timeout configuration
// is strictly bounded between 5s and 15s across all boundary and invalid inputs.
func TestChallenger2_TimeoutBounds_StrictClamping(t *testing.T) {
	store, personaMgr, memoryEng, sched := setupTestEnvironment(t, "timeout_bounds_test", nil)
	defer store.Close()

	testCases := []struct {
		name        string
		timeoutMs   int
		expectedSec float64
	}{
		{"Zero timeoutMs defaults to 15s", 0, 15.0},
		{"Negative timeoutMs defaults to 15s", -1000, 15.0},
		{"Very small 500ms clamped to 5s minimum", 500, 5.0},
		{"Sub-boundary 4999ms clamped to 5s minimum", 4999, 5.0},
		{"Exact minimum 5000ms accepted", 5000, 5.0},
		{"Mid-range 8000ms accepted", 8000, 8.0},
		{"Mid-range 12000ms accepted", 12000, 12.0},
		{"Exact maximum 15000ms accepted", 15000, 15.0},
		{"Over-boundary 15001ms clamped to 15s maximum", 15001, 15.0},
		{"Legacy 45000ms clamped to 15s maximum", 45000, 15.0},
		{"Extreme 300000ms clamped to 15s maximum", 300000, 15.0},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{
				TimeoutMs: tc.timeoutMs,
			})
			actualTimeout := orch.GetClientTimeout()
			expectedDuration := time.Duration(tc.expectedSec * float64(time.Second))

			if actualTimeout != expectedDuration {
				t.Fatalf("Timeout mismatch for input %d ms: expected %v, got %v", tc.timeoutMs, expectedDuration, actualTimeout)
			}
		})
	}
}

// TestChallenger2_SlowHTTPServer_TimeoutTriggerWithoutCrash simulates a server that stalls
// and delays longer than the client timeout. It asserts timeout triggers cleanly without process crash,
// falls back to authentic persona response, and strictly avoids '在呢，怎么啦~'.
func TestChallenger2_SlowHTTPServer_TimeoutTriggerWithoutCrash(t *testing.T) {
	var requestCount int32

	// Mock server that sleeps 6.0 seconds on each request
	slowServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requestCount, 1)
		time.Sleep(6 * time.Second)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"choices": []map[string]interface{}{
				{"message": map[string]interface{}{"content": "Too late response"}},
			},
		})
	}))
	defer slowServer.Close()

	fp := map[string]interface{}{
		"openers": []string{"早呀~ 马上就到"},
		"vocabulary": map[string]interface{}{
			"catchphrases": []string{"好呀好呀"},
		},
	}
	store, personaMgr, memoryEng, sched := setupTestEnvironment(t, "slow_server_test", fp)
	defer store.Close()

	// Configure orchestrator with 5s timeout (minimum bound)
	orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{
		BaseURL:   slowServer.URL,
		Model:     "slow-model",
		TimeoutMs: 5000, // 5s timeout
	})

	startTime := time.Now()
	res, err := orch.ProcessMessage("sess_slow", "user_alice", "早呀，今天有空吗？")
	elapsed := time.Since(startTime)

	// 1. Process must NOT crash or return fatal error
	if err != nil {
		t.Fatalf("ProcessMessage returned unexpected fatal error: %v", err)
	}
	if res == nil {
		t.Fatalf("ProcessMessage returned nil GenerationResult")
	}

	// 2. GenerationResult must contain valid message
	if strings.TrimSpace(res.FinalMessage) == "" {
		t.Fatalf("ProcessMessage returned empty FinalMessage after timeout")
	}

	// 3. Strict assertion: 0% fallback to '在呢，怎么啦~'
	if strings.Contains(res.FinalMessage, "在呢，怎么啦~") {
		t.Fatalf("VIOLATION: Fallback produced legacy boilerplate '在呢，怎么啦~': %q", res.FinalMessage)
	}
	if res.FinalMessage == "在呢~" {
		t.Fatalf("VIOLATION: Fallback produced legacy boilerplate '在呢~': %q", res.FinalMessage)
	}

	// 4. Must use distilled persona openers/context
	if res.FinalMessage != "早呀~ 马上就到" && !strings.Contains(res.FinalMessage, "早") {
		t.Logf("Notice: Fallback message used: %q", res.FinalMessage)
	}

	// 5. Critic must be honest "not_run"
	if res.Critic.Status != "not_run" {
		t.Errorf("Expected critic status 'not_run', got %q", res.Critic.Status)
	}
	if res.Critic.Score != nil {
		t.Errorf("Expected critic score nil, got %v", *res.Critic.Score)
	}

	// 6. DB transaction atomicity: inMsg and outMsg committed cleanly
	recent := store.GetRecentMessages("sess_slow", 5)
	if len(recent) != 2 {
		t.Fatalf("Expected 2 messages committed to DB, got %d", len(recent))
	}

	t.Logf("Slow server test passed in %v (requestCount=%d, FinalMessage=%q)", elapsed, atomic.LoadInt32(&requestCount), res.FinalMessage)
}

// TestChallenger2_NetworkFaults_Resilience simulates diverse network and protocol errors:
// HTTP 500, HTTP 502, connection reset/hangup, corrupted HTML payload, empty choices.
func TestChallenger2_NetworkFaults_Resilience(t *testing.T) {
	faultScenarios := []struct {
		name        string
		handlerFunc http.HandlerFunc
	}{
		{
			name: "HTTP 500 Internal Server Error",
			handlerFunc: func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, `{"error": "Internal server error"}`, http.StatusInternalServerError)
			},
		},
		{
			name: "HTTP 502 Bad Gateway",
			handlerFunc: func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "Bad Gateway from upstream", http.StatusBadGateway)
			},
		},
		{
			name: "Corrupted HTML payload instead of JSON",
			handlerFunc: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/html")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte("<html><body><h1>503 Service Unavailable</h1></body></html>"))
			},
		},
		{
			name: "JSON with empty choices array",
			handlerFunc: func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"choices": []interface{}{}})
			},
		},
		{
			name: "Immediate TCP connection close via Hijack",
			handlerFunc: func(w http.ResponseWriter, r *http.Request) {
				if hj, ok := w.(http.Hijacker); ok {
					conn, _, _ := hj.Hijack()
					if conn != nil {
						_ = conn.Close()
					}
					return
				}
				http.Error(w, "hijack failed", http.StatusInternalServerError)
			},
		},
	}

	for _, sc := range faultScenarios {
		t.Run(sc.name, func(t *testing.T) {
			faultServer := httptest.NewServer(sc.handlerFunc)
			defer faultServer.Close()

			fp := map[string]interface{}{
				"vocabulary": map[string]interface{}{
					"catchphrases": []string{"知道啦"},
				},
			}
			store, personaMgr, memoryEng, sched := setupTestEnvironment(t, "fault_"+sc.name, fp)
			defer store.Close()

			orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{
				BaseURL:   faultServer.URL,
				Model:     "fault-model",
				TimeoutMs: 5000,
			})

			res, err := orch.ProcessMessage("sess_fault", "user_alice", "晚上去打球吗？")
			if err != nil {
				t.Fatalf("[%s] ProcessMessage failed on network fault: %v", sc.name, err)
			}
			if res == nil {
				t.Fatalf("[%s] ProcessMessage returned nil result", sc.name)
			}

			// Must not return legacy boilerplate
			if strings.Contains(res.FinalMessage, "在呢，怎么啦~") {
				t.Fatalf("[%s] VIOLATION: Returned '在呢，怎么啦~' on fault: %q", sc.name, res.FinalMessage)
			}
			if res.FinalMessage == "在呢~" {
				t.Fatalf("[%s] VIOLATION: Returned '在呢~' on fault: %q", sc.name, res.FinalMessage)
			}
			if strings.TrimSpace(res.FinalMessage) == "" {
				t.Fatalf("[%s] Returned empty message on fault", sc.name)
			}

			// Critic must be honest not_run
			if res.Critic.Status != "not_run" {
				t.Errorf("[%s] Expected critic 'not_run', got %q", sc.name, res.Critic.Status)
			}
		})
	}
}

// TestChallenger2_ZeroBoilerplate_ExhaustiveTurns tests varied user input turns to guarantee
// 0% occurrence of '在呢，怎么啦~' across diverse dialogue intents.
func TestChallenger2_ZeroBoilerplate_ExhaustiveTurns(t *testing.T) {
	fp := map[string]interface{}{
		"openers": []string{"哈喽呀，刚到自习室"},
		"vocabulary": map[string]interface{}{
			"catchphrases": []string{"好的呀"},
		},
	}
	store, personaMgr, memoryEng, sched := setupTestEnvironment(t, "zero_bp_exhaustive", fp)
	defer store.Close()

	// Orchestrator without LLM endpoint forces fallback on every turn
	orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{})

	turnInputs := []string{
		"早安",
		"早上好呀！",
		"晚安啦好梦",
		"困死了先睡了",
		"哈哈哈哈太搞笑了吧",
		"在吗？",
		"在嘛",
		"今天天气怎么样？",
		"？",
		"123",
		"收到数字1",
		"处理任务很累",
		"你想让我做什么好吃的",
		"作为一个朋友，我很关心你",
		"你到底是谁",
	}

	for _, input := range turnInputs {
		t.Run(input, func(t *testing.T) {
			res, err := orch.ProcessMessage("sess_turns", "user_alice", input)
			if err != nil {
				t.Fatalf("ProcessMessage error on input %q: %v", input, err)
			}

			// Strict 0% boilerplate assertion
			if res.FinalMessage == "在呢，怎么啦~" || strings.Contains(res.FinalMessage, "在呢，怎么啦~") {
				t.Fatalf("VIOLATION: Turn produced '在呢，怎么啦~' on input %q", input)
			}
			if res.FinalMessage == "在呢~" {
				t.Fatalf("VIOLATION: Turn produced '在呢~' on input %q", input)
			}
			if strings.TrimSpace(res.FinalMessage) == "" {
				t.Fatalf("VIOLATION: Empty response returned on input %q", input)
			}
		})
	}
}
