package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync/atomic"
	"time"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/relationship"
	"eidolon/server/internal/scheduler"
	"eidolon/server/internal/storage"
)

type LLMConfig struct {
	BaseURL     string  `json:"base_url"`
	APIKey      string  `json:"api_key"`
	Model       string  `json:"model"`
	Temperature float64 `json:"temperature"`
	TimeoutMs   int     `json:"timeout_ms"`
}

type Orchestrator struct {
	store      *storage.Storage
	personaMgr *persona.PersonaManager
	memoryEng  *memory.Engine
	sched      *scheduler.Scheduler
	relEngine  *relationship.Engine
	llmCfg     LLMConfig
	client     *http.Client
}

func NewOrchestrator(
	store *storage.Storage,
	personaMgr *persona.PersonaManager,
	memoryEng *memory.Engine,
	sched *scheduler.Scheduler,
	llmCfg LLMConfig,
) *Orchestrator {
	timeout := 15 * time.Second
	if llmCfg.TimeoutMs > 0 {
		timeout = time.Duration(llmCfg.TimeoutMs) * time.Millisecond
		if timeout < 5*time.Second {
			timeout = 5 * time.Second
		} else if timeout > 60*time.Second {
			timeout = 60 * time.Second
		}
	}

	return &Orchestrator{
		store:      store,
		personaMgr: personaMgr,
		memoryEng:  memoryEng,
		sched:      sched,
		relEngine:  relationship.NewEngine(),
		llmCfg:     llmCfg,
		client:     &http.Client{Timeout: timeout},
	}
}

func (o *Orchestrator) GetClientTimeout() time.Duration {
	if o.client == nil {
		return 0
	}
	return o.client.Timeout
}

func (o *Orchestrator) GetPersonaManager() *persona.PersonaManager {
	return o.personaMgr
}

func (o *Orchestrator) GetScheduler() *scheduler.Scheduler {
	return o.sched
}

func (o *Orchestrator) GetRelationshipEngine() *relationship.Engine {
	return o.relEngine
}

// CriticResult holds the output of the style critic pipeline.
// P0-9 Fix: critic_score is never fabricated; if not run, status is "not_run" and score is nil.
type CriticResult struct {
	Status        string   `json:"status"` // "completed" | "not_run" | "error"
	Score         *float64 `json:"score"`  // nil when not run
	BestCandidate string   `json:"best_candidate,omitempty"`
	Flaws         []string `json:"flaws_detected,omitempty"`
	ErrorReason   string   `json:"error_reason,omitempty"`
}

type GenerationResult struct {
	FinalMessage     string                    `json:"final_message"`
	TargetQuoteMsgID int                       `json:"target_quote_msg_id,omitempty"`
	Schedule         scheduler.ScheduleResult  `json:"schedule"`
	CandidateA       string                    `json:"candidate_a"`
	CandidateB       string                    `json:"candidate_b,omitempty"`
	CandidateC       string                    `json:"candidate_c,omitempty"`
	Critic           CriticResult              `json:"critic"`
	Plan             relationship.ResponsePlan `json:"plan"`
}

