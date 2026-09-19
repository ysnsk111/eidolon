package telegram

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"eidolon/server/internal/runtime"
	"eidolon/server/internal/storage"
)

type Config struct {
	Token         string   `json:"token"`
	AllowedUsers  []string `json:"allowed_users"`
	PollTimeout   int      `json:"poll_timeout"`
	SimulateTyping bool    `json:"simulate_typing"`
}

type BotService struct {
	cfg          Config
	orch         *runtime.Orchestrator
	store        *storage.Storage
	allowedUsers map[string]bool
	client       *http.Client
	stopCh       chan struct{}
	wg           sync.WaitGroup
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
		cfg:          cfg,
		orch:         orch,
		store:        store,
		allowedUsers: allowedMap,
		client:       &http.Client{Timeout: 45 * time.Second},
		stopCh:       make(chan struct{}),
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

			// Section 44: Telegram User Matching allowlist
			if !b.allowedUsers[userIDStr] {
				// Silently ignore unauthorized users
				b.store.Log("telegram", "WARN", fmt.Sprintf("Ignored message from unauthorized user: %s", userIDStr))
				continue
			}

			// Process message in goroutine
			go b.handleIncoming(u.Message)
		}
	}
}

func (b *BotService) handleIncoming(msg *Message) {
	userIDStr := strconv.FormatInt(msg.From.ID, 10)
	sessionID := fmt.Sprintf("tg_chat_%d", msg.Chat.ID)

	b.store.Log("telegram", "INFO", fmt.Sprintf("Received message from allowed user %s: %s", userIDStr, msg.Text))

	res, err := b.orch.ProcessMessage(sessionID, userIDStr, msg.Text)
	if err != nil {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("Orchestrator error: %v", err))
		return
	}

	// Section 46 & 47: Simulate realistic human typing delay
	if b.cfg.SimulateTyping && res.Schedule.TypingDurationMs > 0 {
		_ = b.sendChatAction(msg.Chat.ID, "typing")
		time.Sleep(time.Duration(res.Schedule.TypingDurationMs) * time.Millisecond)
	} else if res.Schedule.TotalDelayMs > 0 {
		time.Sleep(time.Duration(res.Schedule.TotalDelayMs) * time.Millisecond)
	}

	// Section 45: Zero streaming - send single complete message
	if res.Schedule.ShouldDoubleMessage && res.Schedule.DoubleMessagePart1 != "" {
		_ = b.sendMessage(msg.Chat.ID, res.Schedule.DoubleMessagePart1, msg.MessageID)
		time.Sleep(1200 * time.Millisecond)
		_ = b.sendMessage(msg.Chat.ID, res.Schedule.DoubleMessagePart2, 0)
	} else {
		_ = b.sendMessage(msg.Chat.ID, res.FinalMessage, msg.MessageID)
	}
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
		return err
	}
	defer resp.Body.Close()
	_, _ = io.ReadAll(resp.Body)
	return nil
}
