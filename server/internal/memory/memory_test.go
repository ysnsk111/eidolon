package memory_test

import (
	"path/filepath"
	"testing"
	"time"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/storage"
)

func TestMemory_ExtractMemoryDeltas_ConflictResolution(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_mem_deltas.db")
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to init storage: %v", err)
	}
	defer store.Close()

	engine := memory.NewEngine(store)

	// Seed existing active fact
	oldMem := storage.MemoryItem{
		ID:              "l2_existing_01",
		PersonaID:       "alice",
		Layer:           "L2",
		Category:        "preference",
		Key:             "preference:favorite",
		Value:           "最喜欢 拿铁咖啡",
		ImportanceScore: 0.70,
		ValidFrom:       "2026-03-01T00:00:00Z",
		Confidence:      0.85,
	}
	if err := store.SaveMemory(oldMem); err != nil {
		t.Fatalf("SaveMemory failed: %v", err)
	}

	// New user turn indicating new preference
	userMsg := "我现在最喜欢 芝士美式 了"
	botReply := "芝士美式口感很特别呀~"

	deltas := engine.ExtractMemoryDeltas("alice", "sess_1", userMsg, botReply, nil)
	if len(deltas) < 2 {
		t.Fatalf("Expected at least 2 deltas (1 superseded + 1 new), got %d: %+v", len(deltas), deltas)
	}

	var foundSuperseded, foundNew bool
	for _, d := range deltas {
		if d.ID == "l2_existing_01" {
			foundSuperseded = true
			if d.ValidTo == nil {
				t.Errorf("Expected old memory delta to have ValidTo set, got nil")
			}
		}
		if d.ID != "l2_existing_01" && d.ValidTo == nil {
			foundNew = true
		}
	}

	if !foundSuperseded {
		t.Errorf("Did not find superseded delta for l2_existing_01")
	}
	if !foundNew {
		t.Errorf("Did not find new active memory delta")
	}
}

func TestMemory_RetrieveContext_RelevanceAndTemporalFiltering(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_mem_retrieval.db")
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to init storage: %v", err)
	}
	defer store.Close()

	engine := memory.NewEngine(store)
	now := time.Now().UTC().Format(time.RFC3339)
	past := time.Now().Add(-48 * time.Hour).UTC().Format(time.RFC3339)

	// Fact 1: Superseded (ValidTo != nil) -> MUST be excluded from L2 facts
	store.SaveMemory(storage.MemoryItem{
		ID:              "fact_old",
		PersonaID:       "alice",
		Layer:           "L2",
		Category:        "hobby",
		Key:             "hobby:sports",
		Value:           "likes tennis",
		ImportanceScore: 0.9,
		ValidFrom:       past,
		ValidTo:         &now,
		Confidence:      0.9,
	})

	// Fact 2: Active (ValidTo == nil) -> MUST be included
	store.SaveMemory(storage.MemoryItem{
		ID:              "fact_active",
		PersonaID:       "alice",
		Layer:           "L2",
		Category:        "hobby",
		Key:             "hobby:sports",
		Value:           "likes badminton",
		ImportanceScore: 0.9,
		ValidFrom:       now,
		ValidTo:         nil,
		Confidence:      0.9,
	})

	// Episode 1: L1
	store.SaveMemory(storage.MemoryItem{
		ID:              "ep_01",
		PersonaID:       "alice",
		Layer:           "L1",
		Category:        "trip",
		Key:             "trip:tokyo",
		Value:           "went to Tokyo last spring and visited Akihabara",
		ImportanceScore: 0.8,
		ValidFrom:       now,
		Confidence:      0.9,
	})

	ctx := engine.RetrieveContext("alice", "sess_01", "do you play badminton?")

	// Verify superseded fact was filtered out
	for _, f := range ctx.RelevantFacts {
		if f == "hobby: likes tennis" {
			t.Errorf("Superseded fact should not be in retrieved facts: %s", f)
		}
	}

	// Verify active fact is present
	foundActive := false
	for _, f := range ctx.RelevantFacts {
		if f == "hobby: likes badminton" {
			foundActive = true
		}
	}
	if !foundActive {
		t.Errorf("Active fact 'hobby: likes badminton' not found in retrieved facts: %+v", ctx.RelevantFacts)
	}

	// Verify episode retrieval
	if len(ctx.RelevantEpisodes) != 1 || ctx.RelevantEpisodes[0] != "went to Tokyo last spring and visited Akihabara" {
		t.Errorf("Expected episode in retrieved context, got %+v", ctx.RelevantEpisodes)
	}
}
