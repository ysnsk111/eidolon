package telegram

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"eidolon/server/internal/runtime"
	"eidolon/server/internal/storage"
)

type Config struct {
	Token          string   `json:"token"`
	AllowedUsers   []string `json:"allowed_users"`
	PollTimeout    int      `json:"poll_timeout"`
	SimulateTyping bool     `json:"simulate_typing"`
	LogSalt        string   `json:"log_salt"`
	ConfigPath     string   `json:"config_path"`
}

type BotService struct {
	cfg            Config
	orch           *runtime.Orchestrator
	store          *storage.Storage
	allowedUsersMu sync.RWMutex
	allowedUsers   map[string]bool
	client         *http.Client
	stopCh         chan struct{}
	wg             sync.WaitGroup
	queuesMu       sync.Mutex
	sessionQueues  map[int64]chan *Message
}

type Update struct {
	UpdateID int      `json:"update_id"`
	Message  *Message `json:"message"`
}

type Message struct {
	MessageID int    `json:"message_id"`
	From      *User  `json:"from"`
	Chat      *Chat  `json:"chat"`
	Date      int    `json:"date"`
	Text      string `json:"text"`
}

type User struct {
	ID        int64  `json:"id"`
	FirstName string `json:"first_name"`
	Username  string `json:"username"`
}

type Chat struct {
	ID int64 `json:"id"`
}

func NewBotService(cfg Config, orch *runtime.Orchestrator, store *storage.Storage) *BotService {
	allowedMap := make(map[string]bool)
	for _, u := range cfg.AllowedUsers {
		allowedMap[u] = true
	}

	return &BotService{
		cfg:           cfg,
		orch:          orch,
		store:         store,
		allowedUsers:  allowedMap,
		client:        &http.Client{Timeout: 45 * time.Second},
		stopCh:        make(chan struct{}),
		sessionQueues: make(map[int64]chan *Message),
	}
}

func (b *BotService) SetHTTPClient(client *http.Client) {
	b.client = client
}

func (b *BotService) isUserAllowed(userIDStr string) bool {
	b.allowedUsersMu.RLock()
	defer b.allowedUsersMu.RUnlock()
	return b.allowedUsers[userIDStr]
}

func (b *BotService) allowUser(userIDStr string) {
	b.allowedUsersMu.Lock()
	alreadyAllowed := b.allowedUsers[userIDStr]
	b.allowedUsers[userIDStr] = true
	b.allowedUsersMu.Unlock()

	if alreadyAllowed {
		return
	}

	b.store.Log("telegram", "INFO", fmt.Sprintf("User paired successfully: %s", hashUserID(userIDStr, b.cfg.LogSalt)))

	if b.cfg.ConfigPath != "" {
		b.persistAllowedUser(userIDStr)
	}
}

func (b *BotService) persistAllowedUser(userIDStr string) {
	data, err := os.ReadFile(b.cfg.ConfigPath)
	if err != nil {
		return
	}

	var rawMap map[string]interface{}
	if err := json.Unmarshal(data, &rawMap); err != nil {
		return
	}

	botMap, ok := rawMap["bot"].(map[string]interface{})
	if !ok {
		botMap = make(map[string]interface{})
		rawMap["bot"] = botMap
	}

	existingAllowed, _ := botMap["allowedUsers"].([]interface{})
	exists := false
	var updatedList []string
	for _, item := range existingAllowed {
		str := fmt.Sprintf("%v", item)
		updatedList = append(updatedList, str)
		if str == userIDStr {
			exists = true
		}
	}
	if !exists {
		updatedList = append(updatedList, userIDStr)
		botMap["allowedUsers"] = updatedList
		if updatedBytes, err := json.MarshalIndent(rawMap, "", "  "); err == nil {
			_ = os.WriteFile(b.cfg.ConfigPath, updatedBytes, 0600)
			b.store.Log("telegram", "INFO", fmt.Sprintf("Persisted paired user to config file at %s", b.cfg.ConfigPath))
		}
	}
}