func (o *Orchestrator) ProcessMessage(sessionID, userID, userContent string) (*GenerationResult, error) {
	activeP := o.personaMgr.GetActivePersona()
	if activeP == nil {
		return nil, fmt.Errorf("no active persona loaded")
	}

	personaID := activeP.ID

	// 1. Prepare incoming message
	inMsg := storage.MessageItem{
		ID:        fmt.Sprintf("msg_in_%d", time.Now().UnixNano()),
		SessionID: sessionID,
		PersonaID: personaID,
		UserID:    userID,
		Sender:    "Counterpart",
		Content:   userContent,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}

	// 2. Context & Memory Retrieval
	retrieval := o.memoryEng.RetrieveContext(personaID, sessionID, userContent)

	// 3. L4 Relationship State Retrieval & Perception (Sections 1, 2, 4, 14)
	relState := o.relEngine.GetOrCreateState(sessionID, userID)
	if storedJSON, err := o.store.GetRelationshipState(sessionID); err == nil && storedJSON != "" {
		if deserialized, dErr := relationship.DeserializeState(storedJSON); dErr == nil {
			*relState = *deserialized
		}
	}
	perception := o.relEngine.Perceive(userContent, retrieval.WorkingContext)
	o.relEngine.Step(relState, perception)
	plan := o.relEngine.PlanResponse(relState, perception)

	// 4. Build Prompt Context
	systemPrompt := activeP.Persona.SystemPrompts.Generator
	var contextBuilder strings.Builder
	contextBuilder.WriteString(systemPrompt)
	contextBuilder.WriteString(o.relEngine.BuildPromptDirective(relState, plan, perception))
	contextBuilder.WriteString("\n\n[AUTHENTIC MEMORIES & EPISODES]\n")
	for _, ep := range retrieval.RelevantEpisodes {
		contextBuilder.WriteString(fmt.Sprintf("- %s\n", ep))
	}
	for _, f := range retrieval.RelevantFacts {
		contextBuilder.WriteString(fmt.Sprintf("- %s\n", f))
	}

	messages := []map[string]string{
		{"role": "system", "content": contextBuilder.String()},
	}

	for _, ctxLine := range retrieval.WorkingContext {
		parts := strings.SplitN(ctxLine, ": ", 2)
		if len(parts) == 2 {
			role := "user"
			if parts[0] == activeP.Persona.TargetSpeaker {
				role = "assistant"
			}
			messages = append(messages, map[string]string{"role": role, "content": parts[1]})
		}
	}
	messages = append(messages, map[string]string{"role": "user", "content": userContent})

	// 4. Direct Single-Pass Candidate Generation via LLM (eliminating 3-candidate JSON overhead)
	rawGen, err := o.callLLM(messages, 0.7, 200)
	var generatedText string

	if err != nil {
		o.store.Log("runtime", "WARN", fmt.Sprintf("callLLM failed: %v", err))
	} else {
		generatedText = cleanSinglePassOutput(rawGen, activeP.Persona.TargetSpeaker)
	}

	fallbackResponse := getPersonaFallback(activeP, userContent, relState)
	if generatedText == "" {
		generatedText = fallbackResponse
	}

	// 5. Honest Style Critic: bypassed from online IM generation path (Section 18 & Interface Contract)
	criticResult := CriticResult{
		Status: "not_run",
		Score:  nil,
	}

	// 6. sanitizeOutput: hard safety guardrail stripping genuine AI identity artifacts
	finalResponse := SanitizeOutput(generatedText, activeP.Persona.TargetSpeaker, fallbackResponse)

	// 7. Memory Candidate Extraction & Version Superseding Deltas (Section 10 & 12)
	// Does not write directly to DB; returns memory delta items for atomic commit.
	var extractor memory.LLMExtractor
	if o.llmCfg.BaseURL != "" && o.llmCfg.Model != "" {
		extractor = func(prompt string) (string, error) {
			critMsgs := []map[string]string{
				{"role": "system", "content": "Extract memories as JSON object with 'memories': [{category, key, value, importance_score, confidence}]. Only extract concrete biographical facts, real-world events, or explicitly stated personal preferences. Do NOT extract jokes, sarcasm, teasing, meta-comments about message retractions, or ephemeral banter. If none, return empty memories: []."},
				{"role": "user", "content": prompt},
			}
			return o.callLLM(critMsgs, 0.1, 300)
		}
	}
	memDeltas := o.memoryEng.ExtractMemoryDeltas(personaID, sessionID, userContent, finalResponse, extractor)

	// 8. Dynamic Response Scheduler configured with active persona and L4 relational factors (Sections 7, 8, 9, 14)
	o.sched.UpdateConfig(activeP.GetSchedulerConfig())
	scheduleRes := o.sched.CalculateScheduleAdvanced(finalResponse, scheduler.SchedulingContext{
		RapidConversation: len(retrieval.WorkingContext) > 4,
		Warmth:            relState.Relationship.Warmth,
		Irritation:        relState.Relationship.Irritation,
		Engagement:        relState.Relationship.Engagement,
		IsQuestion:        perception.Intent == "question",
		TargetCount:       plan.MessageCount,
	})

	// 9. Prepare Outgoing message and Scheduler event
	outMsg := storage.MessageItem{
		ID:        fmt.Sprintf("msg_out_%d", time.Now().UnixNano()),
		SessionID: sessionID,
		PersonaID: personaID,
		UserID:    userID,
		Sender:    activeP.Persona.TargetSpeaker,
		Content:   finalResponse,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		LatencyMs: scheduleRes.TotalDelayMs,
	}

	schedEvt := storage.SchedulerEvent{
		ID:               fmt.Sprintf("evt_%d", time.Now().UnixNano()),
		SessionID:        sessionID,
		MessageID:        outMsg.ID,
		CalculatedDelay:  scheduleRes.TotalDelayMs,
		ActualDelay:      scheduleRes.TotalDelayMs,
		JitterMs:         scheduleRes.JitterMs,
		TypingDurationMs: scheduleRes.TypingDurationMs,
		CreatedAt:        time.Now().UTC().Format(time.RFC3339),
	}

	// 10. Atomic Commit of Interaction Transaction (Section 12, 18 & 21)
	// Bundles incoming message, memory deltas, outgoing message, scheduler event, and L4 relationship state
	// into a single SQLite transaction, guaranteeing zero partial-state tears.
	relJSON, _ := relState.Serialize()
	tx := storage.InteractionTransaction{
		InMessage:             &inMsg,
		Memories:              memDeltas,
		OutMessage:            &outMsg,
		SchedulerEvent:        &schedEvt,
		RelationshipStateJSON: &relJSON,
	}
	if err := o.store.CommitInteraction(tx); err != nil {
		return nil, fmt.Errorf("failed to commit interaction transaction: %w", err)
	}
	o.memoryEng.AddWorkingMessage(sessionID, inMsg)
	o.memoryEng.AddWorkingMessage(sessionID, outMsg)

	return &GenerationResult{
		FinalMessage: finalResponse,
		Schedule:     scheduleRes,
		CandidateA:   finalResponse,
		Critic:       criticResult,
		Plan:         plan,
	}, nil
}

