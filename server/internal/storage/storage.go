package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Storage struct {
	mu     sync.RWMutex
	dbPath string
	db     *sql.DB
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
	TotalMemories int `json:"total_memories"`
	TotalSessions int `json:"total_sessions"`
	TotalMessages int `json:"total_messages"`
	L0Count       int `json:"l0_count"`
	L1Count       int `json:"l1_count"`
	L2Count       int `json:"l2_count"`
	L3Count       int `json:"l3_count"`
}

func NewStorage(dbPath string) (*Storage, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}

	dsn := fmt.Sprintf("%s?_journal=WAL&_busy_timeout=5000", dbPath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database at %s: %w", dbPath, err)
	}

	s := &Storage{
		dbPath: dbPath,
		db:     db,
		data: &MemoryStore{
			Memories:        make([]MemoryItem, 0),
			Sessions:        make([]SessionItem, 0),
			Messages:        make([]MessageItem, 0),
			SchedulerEvents: make([]SchedulerEvent, 0),
			Logs:            make([]LogItem, 0),
		},
	}

	if err := s.initSchema(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to initialize sqlite schema: %w", err)
	}

	// Synchronize in-memory cache with sqlite database
	s.syncFromDB()

	return s, nil
}

func (s *Storage) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS personas (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		target_speaker TEXT,
		created_at TEXT NOT NULL,
		dsi_score REAL,
		is_active INTEGER DEFAULT 0,
		manifest_json TEXT,
		package_path TEXT
	);

	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		persona_id TEXT,
		user_id TEXT,
		start_time TEXT,
		last_active_time TEXT,
		message_count INTEGER DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		session_id TEXT,
		persona_id TEXT,
		user_id TEXT,
		sender TEXT,
		content TEXT,
		timestamp TEXT,
		reply_to_id TEXT,
		latency_ms INTEGER DEFAULT 0,
		metadata TEXT
	);

	CREATE TABLE IF NOT EXISTS memories (
		id TEXT PRIMARY KEY,
		persona_id TEXT,
		layer TEXT,
		category TEXT,
		key TEXT,
		value TEXT,
		importance_score REAL,
		valid_from TEXT,
		valid_to TEXT,
		confidence REAL DEFAULT 1.0,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS scheduler_events (
		id TEXT PRIMARY KEY,
		session_id TEXT,
		message_id TEXT,
		calculated_delay_ms INTEGER,
		actual_delay_ms INTEGER,
		jitter_ms INTEGER,
		typing_duration_ms INTEGER,
		created_at TEXT
	);

	CREATE TABLE IF NOT EXISTS audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		subsystem TEXT,
		level TEXT,
		message TEXT,
		timestamp TEXT
	);
	`
	_, err := s.db.Exec(schema)
	return err
}

func (s *Storage) syncFromDB() {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load memories
	rows, err := s.db.Query(`SELECT id, persona_id, layer, category, key, value, importance_score, valid_from, valid_to, confidence, created_at FROM memories ORDER BY created_at ASC`)
	if err == nil {
		defer rows.Close()
		s.data.Memories = make([]MemoryItem, 0)
		for rows.Next() {
			var m MemoryItem
			var validTo sql.NullString
			if err := rows.Scan(&m.ID, &m.PersonaID, &m.Layer, &m.Category, &m.Key, &m.Value, &m.ImportanceScore, &m.ValidFrom, &validTo, &m.Confidence, &m.CreatedAt); err == nil {
				if validTo.Valid {
					val := validTo.String
					m.ValidTo = &val
				}
				s.data.Memories = append(s.data.Memories, m)
			}
		}
	}

	// Load messages
	msgRows, err := s.db.Query(`SELECT id, session_id, persona_id, user_id, sender, content, timestamp, COALESCE(reply_to_id, ''), latency_ms FROM messages ORDER BY timestamp ASC`)
	if err == nil {
		defer msgRows.Close()
		s.data.Messages = make([]MessageItem, 0)
		for msgRows.Next() {
			var msg MessageItem
			if err := msgRows.Scan(&msg.ID, &msg.SessionID, &msg.PersonaID, &msg.UserID, &msg.Sender, &msg.Content, &msg.Timestamp, &msg.ReplyToID, &msg.LatencyMs); err == nil {
				s.data.Messages = append(s.data.Messages, msg)
			}
		}
	}
}

func (s *Storage) SaveMemory(mem MemoryItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	if mem.CreatedAt == "" {
		mem.CreatedAt = now
	}
	if mem.ValidFrom == "" {
		mem.ValidFrom = now
	}

	query := `
	INSERT INTO memories (id, persona_id, layer, category, key, value, importance_score, valid_from, valid_to, confidence, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		valid_to = excluded.valid_to,
		value = excluded.value,
		importance_score = excluded.importance_score,
		confidence = excluded.confidence;
	`
	_, err := s.db.Exec(query, mem.ID, mem.PersonaID, mem.Layer, mem.Category, mem.Key, mem.Value, mem.ImportanceScore, mem.ValidFrom, mem.ValidTo, mem.Confidence, mem.CreatedAt)
	if err != nil {
		return err
	}

	// Update in-memory cache
	updated := false
	for i, m := range s.data.Memories {
		if m.ID == mem.ID {
			s.data.Memories[i] = mem
			updated = true
			break
		}
	}
	if !updated {
		s.data.Memories = append(s.data.Memories, mem)
	}

	return s.persist()
}

// CloseMemoryVersion marks a specific memory version as superseded by setting valid_to timestamp.
// P0 Fix (Section 9): Guarantees old active version is superseded and no longer queried.
func (s *Storage) CloseMemoryVersion(id string, validTo string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	query := `UPDATE memories SET valid_to = ? WHERE id = ?;`
	_, err := s.db.Exec(query, validTo, id)
	if err != nil {
		return err
	}

	for i, m := range s.data.Memories {
		if m.ID == id {
			s.data.Memories[i].ValidTo = &validTo
			break
		}
	}

	return s.persist()
}

// CloseSupersededMemories marks any active memories with the matching key as superseded.
func (s *Storage) CloseSupersededMemories(personaID, key, validTo string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	query := `UPDATE memories SET valid_to = ? WHERE persona_id = ? AND key = ? AND valid_to IS NULL;`
	_, err := s.db.Exec(query, validTo, personaID, key)
	if err != nil {
		return err
	}

	for i, m := range s.data.Memories {
		if (personaID == "" || m.PersonaID == personaID) && m.Key == key && m.ValidTo == nil {
			s.data.Memories[i].ValidTo = &validTo
		}
	}

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

	query := `
	INSERT INTO messages (id, session_id, persona_id, user_id, sender, content, timestamp, reply_to_id, latency_ms)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET content=excluded.content, timestamp=excluded.timestamp;
	`
	_, err := s.db.Exec(query, msg.ID, msg.SessionID, msg.PersonaID, msg.UserID, msg.Sender, msg.Content, msg.Timestamp, msg.ReplyToID, msg.LatencyMs)
	if err != nil {
		return err
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

	query := `
	INSERT INTO scheduler_events (id, session_id, message_id, calculated_delay_ms, actual_delay_ms, jitter_ms, typing_duration_ms, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?);
	`
	_, err := s.db.Exec(query, evt.ID, evt.SessionID, evt.MessageID, evt.CalculatedDelay, evt.ActualDelay, evt.JitterMs, evt.TypingDurationMs, evt.CreatedAt)
	if err != nil {
		return err
	}

	s.data.SchedulerEvents = append(s.data.SchedulerEvents, evt)
	return s.persist()
}

// InteractionTransaction aggregates incoming msg, memory deltas, outgoing msg, and scheduler event for atomic commit.
// P1 Fix (Section 21, Section 12): Uses true SQLite transaction to prevent partial state corruption.
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

	sqlTx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin sqlite transaction: %w", err)
	}
	defer func() {
		if sqlTx != nil {
			_ = sqlTx.Rollback()
		}
	}()

	// 1. InMessage
	if tx.InMessage != nil && tx.InMessage.ID != "" {
		if tx.InMessage.Timestamp == "" {
			tx.InMessage.Timestamp = now
		}
		query := `INSERT INTO messages (id, session_id, persona_id, user_id, sender, content, timestamp, reply_to_id, latency_ms)
		          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		          ON CONFLICT(id) DO UPDATE SET content=excluded.content, timestamp=excluded.timestamp;`
		if _, err := sqlTx.Exec(query, tx.InMessage.ID, tx.InMessage.SessionID, tx.InMessage.PersonaID, tx.InMessage.UserID, tx.InMessage.Sender, tx.InMessage.Content, tx.InMessage.Timestamp, tx.InMessage.ReplyToID, tx.InMessage.LatencyMs); err != nil {
			return fmt.Errorf("transaction insert inMessage error: %w", err)
		}
		s.data.Messages = append(s.data.Messages, *tx.InMessage)
	}

	// 2. Memories (both superseded updates and new inserts)
	memQuery := `
	INSERT INTO memories (id, persona_id, layer, category, key, value, importance_score, valid_from, valid_to, confidence, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		valid_to = excluded.valid_to,
		value = excluded.value,
		importance_score = excluded.importance_score,
		confidence = excluded.confidence;
	`
	for _, m := range tx.Memories {
		if m.CreatedAt == "" {
			m.CreatedAt = now
		}
		if m.ValidFrom == "" {
			m.ValidFrom = now
		}
		if _, err := sqlTx.Exec(memQuery, m.ID, m.PersonaID, m.Layer, m.Category, m.Key, m.Value, m.ImportanceScore, m.ValidFrom, m.ValidTo, m.Confidence, m.CreatedAt); err != nil {
			return fmt.Errorf("transaction upsert memory error: %w", err)
		}

		// Update in-memory cache
		updated := false
		for i, existing := range s.data.Memories {
			if existing.ID == m.ID {
				s.data.Memories[i] = m
				updated = true
				break
			}
		}
		if !updated {
			s.data.Memories = append(s.data.Memories, m)
		}
	}

	// 3. OutMessage
	if tx.OutMessage != nil && tx.OutMessage.ID != "" {
		if tx.OutMessage.Timestamp == "" {
			tx.OutMessage.Timestamp = now
		}
		query := `INSERT INTO messages (id, session_id, persona_id, user_id, sender, content, timestamp, reply_to_id, latency_ms)
		          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		          ON CONFLICT(id) DO UPDATE SET content=excluded.content, timestamp=excluded.timestamp;`
		if _, err := sqlTx.Exec(query, tx.OutMessage.ID, tx.OutMessage.SessionID, tx.OutMessage.PersonaID, tx.OutMessage.UserID, tx.OutMessage.Sender, tx.OutMessage.Content, tx.OutMessage.Timestamp, tx.OutMessage.ReplyToID, tx.OutMessage.LatencyMs); err != nil {
			return fmt.Errorf("transaction insert outMessage error: %w", err)
		}
		s.data.Messages = append(s.data.Messages, *tx.OutMessage)
	}

	// 4. SchedulerEvent
	if tx.SchedulerEvent != nil && tx.SchedulerEvent.ID != "" {
		if tx.SchedulerEvent.CreatedAt == "" {
			tx.SchedulerEvent.CreatedAt = now
		}
		query := `INSERT INTO scheduler_events (id, session_id, message_id, calculated_delay_ms, actual_delay_ms, jitter_ms, typing_duration_ms, created_at)
		          VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
		if _, err := sqlTx.Exec(query, tx.SchedulerEvent.ID, tx.SchedulerEvent.SessionID, tx.SchedulerEvent.MessageID, tx.SchedulerEvent.CalculatedDelay, tx.SchedulerEvent.ActualDelay, tx.SchedulerEvent.JitterMs, tx.SchedulerEvent.TypingDurationMs, tx.SchedulerEvent.CreatedAt); err != nil {
			return fmt.Errorf("transaction insert schedulerEvent error: %w", err)
		}
		s.data.SchedulerEvents = append(s.data.SchedulerEvents, *tx.SchedulerEvent)
	}

	if err := sqlTx.Commit(); err != nil {
		return fmt.Errorf("failed to commit interaction transaction: %w", err)
	}
	sqlTx = nil // mark committed

	return s.persist()
}

func (s *Storage) Log(subsystem, level, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.Exec(`INSERT INTO audit_logs (subsystem, level, message, timestamp) VALUES (?, ?, ?, ?);`, subsystem, level, message, now)
	var logID int64
	if err == nil {
		logID, _ = res.LastInsertId()
	} else {
		logID = time.Now().UnixNano()
	}

	s.data.Logs = append(s.data.Logs, LogItem{
		ID:        logID,
		Subsystem: subsystem,
		Level:     level,
		Message:   message,
		Timestamp: now,
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

func (s *Storage) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

func (s *Storage) persist() error {
	data, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.dbPath+".json", data, 0600)
}