func (b *BotService) Start() error {
	if b.cfg.Token == "" {
		b.store.Log("telegram", "WARN", "Telegram token not configured, bot service inactive")
		return nil
	}

	b.store.Log("telegram", "INFO", "Starting Telegram long-polling service...")
	b.wg.Add(1)
	go b.pollLoop()
	return nil
}

func (b *BotService) Stop() {
	close(b.stopCh)
	b.wg.Wait()
	b.store.Log("telegram", "INFO", "Telegram service stopped")
}

func (b *BotService) pollLoop() {
	defer b.wg.Done()
	offset := 0

	for {
		select {
		case <-b.stopCh:
			return
		default:
		}

		updates, err := b.getUpdates(offset)
		if err != nil {
			time.Sleep(3 * time.Second)
			continue
		}

		for _, u := range updates {
			if u.UpdateID >= offset {
				offset = u.UpdateID + 1
			}

			if u.Message == nil || u.Message.From == nil || u.Message.Text == "" {
				continue
			}

			userIDStr := strconv.FormatInt(u.Message.From.ID, 10)
			trimmedText := strings.TrimSpace(u.Message.Text)
			isStartCmd := strings.HasPrefix(trimmedText, "/start")

			// Check user authorization; allow /start commands through to trigger pairing
			if !b.isUserAllowed(userIDStr) && !isStartCmd {
				b.store.Log("telegram", "WARN", "Ignored message from unauthorized user")
				continue
			}

			// P1: enqueue into per-session queue (sequential within chat)
			b.enqueueMessage(u.Message)
		}
	}
}

func (b *BotService) enqueueMessage(msg *Message) {
	chatID := msg.Chat.ID

	b.queuesMu.Lock()
	ch, exists := b.sessionQueues[chatID]
	if !exists {
		ch = make(chan *Message, 64)
		b.sessionQueues[chatID] = ch
		b.wg.Add(1)
		go b.sessionWorker(chatID, ch)
	}
	b.queuesMu.Unlock()

	select {
	case ch <- msg:
	default:
		b.store.Log("telegram", "WARN", "session queue full; dropping message")
	}
}

func (b *BotService) sessionWorker(chatID int64, ch chan *Message) {
	defer b.wg.Done()
	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return
			}
			b.handleIncoming(msg)
		case <-b.stopCh:
			for {
				select {
				case msg := <-ch:
					b.handleIncoming(msg)
				default:
					return
				}
			}
		}
	}
}

