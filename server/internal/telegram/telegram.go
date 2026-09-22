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
	Token          string        `json:"token"`
	AllowedUsers   []string      `json:"allowed_users"`
	PollTimeout    int           `json:"poll_timeout"`
	SimulateTyping bool          `json:"simulate_typing"`
	LogSalt        string        `json:"log_salt"`
	ConfigPath     string        `json:"config_path"`
	DebounceWindow time.Duration `json:"debounce_window,omitempty"`
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

	distillMu             sync.Mutex
	isDistilling          bool
	distillChatID         int64
	preparationMessageIDs []int
	pairedUserID          string
	pairedChatID          int64
	isPaired              bool
}

type Update struct {
	UpdateID int      `json:"update_id"`
	Message  *Message `json:"message"`
}

type Message struct {
	MessageID      int      `json:"message_id"`
	From           *User    `json:"from"`
	Chat           *Chat    `json:"chat"`
	Date           int      `json:"date"`
	Text           string   `json:"text"`
	ReplyToMessage *Message `json:"reply_to_message,omitempty"`
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

	var initialChatID int64
	var initialUserID string
	if len(cfg.AllowedUsers) > 0 {
		initialUserID = cfg.AllowedUsers[0]
		if cid, err := strconv.ParseInt(initialUserID, 10, 64); err == nil {
			initialChatID = cid
		}
	}

	return &BotService{
		cfg:                   cfg,
		orch:                  orch,
		store:                 store,
		allowedUsers:          allowedMap,
		client:                &http.Client{Timeout: 45 * time.Second},
		stopCh:                make(chan struct{}),
		sessionQueues:         make(map[int64]chan *Message),
		pairedUserID:          initialUserID,
		pairedChatID:          initialChatID,
		distillChatID:         initialChatID,
		preparationMessageIDs: make([]int, 0),
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
			lowerText := strings.ToLower(trimmedText)
			isStartCmd := lowerText == "/start" || strings.HasPrefix(lowerText, "/start ") || strings.HasPrefix(lowerText, "/start@")

			// Check user authorization; allow /start commands through to immediately trigger pairing
			if isStartCmd {
				b.allowUser(userIDStr)
			} else if !b.isUserAllowed(userIDStr) {
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

func isImmediateMessage(msg *Message, distilling bool) bool {
	if distilling {
		return true
	}
	if msg == nil {
		return false
	}
	trimmedText := strings.TrimSpace(msg.Text)
	lowerText := strings.ToLower(trimmedText)
	if lowerText == "/start" || strings.HasPrefix(lowerText, "/start ") || strings.HasPrefix(lowerText, "/start@") {
		return true
	}
	if strings.HasPrefix(lowerText, "/status") || strings.HasPrefix(lowerText, "/pair") {
		return true
	}
	return false
}

func isQuestionMessage(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	if strings.Contains(trimmed, "?") || strings.Contains(trimmed, "？") {
		return true
	}
	lower := strings.ToLower(trimmed)
	interrogatives := []string{
		"吗", "嘛", "呢", "啥", "什么", "怎么", "怎样", "如何",
		"哪里", "哪儿", "哪个", "哪家", "几点", "什么时候",
		"为什么", "为啥", "多少", "谁", "是不是", "能不能",
		"要不要", "行不行", "有没有", "会不会", "可不可以", "好不好",
	}
	for _, term := range interrogatives {
		if strings.Contains(lower, term) {
			return true
		}
	}
	enPrefixes := []string{"what", "why", "where", "when", "who", "which", "how", "is", "are", "can", "could", "would", "will", "do", "does", "did"}
	fields := strings.Fields(lower)
	if len(fields) > 0 {
		first := strings.Trim(fields[0], "!.,;:")
		for _, p := range enPrefixes {
			if first == p {
				return true
			}
		}
	}
	return false
}

func findTargetedQuestion(questions []*Message, responseText string) int {
	if len(questions) < 2 {
		return 0
	}

	cleanPunctuation := func(s string) string {
		var b strings.Builder
		for _, r := range s {
			if strings.ContainsRune("?？!！。，,.~… \t\n\r/\\-+=", r) {
				b.WriteRune(' ')
				continue
			}
			b.WriteRune(r)
		}
		return b.String()
	}

	cleanResponse := strings.ToLower(cleanPunctuation(responseText))

	type scoredQ struct {
		msgID int
		score int
	}
	scores := make([]scoredQ, 0, len(questions))

	stopwords := map[string]bool{
		"吗": true, "嘛": true, "呢": true, "吧": true, "呀": true, "啊": true,
		"啥": true, "什么": true, "怎么": true, "怎样": true, "如何": true,
		"哪里": true, "哪儿": true, "哪个": true, "哪家": true, "什么时候": true,
		"为什么": true, "为啥": true, "是不是": true, "能不能": true, "要不要": true,
		"行不行": true, "有没有": true, "会不会": true, "可不可以": true, "好不好": true,
		"你": true, "我": true, "他": true, "她": true, "它": true, "的": true, "了": true,
		"what": true, "why": true, "where": true, "when": true, "who": true, "which": true,
		"how": true, "is": true, "are": true, "the": true, "a": true, "an": true, "to": true,
		"do": true, "does": true, "did": true, "can": true, "could": true, "would": true,
	}

	for _, q := range questions {
		qClean := strings.ToLower(cleanPunctuation(q.Text))
		score := 0

		// English / whitespace-separated words
		words := strings.Fields(qClean)
		for _, w := range words {
			if len(w) >= 3 && !stopwords[w] {
				if strings.Contains(cleanResponse, w) {
					score += 3
				}
			}
		}

		// Chinese CJK bigrams and characters
		noSpaceQ := strings.ReplaceAll(qClean, " ", "")
		runes := []rune(noSpaceQ)
		for i := 0; i < len(runes)-1; i++ {
			bigram := string(runes[i : i+2])
			if !stopwords[bigram] && strings.Contains(cleanResponse, bigram) {
				score += 3
			}
		}
		for _, r := range runes {
			charStr := string(r)
			if !stopwords[charStr] && strings.Contains(cleanResponse, charStr) {
				score += 1
			}
		}

		scores = append(scores, scoredQ{msgID: q.MessageID, score: score})
	}

	bestID := 0
	highestScore := 0
	secondHighest := 0

	for _, sq := range scores {
		if sq.score > highestScore {
			secondHighest = highestScore
			highestScore = sq.score
			bestID = sq.msgID
		} else if sq.score > secondHighest {
			secondHighest = sq.score
		}
	}

	if highestScore >= 3 && highestScore > secondHighest {
		return bestID
	}

	return 0
}

func (b *BotService) determineQuoteTarget(burst []*Message, res *runtime.GenerationResult) int {
	if len(burst) == 0 {
		return 0
	}

	// Priority 0: Explicit Orchestrator quote target if set
	if res != nil && res.TargetQuoteMsgID > 0 {
		return res.TargetQuoteMsgID
	}

	// Priority 1: Explicit earlier referenced turn (user quote-replied to an earlier message)
	for _, m := range burst {
		if m != nil && m.ReplyToMessage != nil {
			return m.MessageID
		}
	}

	// Priority 2: Multi-question burst targeting
	var questions []*Message
	for _, m := range burst {
		if m != nil && isQuestionMessage(m.Text) {
			questions = append(questions, m)
		}
	}

	if len(questions) >= 2 && res != nil {
		if targetID := findTargetedQuestion(questions, res.FinalMessage); targetID > 0 {
			return targetID
		}
	}

	// Rule 1: Default to direct send (zero quote-replying for standard dialogue turns)
	return 0
}

func (b *BotService) sessionWorker(chatID int64, ch chan *Message) {
	defer b.wg.Done()

	debounceDuration := 3500 * time.Millisecond
	if b.cfg.DebounceWindow > 0 {
		debounceDuration = b.cfg.DebounceWindow
	}
	maxWindow := 10 * time.Second

	var burst []*Message
	var timer *time.Timer
	var timerC <-chan time.Time
	var burstStart time.Time

	flushBurst := func() {
		if len(burst) == 0 {
			return
		}
		toProcess := burst
		burst = nil
		if timer != nil {
			timer.Stop()
			timerC = nil
		}
		b.processDialogueTurn(toProcess)
	}

	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				flushBurst()
				return
			}

			b.distillMu.Lock()
			distilling := b.isDistilling
			b.distillMu.Unlock()

			if isImmediateMessage(msg, distilling) {
				flushBurst()
				b.handleIncoming(msg)
				continue
			}

			// Dialogue message: add to burst debounce buffer
			if len(burst) == 0 {
				burstStart = time.Now()
				burst = append(burst, msg)
				timer = time.NewTimer(debounceDuration)
				timerC = timer.C
			} else {
				burst = append(burst, msg)
				if time.Since(burstStart) >= maxWindow {
					flushBurst()
				} else {
					if !timer.Stop() {
						select {
						case <-timer.C:
						default:
						}
					}
					timer.Reset(debounceDuration)
					timerC = timer.C
				}
			}

		case <-timerC:
			flushBurst()

		case <-b.stopCh:
			flushBurst()
			for {
				select {
				case msg := <-ch:
					b.distillMu.Lock()
					distilling := b.isDistilling
					b.distillMu.Unlock()
					if isImmediateMessage(msg, distilling) {
						b.handleIncoming(msg)
					} else {
						burst = append(burst, msg)
					}
				default:
					flushBurst()
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
	lowerText := strings.ToLower(trimmedText)
	isStartCmd := lowerText == "/start" || strings.HasPrefix(lowerText, "/start ") || strings.HasPrefix(lowerText, "/start@")

	// Distillation In-Progress Interceptor:
	// Requirement: "蒸馏过程启动后在telegram机器人实时汇报蒸馏进度（此期间收到任何消息（命令或消息）自动发送提示please wait)"
	b.distillMu.Lock()
	distilling := b.isDistilling
	b.distillMu.Unlock()

	if distilling {
		b.store.Log("telegram", "INFO", fmt.Sprintf("Received message during distillation session=%s: auto-replying please wait", sessionID))
		replyID, err := b.sendMessage(msg.Chat.ID, "⏳ 正在进行蒸馏，请稍候... (Please wait)", msg.MessageID)
		b.distillMu.Lock()
		if err == nil && replyID > 0 {
			b.preparationMessageIDs = append(b.preparationMessageIDs, replyID)
		}
		b.preparationMessageIDs = append(b.preparationMessageIDs, msg.MessageID)
		b.distillMu.Unlock()
		return
	}

	// Command Handler: /start (Startup Pairing Command)
	// Automatically pairs user, deletes user's /start message, and outputs nothing redundant ("无其他多余").
	if isStartCmd {
		// 1. Perform Pairing: add user to allowed list & persist config
		b.allowUser(userIDStr)
		b.distillMu.Lock()
		b.isPaired = true
		b.pairedUserID = userIDStr
		b.pairedChatID = msg.Chat.ID
		b.distillChatID = msg.Chat.ID
		b.preparationMessageIDs = append(b.preparationMessageIDs, msg.MessageID)
		b.distillMu.Unlock()

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
		statID, _ := b.sendMessage(msg.Chat.ID, statusText, msg.MessageID)
		b.distillMu.Lock()
		if statID > 0 {
			b.preparationMessageIDs = append(b.preparationMessageIDs, statID)
		}
		b.preparationMessageIDs = append(b.preparationMessageIDs, msg.MessageID)
		b.distillMu.Unlock()
		return
	}

	// Regular message fallback if called directly
	b.processDialogueTurn([]*Message{msg})
}

func (b *BotService) processDialogueTurn(burst []*Message) {
	if len(burst) == 0 {
		return
	}

	firstMsg := burst[0]
	userIDStr := strconv.FormatInt(firstMsg.From.ID, 10)
	sessionID := fmt.Sprintf("tg_chat_%d", firstMsg.Chat.ID)

	var textParts []string
	for _, m := range burst {
		if m == nil {
			continue
		}
		t := strings.TrimSpace(m.Text)
		if t != "" {
			textParts = append(textParts, t)
		}
	}
	coalescedText := strings.Join(textParts, "\n")
	if coalescedText == "" {
		return
	}

	res, err := b.orch.ProcessMessage(sessionID, userIDStr, coalescedText)
	if err != nil {
		b.store.Log("telegram", "ERROR", fmt.Sprintf("Orchestrator error session=%s: %v", sessionID, err))
		if strings.Contains(err.Error(), "no active persona") {
			_, _ = b.sendMessage(firstMsg.Chat.ID, "⚠️ EIDOLON 当前尚未激活人格模型。\n请在控制台执行 `eidolon persona activate <persona_id>` 激活人格后再与我对话。", firstMsg.MessageID)
		}
		return
	}

	// Dynamic Human-like Lifecycle Timing (Sections 7, 8, 9, R4):
	totalDelay := res.Schedule.TotalDelayMs
	typingDuration := res.Schedule.TypingDurationMs
	if totalDelay < 0 {
		totalDelay = 0
	}
	if typingDuration > totalDelay {
		typingDuration = totalDelay
	}
	readingDelay := totalDelay - typingDuration

	// Phase 1: Reading/thinking delay (silent, no typing indicator: 25% - 35% of total delay)
	if readingDelay > 0 {
		time.Sleep(time.Duration(readingDelay) * time.Millisecond)
	}

	// Phase 2: Typing Simulation (send typing action, refresh every 4s if long typing: 65% - 75% of total delay)
	if b.cfg.SimulateTyping && typingDuration > 0 {
		remaining := typingDuration
		for remaining > 0 {
			_ = b.sendChatAction(firstMsg.Chat.ID, "typing")
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

	// Intelligent Contextual Quote-Replying:
	// Default to 0 (direct send without quote-reply banner).
	// Only set > 0 if explicit quote reference or multi-question burst targeted.
	quoteTargetMsgID := b.determineQuoteTarget(burst, res)

	// Phase 3: Complete message dispatch (with multi-message & double-message support)
	var lastSentID int
	if len(res.Schedule.Parts) > 1 {
		for i, part := range res.Schedule.Parts {
			replyID := 0
			if i == 0 {
				replyID = quoteTargetMsgID
			}
			id, err := b.sendMessage(firstMsg.Chat.ID, part, replyID)
			if err == nil {
				lastSentID = id
			}
			if i < len(res.Schedule.Parts)-1 {
				gapMs := 1000
				if len(res.Schedule.InterMessageGapsMs) > i && res.Schedule.InterMessageGapsMs[i] > 0 {
					gapMs = res.Schedule.InterMessageGapsMs[i]
				}
				if b.cfg.SimulateTyping {
					_ = b.sendChatAction(firstMsg.Chat.ID, "typing")
				}
				time.Sleep(time.Duration(gapMs) * time.Millisecond)
			}
		}
	} else if res.Schedule.ShouldDoubleMessage && res.Schedule.DoubleMessagePart1 != "" {
		id1, _ := b.sendMessage(firstMsg.Chat.ID, res.Schedule.DoubleMessagePart1, quoteTargetMsgID)
		lastSentID = id1
		if b.cfg.SimulateTyping {
			_ = b.sendChatAction(firstMsg.Chat.ID, "typing")
		}
		time.Sleep(1200 * time.Millisecond)
		id2, _ := b.sendMessage(firstMsg.Chat.ID, res.Schedule.DoubleMessagePart2, 0)
		lastSentID = id2
	} else {
		id, _ := b.sendMessage(firstMsg.Chat.ID, res.FinalMessage, quoteTargetMsgID)
		lastSentID = id
	}

	// Phase 4: PostSendBehavior (Retraction / Regret / 先发后悔 - Sections 12 & 13)
	if res.Plan.ShouldDelete && lastSentID > 0 {
		delay := res.Plan.DeleteDelayMs
		if delay <= 0 {
			delay = 1800
		}
		time.Sleep(time.Duration(delay) * time.Millisecond)
		_ = b.deleteMessage(firstMsg.Chat.ID, lastSentID)
		b.store.Log("telegram", "INFO", fmt.Sprintf("Post-send regret triggered: deleted message id=%d chat=%d", lastSentID, firstMsg.Chat.ID))
		if res.Plan.FollowupText != "" {
			time.Sleep(600 * time.Millisecond)
			_, _ = b.sendMessage(firstMsg.Chat.ID, res.Plan.FollowupText, 0)
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

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := b.client.Post(url, "application/json", bytes.NewBuffer(payload))
		if err != nil {
			lastErr = err
			b.store.Log("telegram", "WARN", fmt.Sprintf("deleteMessage attempt %d network error chat=%d msg=%d: %v", attempt+1, chatID, messageID, err))
			time.Sleep(300 * time.Millisecond)
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			return nil
		}

		// 400 Bad Request indicates message is already deleted or not found; treat as resolved
		if resp.StatusCode == http.StatusBadRequest {
			b.store.Log("telegram", "INFO", fmt.Sprintf("deleteMessage chat=%d msg=%d: already deleted or not found (HTTP 400)", chatID, messageID))
			return nil
		}

		b.store.Log("telegram", "WARN", fmt.Sprintf("deleteMessage HTTP %d chat=%d msg=%d: %s", resp.StatusCode, chatID, messageID, string(body)))
		lastErr = fmt.Errorf("telegram API deleteMessage HTTP %d", resp.StatusCode)
		time.Sleep(300 * time.Millisecond)
	}
	return lastErr
}

func (b *BotService) GetPairingStatus() map[string]interface{} {
	b.distillMu.Lock()
	defer b.distillMu.Unlock()
	return map[string]interface{}{
		"paired":  b.isPaired,
		"user_id": b.pairedUserID,
		"chat_id": b.pairedChatID,
	}
}

func (b *BotService) resolveTargetChatID(chatID int64) int64 {
	if chatID != 0 {
		b.distillChatID = chatID
		return chatID
	}
	if b.distillChatID != 0 {
		return b.distillChatID
	}
	if b.pairedChatID != 0 {
		b.distillChatID = b.pairedChatID
		return b.pairedChatID
	}
	if len(b.cfg.AllowedUsers) > 0 {
		if id, err := strconv.ParseInt(b.cfg.AllowedUsers[0], 10, 64); err == nil {
			b.distillChatID = id
			return id
		}
	}
	if b.cfg.ConfigPath != "" {
		if data, err := os.ReadFile(b.cfg.ConfigPath); err == nil {
			var rawMap map[string]interface{}
			if err := json.Unmarshal(data, &rawMap); err == nil {
				if botMap, ok := rawMap["bot"].(map[string]interface{}); ok {
					if users, ok := botMap["allowedUsers"].([]interface{}); ok && len(users) > 0 {
						if cid, err := strconv.ParseInt(fmt.Sprintf("%v", users[0]), 10, 64); err == nil {
							b.distillChatID = cid
							return cid
						}
					}
				}
			}
		}
	}
	return 0
}

func (b *BotService) StartDistillation(chatID int64) {
	b.distillMu.Lock()
	b.isDistilling = true
	targetChatID := b.resolveTargetChatID(chatID)
	b.distillMu.Unlock()

	b.store.Log("telegram", "INFO", fmt.Sprintf("Distillation started for chat_id=%d", targetChatID))
	if targetChatID != 0 {
		msgID, err := b.sendMessage(targetChatID, "⏳ [EIDOLON] 开始人格蒸馏流程...", 0)
		if err == nil && msgID > 0 {
			b.distillMu.Lock()
			b.preparationMessageIDs = append(b.preparationMessageIDs, msgID)
			b.distillMu.Unlock()
		}
	}
}

func (b *BotService) ReportDistillationProgress(stage, totalStages int, message string, chatID ...int64) {
	b.distillMu.Lock()
	var passedID int64
	if len(chatID) > 0 {
		passedID = chatID[0]
	}
	targetChatID := b.resolveTargetChatID(passedID)
	b.distillMu.Unlock()

	b.store.Log("telegram", "INFO", fmt.Sprintf("Distillation progress [%d/%d]: %s (chat_id=%d)", stage, totalStages, message, targetChatID))
	if targetChatID != 0 {
		text := fmt.Sprintf("🔄 [进度 %d/%d] %s", stage, totalStages, message)
		msgID, err := b.sendMessage(targetChatID, text, 0)
		if err == nil && msgID > 0 {
			b.distillMu.Lock()
			b.preparationMessageIDs = append(b.preparationMessageIDs, msgID)
			b.distillMu.Unlock()
		}
	}
}

func (b *BotService) FinishDistillation(personaID string, dsiScore float64, chatID ...int64) {
	b.distillMu.Lock()
	b.isDistilling = false
	var passedID int64
	if len(chatID) > 0 {
		passedID = chatID[0]
	}
	targetChatID := b.resolveTargetChatID(passedID)

	prepIDs := make([]int, len(b.preparationMessageIDs))
	copy(prepIDs, b.preparationMessageIDs)
	b.preparationMessageIDs = nil
	b.distillMu.Unlock()

	// 1. ALL-CLEAR: Delete all preparation, progress, and please-wait messages!
	// Requirement: "蒸馏完成后删除前面的一切前期准备消息（all-clear），然后正式进入蒸馏后人格模式。"
	// Deduplicate message IDs to avoid redundant Telegram API delete requests
	seenIDs := make(map[int]bool)
	var uniquePrepIDs []int
	for _, msgID := range prepIDs {
		if msgID > 0 && !seenIDs[msgID] {
			seenIDs[msgID] = true
			uniquePrepIDs = append(uniquePrepIDs, msgID)
		}
	}

	b.store.Log("telegram", "INFO", fmt.Sprintf("Distillation finished. Performing all-clear deletion of %d messages...", len(uniquePrepIDs)))
	if targetChatID != 0 {
		for _, msgID := range uniquePrepIDs {
			_ = b.deleteMessage(targetChatID, msgID)
			time.Sleep(50 * time.Millisecond)
		}
	}

	// 2. Load and activate distilled persona
	if personaID != "" {
		if loaded, err := b.orch.GetPersonaManager().LoadPersona(personaID); err == nil {
			b.store.Log("telegram", "INFO", fmt.Sprintf("Activated distilled persona: %s (%s)", loaded.Persona.Name, personaID))
			schedCfg := loaded.GetSchedulerConfig()
			b.orch.GetScheduler().UpdateConfig(schedCfg)
			b.persistActivePersona(personaID)
		} else {
			b.store.Log("telegram", "WARN", fmt.Sprintf("Failed to load persona %s from disk: %v", personaID, err))
		}
	}

	// 3. Officially enter distilled persona mode!
	// Send first natural greeting in character
	greeting := "好啦，我在呢~"
	if targetChatID != 0 {
		_, _ = b.sendMessage(targetChatID, greeting, 0)
	}
}

func (b *BotService) HandleDistillProgress(event string, stage, totalStages int, message, personaID string, dsi float64, chatID int64) {
	switch strings.ToLower(event) {
	case "start":
		b.StartDistillation(chatID)
	case "progress":
		b.ReportDistillationProgress(stage, totalStages, message, chatID)
	case "complete":
		b.FinishDistillation(personaID, dsi, chatID)
	}
}

func (b *BotService) persistActivePersona(personaID string) {
	if b.cfg.ConfigPath == "" {
		return
	}
	data, err := os.ReadFile(b.cfg.ConfigPath)
	if err != nil {
		return
	}

	var rawMap map[string]interface{}
	if err := json.Unmarshal(data, &rawMap); err != nil {
		return
	}

	rawMap["activePersona"] = personaID
	if updatedBytes, err := json.MarshalIndent(rawMap, "", "  "); err == nil {
		_ = os.WriteFile(b.cfg.ConfigPath, updatedBytes, 0600)
		b.store.Log("telegram", "INFO", fmt.Sprintf("Persisted active persona to config file at %s: %s", b.cfg.ConfigPath, personaID))
	}
}