// runCriticPipeline attempts to call the Style Critic LLM to score A/B/C candidates.
// Returns the best candidate text and a CriticResult with honest status.
//
// P0-9 Fix: If the critic is not run (e.g., prompt empty, LLM error), critic.status = "not_run"
// and critic.score = nil. The score is NEVER hard-coded.
func (o *Orchestrator) runCriticPipeline(criticPrompt, candA, candB, candC string) (string, CriticResult) {
	// If critic prompt is not configured or only candidate A is available, skip critic.
	if criticPrompt == "" || (candB == "" && candC == "") {
		return candA, CriticResult{
			Status: "not_run",
			Score:  nil,
		}
	}

	// Build critic request
	criticMessages := []map[string]string{
		{"role": "system", "content": criticPrompt},
		{"role": "user", "content": fmt.Sprintf(
			`Evaluate these candidates:\n\nCandidate A:\n%s\n\nCandidate B:\n%s\n\nCandidate C:\n%s`,
			candA, candB, candC,
		)},
	}

	criticRaw, err := o.callLLM(criticMessages, 0.2, 400)
	if err != nil {
		return candA, CriticResult{
			Status:      "not_run",
			Score:       nil,
			ErrorReason: fmt.Sprintf("critic LLM error: %v", err),
		}
	}

	var criticResp struct {
		BestCandidate string `json:"best_candidate"` // "candidate_a"|"candidate_b"|"candidate_c"
		Scores        struct {
			Overall float64 `json:"overall"`
		} `json:"scores"`
		FlawsDetected []string `json:"flaws_detected"`
	}

	if jsonErr := json.Unmarshal([]byte(cleanOutput(criticRaw)), &criticResp); jsonErr != nil {
		return candA, CriticResult{
			Status:      "error",
			Score:       nil,
			ErrorReason: fmt.Sprintf("critic response parse error: %v", jsonErr),
		}
	}

	// Select best candidate based on critic
	var best string
	switch criticResp.BestCandidate {
	case "candidate_b":
		best = candB
	case "candidate_c":
		best = candC
	default:
		best = candA
	}
	if best == "" {
		best = candA
	}

	score := criticResp.Scores.Overall
	return best, CriticResult{
		Status:        "completed",
		Score:         &score,
		BestCandidate: criticResp.BestCandidate,
		Flaws:         criticResp.FlawsDetected,
	}
}

// SanitizeOutput is a hard safety guardrail that removes genuine AI identity artifacts.
// It prunes overbroad keywords so that innocent colloquial sentences are never stripped,
// and ensures 0% fallback to repetitive mechanical boilerplates.
func SanitizeOutput(text, personaName string, fallbackVoice ...string) string {
	if strings.TrimSpace(text) == "" {
		if len(fallbackVoice) > 0 && strings.TrimSpace(fallbackVoice[0]) != "" {
			return strings.TrimSpace(fallbackVoice[0])
		}
		if personaName != "" {
			return "刚才在忙呢，怎么啦？"
		}
		return "哎，怎么啦？"
	}

	// 0. Filter greasy adult/AI girlfriend tropes that break student tsundere immersion
	greasyReplacements := []struct {
		target string
		repl   string
	}{
		{"咋啦宝贝", "咋啦"},
		{"宝贝，", ""},
		{"，宝贝", ""},
		{"宝贝", ""},
		{"亲爱的，", ""},
		{"亲爱的", ""},
		{"宝宝，", ""},
		{"宝宝", ""},
		{"这么早就开始撒娇啦", "突然发什么神经"},
		{"开始撒娇啦", "抽什么风啊"},
		{"撒娇啦", "开玩笑"},
		{"撒娇", "开玩笑"},
		{"嘿嘿 我也在呢，一直都在", "在呢在呢"},
		{"我也在呢，一直都在", "在呢在呢"},
		{"一直都在 🥰", "在呢"},
		{"一直都在🥰", "在呢"},
		{"一直都在", "在呢"},
	}
	for _, gr := range greasyReplacements {
		text = strings.ReplaceAll(text, gr.target, gr.repl)
	}
	text = strings.TrimSpace(text)

	aiMarkers := []string{
		"作为ai",
		"作为一名ai",
		"作为一个ai",
		"作为一个人工智能",
		"作为人工智能",
		"作为一个语言模型",
		"作为一个大型语言模型",
		"作为大型语言模型",
		"作为一个大语言模型",
		"作为大语言模型",
		"作为语言模型",
		"作为虚拟助手",
		"作为ai助手",
		"我是ai",
		"我是一个ai",
		"我是人工智能",
		"我是由openai训练",
		"as an ai",
		"i'm an ai",
		"i am an ai",
		"有什么可以帮您",
		"有什么我可以帮您",
		"很高兴为您服务",
		"请问有什么可以协助",
		"我能为您做些什么",
		"请告诉我您的需求",
		"为您解答",
		"opencode",
	}

	textLower := strings.ToLower(text)
	hasMarker := false
	for _, marker := range aiMarkers {
		if isAIMarkerMatch(textLower, marker) {
			hasMarker = true
			break
		}
	}
	if !hasMarker {
		return text
	}

	// Try removing the AI disclaimer sentences
	cleaned := text
	for _, marker := range aiMarkers {
		var re *regexp.Regexp
		if marker == "我是ai" || marker == "作为ai" || strings.HasSuffix(marker, "ai") {
			re = regexp.MustCompile(`(?i)[^。！？\n]*` + regexp.QuoteMeta(marker) + `(?:[^a-zA-Z0-9。！？\n][^。！？\n]*[。！？\n]?|[。！？\n]|$)`)
		} else {
			re = regexp.MustCompile(`(?i)[^。！？\n]*` + regexp.QuoteMeta(marker) + `[^。！？\n]*[。！？\n]?`)
		}
		cleaned = re.ReplaceAllString(cleaned, "")
	}
	cleaned = strings.TrimSpace(cleaned)
	cleanContent := strings.Trim(cleaned, " 　\t\r\n，。！？!?~～:：;；、.")
	if len([]rune(cleanContent)) > 0 {
		return cleaned
	}

	// Fallback to authentic colloquial companion response if message was AI boilerplate
	if len(fallbackVoice) > 0 && strings.TrimSpace(fallbackVoice[0]) != "" {
		return strings.TrimSpace(fallbackVoice[0])
	}
	if personaName != "" {
		return "刚才在忙呢，怎么啦？"
	}
	return "哎，怎么啦？"
}

