package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
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
		} else if timeout > 15*time.Second {
			timeout = 15 * time.Second
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
	o.memoryEng.AddWorkingMessage(sessionID, inMsg)

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
	contextBuilder.WriteString(o.relEngine.BuildPromptDirective(relState, plan))
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

	if err == nil {
		generatedText = cleanSinglePassOutput(rawGen, activeP.Persona.TargetSpeaker)
	}

	fallbackResponse := getPersonaFallback(activeP, userContent)
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
				{"role": "system", "content": "Extract memories as JSON object with 'memories': [{category, key, value, importance_score, confidence}]"},
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
// and ensures 0% fallback to the repetitive "在呢，怎么啦~" boilerplate.
func SanitizeOutput(text, personaName string, fallbackVoice ...string) string {
	if strings.TrimSpace(text) == "" {
		if len(fallbackVoice) > 0 && strings.TrimSpace(fallbackVoice[0]) != "" {
			return strings.TrimSpace(fallbackVoice[0])
		}
		if personaName != "" {
			return "刚才在忙呢，怎么啦？"
		}
		return "在忙呢，稍等下哦"
	}

	aiMarkers := []string{
		"作为ai",
		"作为一名ai",
		"作为一个ai",
		"作为一个人工智能",
		"作为人工智能",
		"作为一个语言模型",
		"作为一个大型语言模型",
		"作为虚拟助手",
		"作为ai助手",
		"我是ai",
		"我是一个ai",
		"我是人工智能",
		"我是由openai训练",
		"语言模型",
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
	if len([]rune(cleaned)) >= 3 {
		return cleaned
	}

	// Fallback to authentic colloquial companion response if message was AI boilerplate (0% "在呢，怎么啦~")
	if len(fallbackVoice) > 0 && strings.TrimSpace(fallbackVoice[0]) != "" {
		return strings.TrimSpace(fallbackVoice[0])
	}
	if personaName != "" {
		return "刚才在忙呢，怎么啦？"
	}
	return "在忙呢，稍等下哦"
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

func getPersonaFallback(activeP *persona.LoadedPersona, userContent string) string {
	if activeP != nil {
		// 1. Try to use distilled openers if available
		if fp, ok := activeP.Persona.LinguisticFingerprint["openers"]; ok {
			if openers, ok := fp.([]string); ok && len(openers) > 0 && strings.TrimSpace(openers[0]) != "" {
				return strings.TrimSpace(openers[0])
			}
			if openers, ok := fp.([]interface{}); ok && len(openers) > 0 {
				if s, ok := openers[0].(string); ok && strings.TrimSpace(s) != "" {
					return strings.TrimSpace(s)
				}
			}
		}

		// 2. Try catchphrases
		if vocab, ok := activeP.Persona.LinguisticFingerprint["vocabulary"].(map[string]interface{}); ok {
			if cp, ok := vocab["catchphrases"]; ok {
				if phrases, ok := cp.([]string); ok && len(phrases) > 0 && strings.TrimSpace(phrases[0]) != "" {
					return strings.TrimSpace(phrases[0]) + "，刚才走开了一下"
				}
				if phrases, ok := cp.([]interface{}); ok && len(phrases) > 0 {
					if s, ok := phrases[0].(string); ok && strings.TrimSpace(s) != "" {
						return strings.TrimSpace(s) + "，刚才走开了一下"
					}
				}
			}
		}
	}

	// 3. Contextual conversational response based on user input
	userLower := strings.ToLower(userContent)
	if strings.Contains(userLower, "早") {
		return "早呀，刚看到消息~"
	}
	if strings.Contains(userLower, "晚安") || strings.Contains(userLower, "睡") {
		return "好梦呀，明天聊！"
	}
	if strings.Contains(userLower, "哈哈") {
		return "哈哈哈刚才在忙呢"
	}
	if strings.Contains(userLower, "在吗") || strings.Contains(userLower, "在嘛") {
		return "在的在的，刚才在忙"
	}
	if strings.Contains(userLower, "？") || strings.Contains(userLower, "?") {
		return "刚刚在忙呢，怎么啦？"
	}

	return "刚才走开了一下，怎么啦？"
}

func cleanSinglePassOutput(text, targetSpeaker string) string {
	cleaned := cleanOutput(text)

	// If output was wrapped in markdown code block, extract it
	if strings.HasPrefix(cleaned, "```json") {
		cleaned = strings.TrimPrefix(cleaned, "```json")
		if idx := strings.LastIndex(cleaned, "```"); idx != -1 {
			cleaned = cleaned[:idx]
		}
	} else if strings.HasPrefix(cleaned, "```") {
		cleaned = strings.TrimPrefix(cleaned, "```")
		if idx := strings.LastIndex(cleaned, "```"); idx != -1 {
			cleaned = cleaned[:idx]
		}
	}
	cleaned = strings.TrimSpace(cleaned)

	// If output is legacy JSON with candidates or message field, unwrap safely
	if strings.HasPrefix(cleaned, "{") && strings.HasSuffix(cleaned, "}") {
		var candMap struct {
			CandidateA   string `json:"candidate_a"`
			CandidateB   string `json:"candidate_b"`
			CandidateC   string `json:"candidate_c"`
			Reply        string `json:"reply"`
			FinalMessage string `json:"final_message"`
			Message      string `json:"message"`
		}
		if err := json.Unmarshal([]byte(cleaned), &candMap); err == nil {
			if candMap.CandidateA != "" {
				cleaned = candMap.CandidateA
			} else if candMap.CandidateB != "" {
				cleaned = candMap.CandidateB
			} else if candMap.CandidateC != "" {
				cleaned = candMap.CandidateC
			} else if candMap.FinalMessage != "" {
				cleaned = candMap.FinalMessage
			} else if candMap.Reply != "" {
				cleaned = candMap.Reply
			} else if candMap.Message != "" {
				cleaned = candMap.Message
			}
		}
	}
	cleaned = strings.TrimSpace(cleaned)

	// Repeatedly strip speaker prefixes and surrounding quotes safely without UTF-8 byte tearing
	var reSpeaker *regexp.Regexp
	if targetSpeaker != "" {
		reSpeaker = regexp.MustCompile(`^(?i)` + regexp.QuoteMeta(targetSpeaker) + `[:：]\s*`)
	}
	reCommonPrefix := regexp.MustCompile(`^(?i)(?:AI|Assistant|助手|回复|答|说)[:：]\s*`)

	for {
		prev := cleaned
		if reSpeaker != nil {
			cleaned = reSpeaker.ReplaceAllString(cleaned, "")
		}
		cleaned = reCommonPrefix.ReplaceAllString(cleaned, "")
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
		}
		cleaned = strings.TrimSpace(cleaned)

		if cleaned == prev {
			break
		}
	}

	// Strip trailing periods for casual IM style
	cleaned = strings.TrimRight(cleaned, "。.")

	// If multiple lines, take first 1-2 non-empty lines
	lines := strings.Split(cleaned, "\n")
	var nonEmpties []string
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" {
			nonEmpties = append(nonEmpties, trimmed)
		}
	}
	if len(nonEmpties) > 2 {
		cleaned = strings.Join(nonEmpties[:2], " ")
	} else if len(nonEmpties) > 0 {
		cleaned = strings.Join(nonEmpties, " ")
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
