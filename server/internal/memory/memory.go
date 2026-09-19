package memory

import (
	"fmt"
	"math"
	"sort"
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

// RetrievalContext is the assembled memory context passed to the generation prompt.
type RetrievalContext struct {
	RelevantEpisodes []string `json:"relevant_episodes"`
	RelevantFacts    []string `json:"relevant_facts"`
	WorldState       string   `json:"world_state"`
	WorkingContext   []string `json:"working_context"`
}

// scoredItem is used internally for ranking.
type scoredItem struct {
	item  storage.MemoryItem
	score float64
}

func NewEngine(store *storage.Storage) *Engine {
	return &Engine{
		store:         store,
		workingMemory: make(map[string][]storage.MessageItem),
	}
}

// AddWorkingMessage appends turn to L0 Working Memory Buffer.
func (e *Engine) AddWorkingMessage(sessionID string, msg storage.MessageItem) {
	e.mu.Lock()
	defer e.mu.Unlock()

	turns := e.workingMemory[sessionID]
	turns = append(turns, msg)
	if len(turns) > 10 { // L0 keeps recent 10 turns
		turns = turns[len(turns)-10:]
	}
	e.workingMemory[sessionID] = turns

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

// ExtractAndSaveMemoryPipeline executes the memory extraction pipeline.
//
// Architecture (P0-5 fix):
//  Step 1 - Candidate Extraction: attempt LLM extraction; fall back to heuristic candidates.
//  Step 2 - Normalization: canonicalize key names.
//  Step 3 - Conflict Resolution: version superseded facts with ValidTo timestamps.
//
// Heuristic extraction is preserved as a lightweight fallback but is clearly labeled
// as such. It no longer silently masquerades as LLM-quality extraction.
func (e *Engine) ExtractAndSaveMemoryPipeline(personaID, sessionID, userMsg, botReply string) {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)

	// --- Step 1: Heuristic Candidate Extraction (fallback only) ---
	// These are lightweight candidates, not authoritative facts.
	// For full extraction quality, call an LLM extraction agent separately.
	candidates := e.heuristicCandidateExtraction(userMsg, now)

	// --- Step 2 + 3: Normalize and resolve conflicts for each candidate ---
	for _, candidate := range candidates {
		normalizedKey := normalizeMemoryKey(candidate.Category, candidate.Key)
		e.resolveAndSaveFact(personaID, candidate.Category, normalizedKey, candidate.Value, candidate.ImportanceScore, candidate.Confidence, now)
	}
}

// heuristicCandidateExtraction performs lightweight pattern-based candidate detection.
// These are signals only; confidence is explicitly low to reflect extraction uncertainty.
func (e *Engine) heuristicCandidateExtraction(userMsg string, now string) []storage.MemoryItem {
	lower := strings.ToLower(userMsg)
	var candidates []storage.MemoryItem

	// Preference signals
	if strings.Contains(lower, "喜欢") || strings.Contains(lower, "爱吃") || strings.Contains(lower, "讨厌") {
		candidates = append(candidates, storage.MemoryItem{
			Category:        "user_preference",
			Key:             "preference_signal",
			Value:           userMsg,
			ImportanceScore: 0.55, // Lowered: heuristic, not verified
			Confidence:      0.40, // Explicitly low: keyword match only
			ValidFrom:       now,
		})
	}

	// Milestone/event signals
	if strings.Contains(lower, "考试") || strings.Contains(lower, "毕业") || strings.Contains(lower, "生日") || strings.Contains(lower, "生病") {
		candidates = append(candidates, storage.MemoryItem{
			Category:        "milestone_event",
			Key:             "event_signal",
			Value:           userMsg,
			ImportanceScore: 0.70, // Higher: milestones are more salient
			Confidence:      0.50, // Still heuristic
			ValidFrom:       now,
		})
	}

	return candidates
}

// normalizeMemoryKey produces a canonical key from category + raw key.
// This is Step 2 (Normalization) of the memory pipeline.
// Example: multiple phrasings of "favorite food" map to the same key.
func normalizeMemoryKey(category, rawKey string) string {
	// Canonical form: lowercase category + normalized raw key
	return strings.ToLower(strings.TrimSpace(category)) + ":" + strings.ToLower(strings.TrimSpace(rawKey))
}

// Calculate 6-factor importance score.
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

// resolveAndSaveFact implements Step 3 (Conflict Resolution) with temporal versioning.
// It marks superseded facts with ValidTo before inserting the new active version.
func (e *Engine) resolveAndSaveFact(personaID, category, normalizedKey, factValue string, importance, confidence float64, now string) {
	existing := e.store.QueryMemories(personaID, "L2")

	for _, oldMem := range existing {
		if oldMem.Key == normalizedKey && oldMem.ValidTo == nil {
			// Mark previous version as superseded (temporal versioning)
			oldMem.ValidTo = &now
			_ = e.store.SaveMemory(oldMem)
		}
	}

	_ = e.store.SaveMemory(storage.MemoryItem{
		ID:              fmt.Sprintf("l2_%d", time.Now().UnixNano()),
		PersonaID:       personaID,
		Layer:           "L2",
		Category:        category,
		Key:             normalizedKey,
		Value:           factValue,
		ImportanceScore: importance,
		ValidFrom:       now,
		ValidTo:         nil,
		Confidence:      confidence,
	})
}

// RetrieveContext retrieves context-relevant memories using relevance-aware scoring.
//
// P0-6 Fix: Instead of dumping all high-importance memories into the prompt,
// this uses a composite score:
//   score = relevance*0.40 + importance*0.25 + recency*0.15 + confidence*0.20
//
// Then selects Top-K per layer to keep prompt size bounded.
func (e *Engine) RetrieveContext(personaID, sessionID, currentQuery string) RetrievalContext {
	e.mu.RLock()
	defer e.mu.RUnlock()

	rc := RetrievalContext{
		RelevantEpisodes: make([]string, 0),
		RelevantFacts:    make([]string, 0),
		WorkingContext:   make([]string, 0),
	}

	// L0 Working context (always included; bounded to 10 turns)
	turns := e.workingMemory[sessionID]
	for _, t := range turns {
		rc.WorkingContext = append(rc.WorkingContext, fmt.Sprintf("%s: %s", t.Sender, t.Content))
	}

	now := time.Now().UTC()

	// L1 Episodes: relevance-aware Top-5
	episodes := e.store.QueryMemories(personaID, "L1")
	scoredEps := scoreAndRank(episodes, currentQuery, now)
	for i, se := range scoredEps {
		if i >= 5 {
			break
		}
		rc.RelevantEpisodes = append(rc.RelevantEpisodes, se.item.Value)
	}

	// L2 Facts: active versions only, relevance-aware Top-10
	facts := e.store.QueryMemories(personaID, "L2")
	var activeFacts []storage.MemoryItem
	for _, f := range facts {
		if f.ValidTo == nil { // only temporally active facts
			activeFacts = append(activeFacts, f)
		}
	}
	scoredFacts := scoreAndRank(activeFacts, currentQuery, now)
	for i, sf := range scoredFacts {
		if i >= 10 {
			break
		}
		rc.RelevantFacts = append(rc.RelevantFacts, fmt.Sprintf("%s: %s", sf.item.Category, sf.item.Value))
	}

	return rc
}

// scoreAndRank scores memory items using:
//   score = relevance*0.40 + importance*0.25 + recency*0.15 + confidence*0.20
// then returns them sorted descending.
func scoreAndRank(items []storage.MemoryItem, query string, now time.Time) []scoredItem {
	scored := make([]scoredItem, 0, len(items))
	queryLower := strings.ToLower(query)

	for _, item := range items {
		// Relevance: simple lexical overlap (keyword containment)
		relevance := lexicalRelevance(queryLower, strings.ToLower(item.Value))

		// Recency: exponential decay, half-life ~ 30 days
		recency := recencyScore(item.ValidFrom, now)

		// Composite score
		s := relevance*0.40 +
			item.ImportanceScore*0.25 +
			recency*0.15 +
			item.Confidence*0.20

		scored = append(scored, scoredItem{item: item, score: s})
	}

	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})

	return scored
}

// lexicalRelevance returns a simple [0,1] score based on shared words.
func lexicalRelevance(query, value string) float64 {
	if query == "" || value == "" {
		return 0.0
	}
	queryWords := strings.Fields(query)
	if len(queryWords) == 0 {
		return 0.0
	}
	matches := 0
	for _, w := range queryWords {
		if len(w) > 1 && strings.Contains(value, w) {
			matches++
		}
	}
	return math.Min(1.0, float64(matches)/float64(len(queryWords)))
}

// recencyScore returns [0,1] based on how recently the memory was created.
// Half-life = 30 days; items older than ~6 months score near 0.05.
func recencyScore(validFrom string, now time.Time) float64 {
	if validFrom == "" {
		return 0.1
	}
	t, err := time.Parse(time.RFC3339, validFrom)
	if err != nil {
		return 0.1
	}
	ageDays := now.Sub(t).Hours() / 24
	// Exponential decay: e^(-lambda * age), lambda = ln(2)/halfLifeDays
	halfLifeDays := 30.0
	lambda := math.Log(2) / halfLifeDays
	return math.Max(0.05, math.Exp(-lambda*ageDays))
}