func sanitizeOutput(text, personaName string, fallbackVoice ...string) string {
	return SanitizeOutput(text, personaName, fallbackVoice...)
}

func isAIMarkerMatch(textLower, marker string) bool {
	if marker == "我是ai" || marker == "作为ai" || strings.HasSuffix(marker, "ai") {
		idx := 0
		for {
			pos := strings.Index(textLower[idx:], marker)
			if pos == -1 {
				return false
			}
			matchPos := idx + pos
			afterPos := matchPos + len(marker)
			if afterPos < len(textLower) {
				nextChar := textLower[afterPos]
				if (nextChar >= 'a' && nextChar <= 'z') || (nextChar >= '0' && nextChar <= '9') {
					idx = afterPos
					continue
				}
			}
			return true
		}
	}
	return strings.Contains(textLower, marker)
}

func isGroupAnnouncementOrSystemArtifact(s string) bool {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)

	// Group announcements and bot greetings
	if strings.HasPrefix(trimmed, "我是群聊") || strings.HasPrefix(trimmed, "群公告") ||
		strings.HasPrefix(trimmed, "群规") || strings.HasPrefix(trimmed, "群主提醒") ||
		strings.HasPrefix(trimmed, "系统通知") || strings.HasPrefix(trimmed, "系统消息") ||
		strings.HasPrefix(trimmed, "欢迎加入群聊") || strings.HasPrefix(trimmed, "欢迎加入") ||
		strings.HasPrefix(trimmed, "本群须知") || strings.HasPrefix(trimmed, "公告：") || strings.HasPrefix(trimmed, "公告:") {
		return true
	}
	if strings.Contains(trimmed, "我是群聊“") || strings.Contains(trimmed, "我是群聊\"") || strings.Contains(trimmed, "我是群聊") {
		return true
	}

	// System notices & service events
	if strings.Contains(trimmed, "撤回了一条消息") || strings.Contains(trimmed, "你撤回了一条消息") ||
		strings.Contains(trimmed, "拍了拍") || strings.Contains(trimmed, "移出了群聊") ||
		strings.Contains(trimmed, "加入了群聊") || strings.Contains(trimmed, "开启了朋友验证") ||
		strings.Contains(trimmed, "现在可以开始聊天了") {
		return true
	}
	if strings.Contains(lower, "joined the group") || strings.Contains(lower, "left the group") || strings.Contains(lower, "pinned a message") {
		return true
	}

	// Media-only lines
	if trimmed == "[图片]" || trimmed == "[image]" || trimmed == "[表情包]" || trimmed == "[动画表情]" ||
		trimmed == "[语音]" || trimmed == "[视频]" || trimmed == "[文件]" {
		return true
	}

	// Legacy repetitive boilerplates
	if strings.Contains(trimmed, "在呢，怎么啦~") || strings.Contains(trimmed, "在忙呢，稍等下哦") {
		return true
	}

	return false
}

var fallbackCounter uint64

func pickVariant(candidates []string) string {
	if len(candidates) == 0 {
		return ""
	}
	idx := atomic.AddUint64(&fallbackCounter, 1) % uint64(len(candidates))
	return candidates[idx]
}

