package memory

import (
	"encoding/json"
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
}

// LLMExtractor represents an abstraction for LLM candidate extraction.
type LLMExtractor func(prompt string) (string, error)

// ExtractMemoryDeltas executes memory candidate extraction (attempting LLM, falling back to heuristic),
// performs normalization, and resolves conflicts by marking superseded facts with ValidTo.
// P0 Fix (Section 9, 10, 12): Returns all memory delta records (superseded updates + new inserts)
// so they can be committed atomically in CommitInteraction.
func (e *Engine) ExtractMemoryDeltas(personaID, sessionID, userMsg, botReply string, llmExtractor LLMExtractor) []storage.MemoryItem {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	var candidates []storage.MemoryItem

	// Step 1: Candidate Extraction (LLM first, then heuristic fallback)
	if llmExtractor != nil {
		llmPrompt := fmt.Sprintf("Extract facts, user preferences, and milestone events from this turn.\nUser: %s\nPersona: %s", userMsg, botReply)
		if rawJson, err := llmExtractor(llmPrompt); err == nil {
			candidates = parseLLMExtractionJSON(rawJson, now)
		}
	}

	if len(candidates) == 0 {
		candidates = e.heuristicCandidateExtraction(userMsg, now)
	}

	// Step 2 + 3: Normalization & Conflict Resolution with temporal versioning
	var deltas []storage.MemoryItem
	existing := e.store.QueryMemories(personaID, "L2")

	for _, candidate := range candidates {
		normalizedKey := normalizeMemoryKey(candidate.Category, candidate.Key)

		// Check for existing active memory with matching key to supersede
		for _, oldMem := range existing {
			if oldMem.Key == normalizedKey && oldMem.ValidTo == nil {
				// Mark superseded
				superseded := oldMem
				superseded.ValidTo = &now
				deltas = append(deltas, superseded)
			}
		}

		// New active version
		newMem := storage.MemoryItem{
			ID:              fmt.Sprintf("l2_%d_%d", time.Now().UnixNano(), len(deltas)+1),
			PersonaID:       personaID,
			Layer:           "L2",
			Category:        candidate.Category,
			Key:             normalizedKey,
			Value:           candidate.Value,
			ImportanceScore: candidate.ImportanceScore,
			ValidFrom:       now,
			ValidTo:         nil,
			Confidence:      candidate.Confidence,
			CreatedAt:       now,
		}
		deltas = append(deltas, newMem)
	}

	return deltas
}

// ExtractAndSaveMemoryPipeline executes the memory extraction pipeline and saves deltas.
func (e *Engine) ExtractAndSaveMemoryPipeline(personaID, sessionID, userMsg, botReply string) {
	deltas := e.ExtractMemoryDeltas(personaID, sessionID, userMsg, botReply, nil)
	for _, m := range deltas {
		_ = e.store.SaveMemory(m)
	}
}

func parseLLMExtractionJSON(raw string, now string) []storage.MemoryItem {
	var parsed struct {
		Memories []struct {
			Category   string  `json:"category"`
			Key        string  `json:"key"`
			Value      string  `json:"value"`
			Importance float64 `json:"importance_score"`
			Confidence float64 `json:"confidence"`
		} `json:"memories"`
	}
	clean := strings.TrimSpace(raw)
	firstBrace := strings.Index(clean, "{")
	lastBrace := strings.LastIndex(clean, "}")
	if firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace {
		clean = clean[firstBrace : lastBrace+1]
	}
	if err := json.Unmarshal([]byte(clean), &parsed); err == nil && len(parsed.Memories) > 0 {
		var items []storage.MemoryItem
		for _, m := range parsed.Memories {
			if m.Key != "" && m.Value != "" {
				imp := m.Importance
				if imp <= 0 {
					imp = 0.70
				}
				conf := m.Confidence
				if conf <= 0 {
					conf = 0.85
				}
				items = append(items, storage.MemoryItem{
					Category:        m.Category,
					Key:             m.Key,
					Value:           m.Value,
					ImportanceScore: imp,
					Confidence:      conf,
					ValidFrom:       now,
				})
			}
		}
		return items
	}
	return nil
}

func normalizeMemoryKey(category, key string) string {
	cleanKey := strings.TrimSpace(strings.ToLower(key))
	cleanCat := strings.TrimSpace(strings.ToLower(category))
	cleanKey = strings.ReplaceAll(cleanKey, " ", "_")
	if cleanCat != "" && !strings.HasPrefix(cleanKey, cleanCat) {
		return fmt.Sprintf("%s:%s", cleanCat, cleanKey)
	}
	return cleanKey
}

func (e *Engine) heuristicCandidateExtraction(userMsg, now string) []storage.MemoryItem {
	var items []storage.MemoryItem
	clean := strings.TrimSpace(userMsg)
	if clean == "" {
		return items
	}

	patterns := []struct {
		prefix   string
		category string
		key      string
	}{
		{"最喜欢", "preference", "favorite"},
		{"喜欢", "preference", "likes"},
		{"讨厌", "preference", "dislikes"},
		{"我住在", "profile", "location"},
		{"在", "profile", "location"},
		{"我是", "profile", "identity"},
		{"我叫", "profile", "name"},
	}

	for _, p := range patterns {
		if idx := strings.Index(clean, p.prefix); idx != -1 {
			val := strings.TrimSpace(clean[idx+len(p.prefix):])
			for _, sep := range []string{"，", ",", "。", "！", "!", "~", "\n"} {
				if cut := strings.Index(val, sep); cut != -1 {
					val = val[:cut]
				}
			}
			val = strings.TrimSpace(val)
			if len(val) >= 2 && len(val) <= 50 {
				items = append(items, storage.MemoryItem{
					Category:        p.category,
					Key:             p.key,
					Value:           fmt.Sprintf("%s %s", p.prefix, val),
					ImportanceScore: 0.65,
					Confidence:      0.80,
					ValidFrom:       now,
				})
				break
			}
		}
	}

	return items
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
