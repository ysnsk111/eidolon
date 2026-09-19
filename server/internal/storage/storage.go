package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Storage struct {
	mu     sync.RWMutex
	dbPath string
	data   *MemoryStore
}

type MemoryStore struct {
	Memories        []MemoryItem     `json:"memories"`
	Sessions        []SessionItem    `json:"sessions"`
	Messages        []MessageItem    `json:"messages"`
	SchedulerEvents []SchedulerEvent `json:"scheduler_events"`
	Logs            []LogItem        `json:"logs"`
}

type MemoryItem struct {
	ID              string  `json:"id"`
	PersonaID       string  `json:"persona_id"`
	Layer           string  `json:"layer"` // L0, L1, L2, L3
	Category        string  `json:"category"`
	Key             string  `json:"key"`
	Value           string  `json:"value"`
	ImportanceScore float64 `json:"importance_score"`
	ValidFrom       string  `json:"valid_from"`
	ValidTo         *string `json:"valid_to"`
	Confidence      float64 `json:"confidence"`
	CreatedAt       string  `json:"created_at"`
}

type SessionItem struct {
	ID             string `json:"id"`
	PersonaID      string `json:"persona_id"`
	UserID         string `json:"user_id"`
	StartTime      string `json:"start_time"`
	LastActiveTime string `json:"last_active_time"`
	MessageCount   int    `json:"message_count"`
}

type MessageItem struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	PersonaID string `json:"persona_id"`
	UserID    string `json:"user_id"`
	Sender    string `json:"sender"`
	Content   string `json:"content"`
	Timestamp string `json:"timestamp"`
	ReplyToID string `json:"reply_to_id,omitempty"`
	LatencyMs int    `json:"latency_ms"`
}

type SchedulerEvent struct {
	ID               string `json:"id"`
	SessionID        string `json:"session_id"`
	MessageID        string `json:"message_id"`
	CalculatedDelay  int    `json:"calculated_delay_ms"`
	ActualDelay      int    `json:"actual_delay_ms"`
	JitterMs         int    `json:"jitter_ms"`
	TypingDurationMs int    `json:"typing_duration_ms"`
	CreatedAt        string `json:"created_at"`
}

type LogItem struct {
	ID        int64  `json:"id"`
	Subsystem string `json:"subsystem"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

type Stats struct {
	TotalMemories  int `json:"total_memories"`
	TotalSessions  int `json:"total_sessions"`
	TotalMessages  int `json:"total_messages"`
	L0Count        int `json:"l0_count"`
	L1Count        int `json:"l1_count"`
	L2Count        int `json:"l2_count"`
	L3Count        int `json:"l3_count"`
}

func NewStorage(dbPath string) (*Storage, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}

	s := &Storage{
		dbPath: dbPath,
		data: &MemoryStore{
			Memories:        make([]MemoryItem, 0),
			Sessions:        make([]SessionItem, 0),
			Messages:        make([]MessageItem, 0),
			SchedulerEvents: make([]SchedulerEvent, 0),
			Logs:            make([]LogItem, 0),
		},
	}

	// Load existing json backup if present
	jsonBackup := dbPath + ".json"
	if data, err := os.ReadFile(jsonBackup); err == nil {
		_ = json.Unmarshal(data, s.data)
	}

	return s, nil
}

func (s *Storage) SaveMemory(mem MemoryItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if mem.CreatedAt == "" {
		mem.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.data.Memories = append(s.data.Memories, mem)
	return s.persist()
}

func (s *Storage) QueryMemories(personaID, layer string) []MemoryItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	res := make([]MemoryItem, 0)
	for _, m := range s.data.Memories {
		if (personaID == "" || m.PersonaID == personaID) && (layer == "" || m.Layer == layer) {
			res = append(res, m)
		}
	}
	return res
}

func (s *Storage) SaveMessage(msg MessageItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if msg.Timestamp == "" {
		msg.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	s.data.Messages = append(s.data.Messages, msg)
	return s.persist()
}

func (s *Storage) GetRecentMessages(sessionID string, limit int) []MessageItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	filtered := make([]MessageItem, 0)
	for _, m := range s.data.Messages {
		if sessionID == "" || m.SessionID == sessionID {
			filtered = append(filtered, m)
		}
	}

	if len(filtered) <= limit {
		return filtered
	}
	return filtered[len(filtered)-limit:]
}

func (s *Storage) RecordSchedulerEvent(evt SchedulerEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if evt.CreatedAt == "" {
		evt.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	s.data.SchedulerEvents = append(s.data.SchedulerEvents, evt)
	return s.persist()
}

// InteractionTransaction aggregates incoming msg, memory deltas, outgoing msg, and scheduler event for atomic commit.
// P1 Fix (Section 21): Prevents partial state corruption if intermediate writes fail.
type InteractionTransaction struct {
	InMessage      *MessageItem
	Memories       []MemoryItem
	OutMessage     *MessageItem
	SchedulerEvent *SchedulerEvent
}

func (s *Storage) CommitInteraction(tx InteractionTransaction) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)

	if tx.InMessage != nil && tx.InMessage.ID != "" {
		if tx.InMessage.Timestamp == "" {
			tx.InMessage.Timestamp = now
		}
		s.data.Messages = append(s.data.Messages, *tx.InMessage)
	}

	for _, m := range tx.Memories {
		if m.CreatedAt == "" {
			m.CreatedAt = now
		}
		s.data.Memories = append(s.data.Memories, m)
	}

	if tx.OutMessage != nil && tx.OutMessage.ID != "" {
		if tx.OutMessage.Timestamp == "" {
			tx.OutMessage.Timestamp = now
		}
		s.data.Messages = append(s.data.Messages, *tx.OutMessage)
	}

	if tx.SchedulerEvent != nil && tx.SchedulerEvent.ID != "" {
		if tx.SchedulerEvent.CreatedAt == "" {
			tx.SchedulerEvent.CreatedAt = now
		}
		s.data.SchedulerEvents = append(s.data.SchedulerEvents, *tx.SchedulerEvent)
	}

	return s.persist()
}

func (s *Storage) Log(subsystem, level, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.data.Logs = append(s.data.Logs, LogItem{
		ID:        time.Now().UnixNano(),
		Subsystem: subsystem,
		Level:     level,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
	_ = s.persist()
}

func (s *Storage) GetLogs(limit int) []LogItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.data.Logs) <= limit {
		return s.data.Logs
	}
	return s.data.Logs[len(s.data.Logs)-limit:]
}

func (s *Storage) GetStats() Stats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	stats := Stats{
		TotalMemories: len(s.data.Memories),
		TotalSessions: len(s.data.Sessions),
		TotalMessages: len(s.data.Messages),
	}

	for _, m := range s.data.Memories {
		switch m.Layer {
		case "L0":
			stats.L0Count++
		case "L1":
			stats.L1Count++
		case "L2":
			stats.L2Count++
		case "L3":
			stats.L3Count++
		}
	}

	return stats
}

func (s *Storage) persist() error {
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.dbPath+".json", data, 0600)
}

// Suppress unused imports
var _ = fmt.Sprintf
var _ *sql.DB