func getPersonaFallback(activeP *persona.LoadedPersona, userContent string, relState ...*relationship.FullSessionState) string {
	trimmed := strings.TrimSpace(userContent)
	userLower := strings.ToLower(trimmed)
	cleanPunct := strings.Trim(userLower, " ~!@#$%^&*()_+=-`{}[]|\\:;\"'<>,.?/，。！？~～、")

	var state *relationship.FullSessionState
	if len(relState) > 0 {
		state = relState[0]
	}

	isIrritated := false
	isWarm := false
	isDistant := false
	if state != nil {
		if state.Relationship.Phase == "ANNOYED" || state.Relationship.Phase == "CONFLICT" || state.Relationship.Phase == "COLD" || state.Relationship.Irritation > 0.6 {
			isIrritated = true
		} else if state.Relationship.Phase == "WARM" || state.Relationship.Warmth > 0.7 {
			isWarm = true
		} else if state.Relationship.Phase == "DISTANT" {
			isDistant = true
		}
	}

	hour := time.Now().Hour()
	isLateNight := (hour >= 23 || hour < 6)
	isMorning := (hour >= 6 && hour < 11)

	// 1. High-Priority Emotional Crisis / Attachment Distress Check (BEFORE any general keyword matching)
	if strings.Contains(userLower, "离开我") || strings.Contains(userLower, "做错啥") || strings.Contains(userLower, "做错什么") || strings.Contains(userLower, "别离开") || strings.Contains(userLower, "不能离开") || strings.Contains(userLower, "丢下我") || strings.Contains(userLower, "不要离开") || strings.Contains(userLower, "躲着我") || strings.Contains(userLower, "避开我") || strings.Contains(userLower, "绕着我走") {
		return pickVariant([]string{
			"……你别发神经了行不行",
			"我没说你做错什么，你别这样……",
			"你突然说这个干嘛，先冷静点",
			"别在网上说这些了……",
			"你别多想了，先顾好你自己吧",
			"我这不是在呢吗，你成天脑子里瞎想什么呢",
		})
	}

	// 2. High-Priority Confession / Romantic Advance Check
	if strings.Contains(userLower, "喜欢你") || strings.Contains(userLower, "我喜欢你") || strings.Contains(userLower, "爱你") || strings.Contains(userLower, "做我女朋友") || strings.Contains(userLower, "在一起吧") || strings.Contains(userLower, "表白") {
		return pickVariant([]string{
			"？？？你没睡醒吧",
			"大早上的你抽什么风啊",
			"……别瞎开玩笑",
			"没睡醒去洗把脸吧你",
			"谁要你喜欢了……",
			"你发什么神经呢",
			"……你突然说这个干嘛，怪恶心的",
		})
	}

	// 3. High-Priority Demand / Guilt-tripping / Checking-in Check
	if strings.Contains(userLower, "难道不应该") || strings.Contains(userLower, "打招呼") || strings.Contains(userLower, "查岗") || strings.Contains(userLower, "天天问") || strings.Contains(userLower, "为什么不理") || strings.Contains(userLower, "每天跟我") {
		return pickVariant([]string{
			"谁规定的啊",
			"大早上的你查岗呢",
			"懒得理你",
			"天天打招呼我成打卡机了",
			"早啊，催什么催嘛",
			"起晚了不行啊，管这么宽干嘛",
		})
	}

	// 4. Check if user is casually calling or greeting the persona ("oi", "哈喽", "王雅雯", "雅雯", etc.)
	isCallingByNameOrGreeting := false

	casualGreetings := []string{"@", "@我", "oi", "oii", "oiii", "oy", "yo", "哈喽", "哈罗", "hello", "hi", "hey", "嗨", "嗨喽", "嗨害嗨", "喂"}
	for _, g := range casualGreetings {
		if cleanPunct == g || strings.HasPrefix(cleanPunct, g) {
			isCallingByNameOrGreeting = true
			break
		}
	}

	nameTriggers := []string{"王雅雯", "雅雯", "小雅", "yawen", "ms.yawen"}
	if activeP != nil {
		if activeP.Persona.TargetSpeaker != "" {
			nameTriggers = append(nameTriggers, strings.ToLower(activeP.Persona.TargetSpeaker))
		}
		if activeP.Persona.Name != "" {
			nameTriggers = append(nameTriggers, strings.ToLower(activeP.Persona.Name))
		}
	}

	if !isCallingByNameOrGreeting {
		for _, name := range nameTriggers {
			if cleanPunct == name || strings.HasPrefix(cleanPunct, name) || (len(cleanPunct) <= len(name)+4 && strings.Contains(trimmed, name)) {
				isCallingByNameOrGreeting = true
				break
			}
		}
	}

	if isCallingByNameOrGreeting {
		var candidates []string
		if isIrritated {
			candidates = []string{
				"咋了",
				"干嘛",
				"怎么了？",
				"有事说事~",
				"在呢，什么事？",
			}
		} else if isDistant {
			candidates = []string{
				"在的，怎么啦？",
				"嗯？找我有事吗",
				"在呢，怎么啦？",
			}
		} else if isWarm {
			if isLateNight {
				candidates = []string{
					"还没睡呀？怎么啦",
					"在呢，这么晚找我，咋啦？",
					"还没睡呢？啥事呀",
					"在呢，怎么啦？",
				}
			} else if isMorning {
				candidates = []string{
					"早呀~ 怎么啦？",
					"在呢早呀，怎么突然叫我~",
					"早啊，刚看手机，咋啦？",
					"在呀，今天起挺早呢，怎么啦？",
				}
			} else {
				candidates = []string{
					"在呢，怎么啦？",
					"哎，怎么啦？",
					"咋啦？",
					"在呢，有什么事呀",
					"在的，怎么啦？",
				}
			}
		} else {
			// Normal / Balanced living companion tone
			if isLateNight {
				candidates = []string{
					"还没睡呀？怎么啦~",
					"在呢，这么晚找我，咋啦？",
					"还没睡呢？怎么啦",
					"在呀，怎么突然叫我~",
				}
			} else if isMorning {
				candidates = []string{
					"早呀~ 怎么啦？",
					"在呢早呀，怎么突然叫我~",
					"早啊，刚看手机，咋啦？",
					"在呀，有什么事嘛~",
				}
			} else {
				candidates = []string{
					"哎，怎么啦？",
					"在呀，怎么突然叫我~",
					"咋啦？",
					"在呢，有什么事呀",
					"在的呀，怎么啦？",
					"怎么啦怎么啦~",
				}
			}
		}
		return pickVariant(candidates)
	}

	if cleanPunct == "在吗" || cleanPunct == "在嘛" || cleanPunct == "在不在" || cleanPunct == "在不" || cleanPunct == "在呢吗" {
		if isIrritated {
			return pickVariant([]string{"在呢，说吧", "在，怎么了", "有事吗？"})
		} else if isWarm {
			return pickVariant([]string{"在呢，怎么啦？", "在呀，怎么啦~", "在呢，有什么事呀"})
		}
		return pickVariant([]string{"在呢，怎么啦？", "在的呢，怎么啦？", "在呀，有什么事呀", "在的在的，怎么啦？"})
	}

	if cleanPunct == "123" || cleanPunct == "1" || cleanPunct == "打卡" || cleanPunct == "戳戳" || strings.Contains(cleanPunct, "戳一戳") {
		return pickVariant([]string{
			"发这个干嘛呀哈哈",
			"？怎么突然戳我",
			"摸鱼呢？",
			"咋啦，发暗号呢？",
			"发123干嘛呀哈哈",
			"突然戳我一下干嘛~",
		})
	}

	if strings.Contains(cleanPunct, "干嘛") || strings.Contains(cleanPunct, "为什么") || strings.Contains(cleanPunct, "为啥") || strings.Contains(cleanPunct, "干啥") || strings.Contains(cleanPunct, "发啥") || strings.Contains(cleanPunct, "怎么突然") {
		return pickVariant([]string{
			"没干嘛呀，就随便发发，咋啦",
			"哈哈没啥，刚才手滑了下😂",
			"怎么啦，好奇呀？",
			"刚在看手机呢，怎么啦？",
		})
	}

	if strings.Contains(cleanPunct, "难受") || strings.Contains(cleanPunct, "不开心") || strings.Contains(cleanPunct, "心累") || strings.Contains(cleanPunct, "委屈") || strings.Contains(cleanPunct, "生气") {
		return pickVariant([]string{
			"怎么了这是，谁惹你了呀？",
			"发生什么事啦？别一个人闷着",
			"……行吧，跟我说说咋回事",
			"别难受了，要不早点休息？",
		})
	}

	if strings.Contains(userLower, "早") {
		return pickVariant([]string{
			"早呀，刚看到消息~",
			"早啊！今天起挺早呀",
			"早呀早呀，昨晚睡得好吗",
			"早安~ 今天有什么安排嘛",
		})
	}

	if strings.Contains(userLower, "晚安") || strings.Contains(userLower, "睡了") || strings.Contains(userLower, "好梦") || strings.Contains(userLower, "去睡") {
		return pickVariant([]string{
			"好梦呀，明天聊！",
			"晚安晚安，早点休息~",
			"去睡吧，明天见！",
			"好梦哦，盖好被子~",
		})
	}

	if strings.Contains(userLower, "哈哈") || strings.Contains(userLower, "233") || strings.Contains(userLower, "笑死") {
		return pickVariant([]string{
			"哈哈哈笑死我了",
			"哈哈哈哈太逗了",
			"哈哈你在笑什么呀",
			"笑得这么开心呀哈哈",
		})
	}

	if strings.Contains(userLower, "？") || strings.Contains(userLower, "?") || strings.Contains(userLower, "人呢") || strings.Contains(userLower, "干嘛呢") {
		return pickVariant([]string{
			"怎么啦？遇到什么事啦",
			"嗯？咋啦",
			"刚才没看手机，怎么啦？",
			"在的在的，怎么啦？",
		})
	}

	return pickVariant([]string{
		"刚在看手机呢，怎么啦？",
		"哎，刚看到消息~",
		"在呢在呢，刚才没注意看手机，怎么啦？",
		"刚才走开了一下，怎么啦？",
		"怎么啦怎么啦~",
		"在呢，啥事呀~",
	})
}

