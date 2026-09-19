package storage_test

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"eidolon/server/internal/storage"
	_ "github.com/mattn/go-sqlite3"
)

func TestStorage_InitAndSchema(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_eidolon.db")

	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to initialize storage: %v", err)
	}
	defer store.Close()

	// Verify tables created in SQLite
	rawDB, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("Failed to open raw sqlite db: %v", err)
	}
	defer rawDB.Close()

	expectedTables := []string{"personas", "sessions", "messages", "memories", "scheduler_events", "audit_logs"}
	for _, table := range expectedTables {
		var count int
		err := rawDB.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&count)
		if err != nil || count != 1 {
			t.Errorf("Expected table %s to exist in sqlite schema, got count=%d, err=%v", table, count, err)
		}
	}
}

func TestStorage_MemoryTemporalVersioning(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_temporal.db")

	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to initialize storage: %v", err)
	}
	defer store.Close()

	// Insert active version
	initial := storage.MemoryItem{
		ID:              "fact_coffee_v1",
		PersonaID:       "alice",
		Layer:           "L2",
		Category:        "preference",
		Key:             "preference:coffee",
		Value:           "likes iced latte",
		ImportanceScore: 0.8,
		ValidFrom:       "2026-03-01T10:00:00Z",
		Confidence:      0.9,
	}
	if err := store.SaveMemory(initial); err != nil {
		t.Fatalf("SaveMemory failed: %v", err)
	}

	// Verify active
	mems := store.QueryMemories("alice", "L2")
	if len(mems) != 1 || mems[0].ValidTo != nil {
		t.Fatalf("Expected 1 active memory with ValidTo == nil, got %+v", mems)
	}

	// Section 9: Close memory version in place by setting valid_to
	validTo := "2026-03-05T12:00:00Z"
	if err := store.CloseMemoryVersion("fact_coffee_v1", validTo); err != nil {
		t.Fatalf("CloseMemoryVersion failed: %v", err)
	}

	// Check DB directly to ensure in-place update rather than append copy
	rawDB, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("Failed to open raw sqlite db: %v", err)
	}
	defer rawDB.Close()

	var count int
	var dbValidTo sql.NullString
	err = rawDB.QueryRow(`SELECT count(*), valid_to FROM memories WHERE id=?`, "fact_coffee_v1").Scan(&count, &dbValidTo)
	if err != nil || count != 1 {
		t.Fatalf("Expected exactly 1 row for fact_coffee_v1, got count=%d", count)
	}
	if !dbValidTo.Valid || dbValidTo.String != validTo {
		t.Fatalf("Expected valid_to=%s, got %v", validTo, dbValidTo)
	}
}

func TestStorage_CommitInteraction_AtomicTransaction(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_tx.db")

	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to initialize storage: %v", err)
	}
	defer store.Close()

	// Initial memory
	oldMem := storage.MemoryItem{
		ID:              "mem_preference_tea_v1",
		PersonaID:       "alice",
		Layer:           "L2",
		Category:        "preference",
		Key:             "preference:tea",
		Value:           "likes green tea",
		ImportanceScore: 0.7,
		ValidFrom:       "2026-03-01T00:00:00Z",
		Confidence:      0.8,
	}
	if err := store.SaveMemory(oldMem); err != nil {
		t.Fatalf("Save initial memory failed: %v", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	supersededOld := oldMem
	supersededOld.ValidTo = &now

	newMem := storage.MemoryItem{
		ID:              "mem_preference_tea_v2",
		PersonaID:       "alice",
		Layer:           "L2",
		Category:        "preference",
		Key:             "preference:tea",
		Value:           "likes oolong tea with boba",
		ImportanceScore: 0.85,
		ValidFrom:       now,
		Confidence:      0.95,
	}

	inMsg := storage.MessageItem{
		ID:        "msg_in_001",
		SessionID: "sess_01",
		PersonaID: "alice",
		UserID:    "user_bob",
		Sender:    "Bob",
		Content:   "你现在还喜欢喝绿茶吗？",
		Timestamp: now,
	}

	outMsg := storage.MessageItem{
		ID:        "msg_out_001",
		SessionID: "sess_01",
		PersonaID: "alice",
		UserID:    "user_bob",
		Sender:    "Alice",
		Content:   "我现在更喜欢乌龙波波奶茶啦~",
		Timestamp: now,
		LatencyMs: 2400,
	}

	schedEvt := storage.SchedulerEvent{
		ID:               "evt_001",
		SessionID:        "sess_01",
		MessageID:        "msg_out_001",
		CalculatedDelay:  2400,
		ActualDelay:      2400,
		JitterMs:         200,
		TypingDurationMs: 1500,
		CreatedAt:        now,
	}

	tx := storage.InteractionTransaction{
		InMessage:      &inMsg,
		Memories:       []storage.MemoryItem{supersededOld, newMem},
		OutMessage:     &outMsg,
		SchedulerEvent: &schedEvt,
	}

	// Commit atomic transaction (Section 12 & 21)
	if err := store.CommitInteraction(tx); err != nil {
		t.Fatalf("CommitInteraction failed: %v", err)
	}

	// Verify inMessage and outMessage exist
	recentMsgs := store.GetRecentMessages("sess_01", 10)
	if len(recentMsgs) != 2 {
		t.Fatalf("Expected 2 recent messages, got %d", len(recentMsgs))
	}
	if recentMsgs[0].Content != inMsg.Content || recentMsgs[1].Content != outMsg.Content {
		t.Errorf("Message contents do not match committed transaction")
	}

	// Verify old memory has valid_to set and new memory is active
	mems := store.QueryMemories("alice", "L2")
	if len(mems) != 2 {
		t.Fatalf("Expected 2 memories, got %d", len(mems))
	}

	var foundV1, foundV2 bool
	for _, m := range mems {
		if m.ID == "mem_preference_tea_v1" {
			foundV1 = true
			if m.ValidTo == nil || *m.ValidTo != now {
				t.Errorf("Expected v1 ValidTo to be set to %s, got %v", now, m.ValidTo)
			}
		}
		if m.ID == "mem_preference_tea_v2" {
			foundV2 = true
			if m.ValidTo != nil {
				t.Errorf("Expected v2 ValidTo to be nil, got %v", *m.ValidTo)
			}
			if m.Value != newMem.Value {
				t.Errorf("Expected v2 value '%s', got '%s'", newMem.Value, m.Value)
			}
		}
	}
	if !foundV1 || !foundV2 {
		t.Errorf("Missing version 1 or 2 in memories: foundV1=%v, foundV2=%v", foundV1, foundV2)
	}
}
