package storage

import (
	"database/sql"
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

// InteractionTransaction aggregates incoming msg, memory deltas, outgoing msg, and scheduler event for atomic commit.
type InteractionTransaction struct {
	InMessage             *MessageItem
	Memories              []MemoryItem
	OutMessage            *MessageItem
	SchedulerEvent        *SchedulerEvent
	RelationshipStateJSON *string
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
	}

	if err := s.initSchema(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to initialize sqlite schema: %w", err)
	}

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

	CREATE TABLE IF NOT EXISTS relationship_states (
		session_id TEXT PRIMARY KEY,
		state_json TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	`
	_, err := s.db.Exec(schema)
	return err
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
	return err
}

// CloseMemoryVersion marks a specific memory version as superseded by setting valid_to timestamp in-place.
func (s *Storage) CloseMemoryVersion(id string, validTo string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	query := `UPDATE memories SET valid_to = ? WHERE id = ?;`
	_, err := s.db.Exec(query, validTo, id)
	return err
}

// CloseSupersededMemories marks any active memories with the matching key as superseded.
func (s *Storage) CloseSupersededMemories(personaID, key, validTo string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	query := `UPDATE memories SET valid_to = ? WHERE (persona_id = ? OR ? = '') AND key = ? AND valid_to IS NULL;`
	_, err := s.db.Exec(query, validTo, personaID, personaID, key)
	return err
}

func (s *Storage) QueryMemories(personaID, layer string) []MemoryItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query := `SELECT id, persona_id, layer, category, key, value, importance_score, valid_from, valid_to, confidence, created_at
	          FROM memories
	          WHERE (? = '' OR persona_id = ?) AND (? = '' OR layer = ?)
	          ORDER BY created_at ASC`
	rows, err := s.db.Query(query, personaID, personaID, layer, layer)
	if err != nil {
		return make([]MemoryItem, 0)
	}
	defer rows.Close()

	res := make([]MemoryItem, 0)
	for rows.Next() {
		var m MemoryItem
		var validTo sql.NullString
		if err := rows.Scan(&m.ID, &m.PersonaID, &m.Layer, &m.Category, &m.Key, &m.Value, &m.ImportanceScore, &m.ValidFrom, &validTo, &m.Confidence, &m.CreatedAt); err == nil {
			if validTo.Valid {
				val := validTo.String
				m.ValidTo = &val
			}
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
	return err
}

func (s *Storage) GetRecentMessages(sessionID string, limit int) []MessageItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query := `SELECT id, session_id, persona_id, user_id, sender, content, timestamp, COALESCE(reply_to_id, ''), latency_ms
	          FROM messages
	          WHERE (? = '' OR session_id = ?)
	          ORDER BY timestamp DESC, rowid DESC LIMIT ?`
	rows, err := s.db.Query(query, sessionID, sessionID, limit)
	if err != nil {
		return make([]MessageItem, 0)
	}
	defer rows.Close()

	var desc []MessageItem
	for rows.Next() {
		var m MessageItem
		if err := rows.Scan(&m.ID, &m.SessionID, &m.PersonaID, &m.UserID, &m.Sender, &m.Content, &m.Timestamp, &m.ReplyToID, &m.LatencyMs); err == nil {
			desc = append(desc, m)
		}
	}

	res := make([]MessageItem, len(desc))
	for i, m := range desc {
		res[len(desc)-1-i] = m
	}
	return res
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
	return err
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

		// Update or create session
		sessQuery := `INSERT INTO sessions (id, persona_id, user_id, start_time, last_active_time, message_count)
		              VALUES (?, ?, ?, ?, ?, 1)
		              ON CONFLICT(id) DO UPDATE SET
		                  last_active_time = excluded.last_active_time,
		                  message_count = sessions.message_count + 1;`
		_, _ = sqlTx.Exec(sessQuery, tx.InMessage.SessionID, tx.InMessage.PersonaID, tx.InMessage.UserID, now, now)
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

		sessQuery := `INSERT INTO sessions (id, persona_id, user_id, start_time, last_active_time, message_count)
		              VALUES (?, ?, ?, ?, ?, 1)
		              ON CONFLICT(id) DO UPDATE SET
		                  last_active_time = excluded.last_active_time,
		                  message_count = sessions.message_count + 1;`
		_, _ = sqlTx.Exec(sessQuery, tx.OutMessage.SessionID, tx.OutMessage.PersonaID, tx.OutMessage.UserID, now, now)
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
	}

	// 5. RelationshipState (L4 State persistence in atomic transaction)
	if tx.RelationshipStateJSON != nil && *tx.RelationshipStateJSON != "" && tx.InMessage != nil {
		relQuery := `
		INSERT INTO relationship_states (session_id, state_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET
			state_json = excluded.state_json,
			updated_at = excluded.updated_at;
		`
		if _, err := sqlTx.Exec(relQuery, tx.InMessage.SessionID, *tx.RelationshipStateJSON, now); err != nil {
			return fmt.Errorf("transaction upsert relationship_state error: %w", err)
		}
	}

	if err := sqlTx.Commit(); err != nil {
		return fmt.Errorf("failed to commit interaction transaction: %w", err)
	}
	sqlTx = nil

	return nil
}

func (s *Storage) SaveRelationshipState(sessionID, stateJSON string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	query := `
	INSERT INTO relationship_states (session_id, state_json, updated_at)
	VALUES (?, ?, ?)
	ON CONFLICT(session_id) DO UPDATE SET
		state_json = excluded.state_json,
		updated_at = excluded.updated_at;
	`
	_, err := s.db.Exec(query, sessionID, stateJSON, now)
	return err
}

func (s *Storage) GetRelationshipState(sessionID string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var stateJSON string
	err := s.db.QueryRow(`SELECT state_json FROM relationship_states WHERE session_id = ?`, sessionID).Scan(&stateJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", err
	}
	return stateJSON, nil
}

func (s *Storage) Log(subsystem, level, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	_, _ = s.db.Exec(`INSERT INTO audit_logs (subsystem, level, message, timestamp) VALUES (?, ?, ?, ?);`, subsystem, level, message, now)
}

func (s *Storage) GetLogs(limit int) []LogItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query := `SELECT id, subsystem, level, message, timestamp FROM audit_logs ORDER BY id DESC LIMIT ?`
	rows, err := s.db.Query(query, limit)
	if err != nil {
		return make([]LogItem, 0)
	}
	defer rows.Close()

	var desc []LogItem
	for rows.Next() {
		var l LogItem
		if err := rows.Scan(&l.ID, &l.Subsystem, &l.Level, &l.Message, &l.Timestamp); err == nil {
			desc = append(desc, l)
		}
	}

	res := make([]LogItem, len(desc))
	for i, l := range desc {
		res[len(desc)-1-i] = l
	}
	return res
}

func (s *Storage) GetStats() Stats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var stats Stats
	_ = s.db.QueryRow(`SELECT count(*) FROM memories`).Scan(&stats.TotalMemories)
	_ = s.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&stats.TotalSessions)
	_ = s.db.QueryRow(`SELECT count(*) FROM messages`).Scan(&stats.TotalMessages)
	_ = s.db.QueryRow(`SELECT count(*) FROM memories WHERE layer='L0'`).Scan(&stats.L0Count)
	_ = s.db.QueryRow(`SELECT count(*) FROM memories WHERE layer='L1'`).Scan(&stats.L1Count)
	_ = s.db.QueryRow(`SELECT count(*) FROM memories WHERE layer='L2'`).Scan(&stats.L2Count)
	_ = s.db.QueryRow(`SELECT count(*) FROM memories WHERE layer='L3'`).Scan(&stats.L3Count)
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