// GetPersonaFallback returns a lively, authentic fallback response based on persona, user input, and relationship state.
func GetPersonaFallback(activeP *persona.LoadedPersona, userContent string, relState ...*relationship.FullSessionState) string {
	return getPersonaFallback(activeP, userContent, relState...)
}

func cleanSinglePassOutput(text, targetSpeaker string) string {
	cleaned := cleanOutput(text)

	// 1. If output is wrapped in or contains markdown code block, extract it
	if idx := strings.Index(cleaned, "```"); idx != -1 {
		rest := cleaned[idx:]
		if strings.HasPrefix(rest, "```json") {
			rest = strings.TrimPrefix(rest, "```json")
		} else {
			rest = strings.TrimPrefix(rest, "```")
		}
		if endIdx := strings.Index(rest, "```"); endIdx != -1 {
			extracted := strings.TrimSpace(rest[:endIdx])
			if extracted != "" {
				cleaned = extracted
			}
		}
	}
	cleaned = strings.TrimSpace(cleaned)

	// 2. If output is candidate JSON or has message fields, unwrap safely
	startJSON := strings.Index(cleaned, "{")
	endJSON := strings.LastIndex(cleaned, "}")
	if startJSON != -1 && endJSON > startJSON {
		jsonSub := cleaned[startJSON : endJSON+1]
		var candMap struct {
			CandidateA   string `json:"candidate_a"`
			CandidateB   string `json:"candidate_b"`
			CandidateC   string `json:"candidate_c"`
			Reply        string `json:"reply"`
			FinalMessage string `json:"final_message"`
			Message      string `json:"message"`
			Content      string `json:"content"`
			Response     string `json:"response"`
			Text         string `json:"text"`
		}
		if err := json.Unmarshal([]byte(jsonSub), &candMap); err == nil {
			if candMap.CandidateA != "" {
				cleaned = candMap.CandidateA
			} else if candMap.FinalMessage != "" {
				cleaned = candMap.FinalMessage
			} else if candMap.Reply != "" {
				cleaned = candMap.Reply
			} else if candMap.Message != "" {
				cleaned = candMap.Message
			} else if candMap.Content != "" {
				cleaned = candMap.Content
			} else if candMap.Response != "" {
				cleaned = candMap.Response
			} else if candMap.Text != "" {
				cleaned = candMap.Text
			} else if candMap.CandidateB != "" {
				cleaned = candMap.CandidateB
			} else if candMap.CandidateC != "" {
				cleaned = candMap.CandidateC
			}
		}
	}
	cleaned = strings.TrimSpace(cleaned)

	// 3. Line-by-line script detection & Group announcement filtering
	lines := strings.Split(cleaned, "\n")
	var validLines []string
	userPrefixPattern := regexp.MustCompile(`^(?i)(?:user|用户|human|counterpart)[:：\s]`)

	for _, l := range lines {
		trimmedLine := strings.TrimSpace(l)
		if trimmedLine == "" {
			continue
		}
		// Strip markdown headers like ### 2026-05-27 or ## Section
		if strings.HasPrefix(trimmedLine, "#") {
			continue
		}
		// Drop group announcement lines or system notices
		if isGroupAnnouncementOrSystemArtifact(trimmedLine) {
			continue
		}
		// If line is a User/Counterpart prompt line in a leaked dialogue transcript, skip it if other lines exist
		if userPrefixPattern.MatchString(trimmedLine) && len(lines) > 1 {
			continue
		}
		validLines = append(validLines, trimmedLine)
	}

	if len(validLines) == 0 {
		return ""
	}
	cleaned = strings.Join(validLines, "\n")

	// 4. Repeatedly strip speaker prefixes and surrounding quotes safely
	var reSpeaker *regexp.Regexp
	if targetSpeaker != "" {
		reSpeaker = regexp.MustCompile(`^(?i)(?:` + regexp.QuoteMeta(targetSpeaker) + `|[\[【(]` + regexp.QuoteMeta(targetSpeaker) + `[\]】)])[:：]\s*`)
	}
	reCommonPrefix := regexp.MustCompile(`^(?i)(?:王雅雯|雅雯|Ms\.Yawen|Yawen|User|用户|Human|Counterpart|AI|Assistant|助手|小助手|Bot|System|系统|回复|答|说)[:：]\s*`)
	reBracketPrefix := regexp.MustCompile(`^(?i)[\[【(](?:王雅雯|雅雯|Ms\.Yawen|Yawen|User|用户|Human|Counterpart|AI|Assistant|助手|小助手|Bot|System|系统)[\]】)][:：]?\s*`)

	for {
		prev := cleaned
		if reSpeaker != nil {
			cleaned = reSpeaker.ReplaceAllString(cleaned, "")
		}
		cleaned = reCommonPrefix.ReplaceAllString(cleaned, "")
		cleaned = reBracketPrefix.ReplaceAllString(cleaned, "")
		cleaned = strings.TrimSpace(cleaned)

		// Strip surrounding quotes safely without byte slicing multibyte UTF-8
		if strings.HasPrefix(cleaned, "\"") && strings.HasSuffix(cleaned, "\"") && len(cleaned) >= 2 {
			cleaned = strings.TrimSuffix(strings.TrimPrefix(cleaned, "\""), "\"")
		} else if strings.HasPrefix(cleaned, "'") && strings.HasSuffix(cleaned, "'") && len(cleaned) >= 2 {
			cleaned = strings.TrimSuffix(strings.TrimPrefix(cleaned, "'"), "'")
		} else if strings.HasPrefix(cleaned, "“") && strings.HasSuffix(cleaned, "”") {
			cleaned = strings.TrimSuffix(strings.TrimPrefix(cleaned, "“"), "”")
		} else if strings.HasPrefix(cleaned, "‘") && strings.HasSuffix(cleaned, "’") {
			cleaned = strings.TrimSuffix(strings.TrimPrefix(cleaned, "‘"), "’")
		} else if strings.HasPrefix(cleaned, "「") && strings.HasSuffix(cleaned, "」") {
			cleaned = strings.TrimSuffix(strings.TrimPrefix(cleaned, "「"), "」")
		} else if strings.HasPrefix(cleaned, "『") && strings.HasSuffix(cleaned, "』") {
			cleaned = strings.TrimSuffix(strings.TrimPrefix(cleaned, "『"), "』")
		}
		cleaned = strings.TrimSpace(cleaned)

		if cleaned == prev {
			break
		}
	}

	// 5. Strip trailing periods for casual IM style
	cleaned = strings.TrimRight(cleaned, "。.")

	// 6. If multiple lines, take first 1-2 non-empty lines
	splitLines := strings.Split(cleaned, "\n")
	var finalLines []string
	for _, l := range splitLines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" && !isGroupAnnouncementOrSystemArtifact(trimmed) {
			finalLines = append(finalLines, trimmed)
		}
	}
	if len(finalLines) > 2 {
		cleaned = strings.Join(finalLines[:2], " ")
	} else if len(finalLines) > 0 {
		cleaned = strings.Join(finalLines, " ")
	} else {
		cleaned = ""
	}

	// 7. Final check for group announcement artifacts
	if isGroupAnnouncementOrSystemArtifact(cleaned) {
		return ""
	}

	return strings.TrimSpace(cleaned)
}

