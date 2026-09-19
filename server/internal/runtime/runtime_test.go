package runtime_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/runtime"
	"eidolon/server/internal/scheduler"
	"eidolon/server/internal/storage"
)

func TestRuntime_ProcessMessage_CommitInteractionAndHonestCritic(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_runtime.db")
	personasDir := filepath.Join(tempDir, "personas")
	personaID := "alice_test"
	pDir := filepath.Join(personasDir, personaID)

	if err := os.MkdirAll(pDir, 0755); err != nil {
		t.Fatalf("Failed to create persona dir: %v", err)
	}

	// Create test persona files
	manifest := map[string]interface{}{"name": "Alice", "version": "1.1.0"}
	manData, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(pDir, "manifest.json"), manData, 0644)

	personaDetails := map[string]interface{}{
		"id":             personaID,
		"name":           "Alice",
		"target_speaker": "Alice",
		"system_prompts": map[string]interface{}{
			"generator": "You are Alice.",
			"critic":    "", // Empty critic to verify honest not_run status
		},
	}
	pData, _ := json.Marshal(personaDetails)
	_ = os.WriteFile(filepath.Join(pDir, "persona.json"), pData, 0644)

	behaviorData := map[string]interface{}{
		"conversation_rhythm": map[string]interface{}{
			"base_delay_ms": 2200,
			"latency_model": map[string]interface{}{
				"short": map[string]interface{}{"median_ms": 1100, "p90_ms": 2000, "samples": 12},
			},
		},
	}
	bData, _ := json.Marshal(behaviorData)
	_ = os.WriteFile(filepath.Join(pDir, "behavior.json"), bData, 0644)

	// Initialize components
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	defer store.Close()

	personaMgr := persona.NewPersonaManager(personasDir)
	if _, err := personaMgr.LoadPersona(personaID); err != nil {
		t.Fatalf("Failed to load persona: %v", err)
	}

	memoryEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 3000})

	// Create orchestrator with mock/empty LLM config (triggers fallback generator)
	orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{})

	// Run ProcessMessage
	res, err := orch.ProcessMessage("sess_100", "user_bob", "你好呀，今天在干嘛呢？")
	if err != nil {
		t.Fatalf("ProcessMessage failed: %v", err)
	}

	// Verify honest critic output
	if res.Critic.Status != "not_run" {
		t.Errorf("Expected critic status 'not_run', got '%s'", res.Critic.Status)
	}
	if res.Critic.Score != nil {
		t.Errorf("Expected critic score to be nil when not run, got %v", *res.Critic.Score)
	}

	// Verify CommitInteraction committed both inMsg and outMsg atomically to SQLite
	recentMsgs := store.GetRecentMessages("sess_100", 10)
	if len(recentMsgs) != 2 {
		t.Fatalf("Expected exactly 2 messages committed to DB, got %d", len(recentMsgs))
	}
	if recentMsgs[0].Content != "你好呀，今天在干嘛呢？" {
		t.Errorf("InMessage content mismatch: %s", recentMsgs[0].Content)
	}
	if recentMsgs[1].Sender != "Alice" {
		t.Errorf("OutMessage sender mismatch: %s", recentMsgs[1].Sender)
	}

	// Verify Scheduler updated from persona's behavior model (short bucket median = 1100)
	if res.Schedule.Bucket != "short" {
		t.Errorf("Expected schedule bucket 'short', got '%s'", res.Schedule.Bucket)
	}
}