func (b *BotService) handleIncoming(msg *Message) {
	userIDStr := strconv.FormatInt(msg.From.ID, 10)
	sessionID := fmt.Sprintf("tg_chat_%d", msg.Chat.ID)

	// P1: log opaque hash instead of raw Telegram ID
	opaqueID := hashUserID(userIDStr, b.cfg.LogSalt)
	b.store.Log("telegram", "INFO", fmt.Sprintf("Received message session=%s user_hash=%s", sessionID, opaqueID))

	trimmedText := strings.TrimSpace(msg.Text)

	// Command Handler: /start (Startup Pairing Command)
	// Automatically pairs user, deletes user's /start message, and outputs nothing redundant ("无其他多余").
	if strings.HasPrefix(trimmedText, "/start") {
		// 1. Perform Pairing: add user to allowed list & persist config
		b.allowUser(userIDStr)

		// 2. Automatically delete user's /start command message
		if err := b.deleteMessage(msg.Chat.ID, msg.MessageID); err != nil {
			b.store.Log("telegram", "WARN", fmt.Sprintf("Failed to delete /start command message: %v", err))
		} else {
			b.store.Log("telegram", "INFO", fmt.Sprintf("Successfully deleted /start command message id=%d chat=%d", msg.MessageID, msg.Chat.ID))
		}

		// 3. "无其他多余" - Do not send any greeting or other messages
		return
	}

	// Command Handler: /status
	if strings.HasPrefix(trimmedText, "/status") {
		activeP := b.orch.GetPersonaManager().GetActivePersona()
		var statusText string
		if activeP != nil {
			statusText = fmt.Sprintf("📊 EIDOLON 运行时状态:\n• 激活人格: %s (%s)\n• 仿真输入模拟: %v\n• 会话 ID: %s",
				activeP.Persona.Name, activeP.ID, b.cfg.SimulateTyping, sessionID)
		} else {
			statusText = fmt.Sprintf("📊 EIDOLON 运行时状态:\n• 激活人格: 无 (待配置)\n• 仿真输入模拟: %v\n• 会话 ID: %s",
				b.cfg.SimulateTyping, sessionID)
		}
		_, _ = b.sendMessage(msg.Chat.ID, statusText, msg.MessageID)
		return
	}

	// Regular message orchestration
	res, err := b.orch.ProcessMessage(sessionID, userIDStr, msg.Text)
	if err != nil {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("Orchestrator error session=%s: %v", sessionID, err))
		if strings.Contains(err.Error(), "no active persona") {
			_, _ = b.sendMessage(msg.Chat.ID, "⚠️ EIDOLON 当前尚未激活人格模型。\n请在控制台执行 `eidolon persona activate <persona_id>` 激活人格后再与我对话。", msg.MessageID)
		}
		return
	}

	// Dynamic Human-like Lifecycle Timing (Sections 7, 8, 9):
	// Phase 1: Reading/thinking delay (no typing indicator)
	totalDelay := res.Schedule.TotalDelayMs
	typingDuration := res.Schedule.TypingDurationMs
	if totalDelay < 500 {
		totalDelay = 500
	}
	if typingDuration > totalDelay {
		typingDuration = totalDelay
	}
	readingDelay := totalDelay - typingDuration

	if readingDelay > 0 {
		time.Sleep(time.Duration(readingDelay) * time.Millisecond)
	}

	// Phase 2: Typing Simulation (send typing action, refresh every 4s if long typing)
	if b.cfg.SimulateTyping && typingDuration > 0 {
		remaining := typingDuration
		for remaining > 0 {
			_ = b.sendChatAction(msg.Chat.ID, "typing")
			step := 4000
			if remaining < step {
				step = remaining
			}
			time.Sleep(time.Duration(step) * time.Millisecond)
			remaining -= step
		}
	} else if totalDelay > 0 && readingDelay <= 0 {
		time.Sleep(time.Duration(totalDelay) * time.Millisecond)
	}

	// Phase 3: Complete message dispatch (with multi-message & double-message support)
	var lastSentID int
	if len(res.Schedule.Parts) > 1 {
		for i, part := range res.Schedule.Parts {
			replyID := 0
			if i == 0 {
				replyID = msg.MessageID
			}
			id, err := b.sendMessage(msg.Chat.ID, part, replyID)
			if err == nil {
				lastSentID = id
			}
			if i < len(res.Schedule.Parts)-1 {
				gapMs := 1000
				if len(res.Schedule.InterMessageGapsMs) > i && res.Schedule.InterMessageGapsMs[i] > 0 {
					gapMs = res.Schedule.InterMessageGapsMs[i]
				}
				if b.cfg.SimulateTyping {
					_ = b.sendChatAction(msg.Chat.ID, "typing")
				}
				time.Sleep(time.Duration(gapMs) * time.Millisecond)
			}
		}
	} else if res.Schedule.ShouldDoubleMessage && res.Schedule.DoubleMessagePart1 != "" {
		id1, _ := b.sendMessage(msg.Chat.ID, res.Schedule.DoubleMessagePart1, msg.MessageID)
		lastSentID = id1
		if b.cfg.SimulateTyping {
			_ = b.sendChatAction(msg.Chat.ID, "typing")
		}
		time.Sleep(1200 * time.Millisecond)
		id2, _ := b.sendMessage(msg.Chat.ID, res.Schedule.DoubleMessagePart2, 0)
		lastSentID = id2
	} else {
		id, _ := b.sendMessage(msg.Chat.ID, res.FinalMessage, msg.MessageID)
		lastSentID = id
	}

	// Phase 4: PostSendBehavior (Retraction / Regret / 先发后悔 - Sections 12 & 13)
	if res.Plan.ShouldDelete && lastSentID > 0 {
		delay := res.Plan.DeleteDelayMs
		if delay <= 0 {
			delay = 1800
		}
		time.Sleep(time.Duration(delay) * time.Millisecond)
		_ = b.deleteMessage(msg.Chat.ID, lastSentID)
		b.store.Log("telegram", "INFO", fmt.Sprintf("Post-send regret triggered: deleted message id=%d chat=%d", lastSentID, msg.Chat.ID))
		if res.Plan.FollowupText != "" {
			time.Sleep(600 * time.Millisecond)
			_, _ = b.sendMessage(msg.Chat.ID, res.Plan.FollowupText, 0)
		}
	}
}