func (o *Orchestrator) callLLM(messages []map[string]string, temp float64, maxTokens int) (string, error) {
	baseURL := strings.TrimRight(o.llmCfg.BaseURL, "/")
	endpoint := baseURL + "/chat/completions"

	reqBody := map[string]interface{}{
		"model":       o.llmCfg.Model,
		"messages":    messages,
		"temperature": temp,
		"max_tokens":  maxTokens,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if o.llmCfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+o.llmCfg.APIKey)
	}

	resp, err := o.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var resObj struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.Unmarshal(bodyBytes, &resObj); err == nil && len(resObj.Choices) > 0 {
		return resObj.Choices[0].Message.Content, nil
	}

	return "", fmt.Errorf("invalid LLM response: %s", string(bodyBytes))
}

func cleanOutput(text string) string {
	re := regexp.MustCompile(`(?i)(?s)<think>.*?</think>`)
	cleaned := text
	for {
		next := re.ReplaceAllString(cleaned, "")
		if next == cleaned {
			break
		}
		cleaned = next
	}
	// Strip any remaining dangling closing tag and preceding thought (e.g. from nested <think> tags)
	for {
		idx := strings.Index(strings.ToLower(cleaned), "</think>")
		if idx == -1 {
			break
		}
		cleaned = cleaned[idx+len("</think>"):]
	}
	reOpen := regexp.MustCompile(`(?i)<think>`)
	if loc := reOpen.FindStringIndex(cleaned); loc != nil {
		cleaned = cleaned[:loc[0]]
	}
	return strings.TrimSpace(cleaned)
}

// CleanOutput strips thinking tags from LLM response text.
func CleanOutput(text string) string {
	return cleanOutput(text)
}

// CleanSinglePassOutput processes raw LLM generation by stripping think tags, markdown fences,
// repeated speaker prefixes, surrounding quotes (safely without UTF-8 byte tearing), and casual trailing punctuation.
func CleanSinglePassOutput(text, targetSpeaker string) string {
	return cleanSinglePassOutput(text, targetSpeaker)
}

func extractJSON(text string) string {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```json") {
		text = strings.TrimPrefix(text, "```json")
		if idx := strings.LastIndex(text, "```"); idx != -1 {
			text = text[:idx]
		}
	} else if strings.HasPrefix(text, "```") {
		text = strings.TrimPrefix(text, "```")
		if idx := strings.LastIndex(text, "```"); idx != -1 {
			text = text[:idx]
		}
	}
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start != -1 && end > start {
		return text[start : end+1]
	}
	return strings.TrimSpace(text)
}
