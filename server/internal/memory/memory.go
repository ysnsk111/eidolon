package memory

import (
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"eidolon/server/internal/storage"
)

type Engine struct {
	mu            sync.RWMutex
	store         *storage.Storage
	workingMemory map[string][]storage.MessageItem // SessionID -> L0 working turns
}

type MemoryItem = storage.MemoryItem

type RetrievalContext struct {
	RelevantEpisodes []string `json:"relevant_episodes"`
	RelevantFacts    []string `json:"relevant_facts"`
	WorldState       string   `json:"world_state"`
	WorkingContext   []string `json:"working_context"`
}

func NewEngine(store *storage.Storage) *Engine {
	return &Engine{
		store:         store,
		workingMemory: make(map[string][]storage.MessageItem),
	}
}

// AddWorkingMessage appends turn to L0 Working Memory Buffer
func (e *Engine) AddWorkingMessage(sessionID string, msg storage.MessageItem) {
	e.mu.Lock()
	defer e.mu.Unlock()

	turns := e.workingMemory[sessionID]
	turns = append(turns, msg)
	if len(turns) > 10 { // L0 keeps recent 10 turns
		turns = turns[len(turns)-10:]
	}
	e.workingMemory[sessionID] = turns

	// Persist to L0 in storage
	_ = e.store.SaveMemory(storage.MemoryItem{
		ID:              fmt.Sprintf("l0_%s_%d", sessionID, time.Now().UnixNano()),
		PersonaID:       msg.PersonaID,
		Layer:           "L0",
		Category:        "working_turn",
		Key:             msg.Sender,
		Value:           msg.Content,
		ImportanceScore: 0.50,
		ValidFrom:       msg.Timestamp,
		Confidence:      1.0,
	})
}

// ExtractAndSaveMemoryPipeline executes the full save pipeline (Section 34 & 35)
func (e *Engine) ExtractAndSaveMemoryPipeline(personaID, sessionID, userMsg, botReply string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)

	// Heuristic fact extraction: likes, preferences, milestones
	lower := strings.ToLower(userMsg)
	if strings.Contains(lower, "喜欢") || strings.Contains(lower, "爱吃") || strings.Contains(lower, "讨厌") {
		factScore := e.calculateScore(0.85, 1.0, 1, 0.70, 0.80, 0.95)
		e.resolveAndSaveFact(personaID, "user_preference", userMsg, factScore, now)
	}

	// Important milestone / event detection
	if strings.Contains(lower, "考试") || strings.Contains(lower, "毕业") || strings.Contains(lower, "生日") || strings.Contains(lower, "生病") {
		epScore := e.calculateScore(0.95, 1.0, 1, 0.90, 0.85, 0.95)
		_ = e.store.SaveMemory(storage.MemoryItem{
			ID:              fmt.Sprintf("l1_%d", time.Now().UnixNano()),
			PersonaID:       personaID,
			Layer:           "L1",
			Category:        "milestone_event",
			Key:             "event",
			Value:           fmt.Sprintf("User mentioned: %s", userMsg),
			ImportanceScore: epScore,
			ValidFrom:       now,
			Confidence:      0.95,
		})
	}
}

// Calculate 6-factor score per Section 35:
// Score = Imp*0.30 + Rec*0.15 + Freq*0.15 + RelImpact*0.15 + FutureRel*0.15 + Conf*0.10
func (e *Engine) calculateScore(importance, recency float64, frequency int, relImpact, futureRel, confidence float64) float64 {
	freqFactor := math.Min(1.0, float64(frequency)*0.20)
	score := importance*0.30 +
		recency*0.15 +
		freqFactor*0.15 +
		relImpact*0.15 +
		futureRel*0.15 +
		confidence*0.10
	return math.Round(score*1000) / 1000
}

// Conflict Resolution with versioned facts (Section 36)
func (e *Engine) resolveAndSaveFact(personaID, category, factValue string, score float64, now string) {
	// Query existing memories in L2
	existing := e.store.QueryMemories(personaID, "L2")
	key := fmt.Sprintf("fact_%s", category)

	for _, oldMem := range existing {
		if oldMem.Key == key && oldMem.ValidTo == nil {
			// Mark previous version as superseded
			oldMem.ValidTo = &now
			_ = e.store.SaveMemory(oldMem)
		}
	}

	// Insert new active version
	_ = e.store.SaveMemory(storage.MemoryItem{
		ID:              fmt.Sprintf("l2_%d", time.Now().UnixNano()),
		PersonaID:       personaID,
		Layer:           "L2",
		Category:        category,
		Key:             key,
		Value:           factValue,
		ImportanceScore: score,
		ValidFrom:       now,
		ValidTo:         nil,
		Confidence:      0.95,
	})
}

// RetrieveContext retrieves context-relevant memories for the prompt (Section 37)
func (e *Engine) RetrieveContext(personaID, sessionID, currentQuery string) RetrievalContext {
	e.mu.RLock()
	defer e.mu.RUnlock()

	rc := RetrievalContext{
		RelevantEpisodes: make([]string, 0),
		RelevantFacts:    make([]string, 0),
		WorkingContext:   make([]string, 0),
	}

	// L0 Working context
	turns := e.workingMemory[sessionID]
	for _, t := range turns {
		rc.WorkingContext = append(rc.WorkingContext, fmt.Sprintf("%s: %s", t.Sender, t.Content))
	}

	// L1 Episodes
	episodes := e.store.QueryMemories(personaID, "L1")
	for _, ep := range episodes {
		if ep.ImportanceScore >= 0.70 {
			rc.RelevantEpisodes = append(rc.RelevantEpisodes, ep.Value)
		}
	}

	// L2 Facts
	facts := e.store.QueryMemories(personaID, "L2")
	for _, f := range facts {
		if f.ValidTo == nil { // only active versions
			rc.RelevantFacts = append(rc.RelevantFacts, fmt.Sprintf("%s: %s", f.Category, f.Value))
		}
	}

	return rc
}