func hashUserID(userID, salt string) string {
	if salt == "" {
		salt = "eidolon_default_privacy_salt"
	}
	mac := hmac.New(sha256.New, []byte(salt))
	mac.Write([]byte(userID))
	full := hex.EncodeToString(mac.Sum(nil))
	return "user_" + full[:12]
}

func (b *BotService) getUpdates(offset int) ([]Update, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/getUpdates?offset=%d&timeout=%d", b.cfg.Token, offset, b.cfg.PollTimeout)
	resp, err := b.client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result struct {
		OK     bool     `json:"ok"`
		Result []Update `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if !result.OK {
		return nil, fmt.Errorf("telegram API returned ok=false")
	}
	return result.Result, nil
}

func (b *BotService) sendChatAction(chatID int64, action string) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendChatAction", b.cfg.Token)
	payload, _ := json.Marshal(map[string]interface{}{
		"chat_id": chatID,
		"action":  action,
	})
	resp, err := b.client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	return nil
}

func (b *BotService) sendMessage(chatID int64, text string, replyToMsgID int) (int, error) {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", b.cfg.Token)
	reqMap := map[string]interface{}{
		"chat_id": chatID,
		"text":    text,
	}
	if replyToMsgID > 0 {
		reqMap["reply_parameters"] = map[string]interface{}{
			"message_id": replyToMsgID,
		}
	}

	payload, _ := json.Marshal(reqMap)
	resp, err := b.client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("sendMessage network error chat=%d: %v", chatID, err))
		return 0, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("sendMessage HTTP %d to chat=%d: %s", resp.StatusCode, chatID, string(body)))
		return 0, fmt.Errorf("telegram API HTTP %d", resp.StatusCode)
	}

	var resObj struct {
		OK     bool `json:"ok"`
		Result struct {
			MessageID int `json:"message_id"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &resObj); err == nil && resObj.OK {
		return resObj.Result.MessageID, nil
	}

	return 0, nil
}

func (b *BotService) deleteMessage(chatID int64, messageID int) error {
	url := fmt.Sprintf("https://api.telegram.org/bot%s/deleteMessage", b.cfg.Token)
	payload, _ := json.Marshal(map[string]interface{}{
		"chat_id":    chatID,
		"message_id": messageID,
	})
	resp, err := b.client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("deleteMessage network error chat=%d msg=%d: %v", chatID, messageID, err))
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		b.store.Log("telegram", "WARN", fmt.Sprintf("deleteMessage HTTP %d chat=%d msg=%d: %s", resp.StatusCode, chatID, messageID, string(body)))
		return fmt.Errorf("telegram API deleteMessage HTTP %d", resp.StatusCode)
	}
	return nil
}
