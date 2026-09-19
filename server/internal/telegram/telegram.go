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
}

type BotService struct {
	cfg           Config
	orch           *runtime.Orchestrator
	store         *storage.Storage
	allowedUsers  map[string]bool
	client        *http.Client
	stopCh        chan struct{}
	wg            sync.WaitGroup
	queuesMu      sync.Mutex
	sessionQueues map[int64]chan *Message
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
		orch:           orch,
		store:          store,
		allowedUsers:  allowedMap,
		client:        &http.Client{Timeout: 45 * time.Second},
		stopCh:        make(chan struct{}),
		sessionQueues: make(map[int64]chan *Message),
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

			if !b.allowedUsers[userIDStr] {
				// P1: do not log raw user IDs
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

	// Command Handler: /start
	if strings.HasPrefix(trimmedText, "/start") {
		activeP := b.orch.GetPersonaManager().GetActivePersona()
		var welcome string
		if activeP != nil {
			welcome = fmt.Sprintf("👋 你好！我是 %s。\n\n✨ EIDOLON 仿生记忆与人格运行时已激活\n• 人格包: %s\n• 仿真延时: 开启 (基于真实语料分布)\n• 记忆提取与持久化: 正常运行", activeP.Persona.Name, activeP.ID)
		} else {
			welcome = fmt.Sprintf("👋 你好！EIDOLON Telegram 机器人连接正常。\n\n• 用户鉴权: 已通过 (ID: %s)\n• 交互模式: 仿人类动态延时与输入模拟\n• 当前状态: 待配置 / 等待激活人格模型\n\n提示：在控制台上传语料并运行 `eidolon distill`，或执行 `eidolon persona activate <id>` 即可开始对话。", userIDStr)
		}
		_ = b.sendMessage(msg.Chat.ID, welcome, msg.MessageID)
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
		_ = b.sendMessage(msg.Chat.ID, statusText, msg.MessageID)
		return
	}

	// Regular message orchestration
	res, err := b.orch.ProcessMessage(sessionID, userIDStr, msg.Text)
	if err != nil {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("Orchestrator error session=%s: %v", sessionID, err))
		if strings.Contains(err.Error(), "no active persona") {
			_ = b.sendMessage(msg.Chat.ID, "⚠️ EIDOLON 当前尚未激活人格模型。\n请在控制台执行 `eidolon persona activate <persona_id>` 激活人格后再与我对话。", msg.MessageID)
		}
		return
	}

	// Dynamic Human-like Lifecycle Timing:
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

	// Phase 3: Complete message dispatch (with double message support)
	if res.Schedule.ShouldDoubleMessage && res.Schedule.DoubleMessagePart1 != "" {
		_ = b.sendMessage(msg.Chat.ID, res.Schedule.DoubleMessagePart1, msg.MessageID)
		if b.cfg.SimulateTyping {
			_ = b.sendChatAction(msg.Chat.ID, "typing")
		}
		time.Sleep(1200 * time.Millisecond)
		_ = b.sendMessage(msg.Chat.ID, res.Schedule.DoubleMessagePart2, 0)
	} else {
		_ = b.sendMessage(msg.Chat.ID, res.FinalMessage, msg.MessageID)
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

func (b *BotService) sendMessage(chatID int64, text string, replyToMsgID int) error {
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
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("sendMessage HTTP %d to chat=%d: %s", resp.StatusCode, chatID, string(body)))
		return fmt.Errorf("telegram API HTTP %d", resp.StatusCode)
	}
	return nil
}
