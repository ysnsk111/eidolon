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
	return &Orchestrator{
		store:      store,
		personaMgr: personaMgr,
		memoryEng:  memoryEng,
		sched:      sched,
		llmCfg:     llmCfg,
		client:     &http.Client{Timeout: 45 * time.Second},
	}
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
	FinalMessage string                   `json:"final_message"`
	Schedule     scheduler.ScheduleResult `json:"schedule"`
	CandidateA   string                   `json:"candidate_a"`
	CandidateB   string                   `json:"candidate_b"`
	CandidateC   string                   `json:"candidate_c"`
	Critic       CriticResult             `json:"critic"`
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

	// 3. Build Prompt Context
	systemPrompt := activeP.Persona.SystemPrompts.Generator
	var contextBuilder strings.Builder
	contextBuilder.WriteString(systemPrompt)
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

	// 4. Candidate Generation via LLM (A/B/C)
	rawGen, err := o.callLLM(messages, 0.7, 350)
	var candA, candB, candC string

	if err == nil {
		cleaned := cleanOutput(rawGen)
		var candMap struct {
			CandidateA string `json:"candidate_a"`
			CandidateB string `json:"candidate_b"`
			CandidateC string `json:"candidate_c"`
		}
		if jsonErr := json.Unmarshal([]byte(cleaned), &candMap); jsonErr == nil && candMap.CandidateA != "" {
			candA = candMap.CandidateA
			candB = candMap.CandidateB
			candC = candMap.CandidateC
		} else {
			candA = cleaned
		}
	}

	if candA == "" {
		candA = "好呀，知道啊~"
	}

	// 5. Style Critic Pipeline (A/B/C -> best candidate)
	// P0-9 Fix: CriticScore is no longer hard-coded to 0.88.
	// If the critic LLM call is unavailable, critic.status = "not_run" and score = nil.
	selected, criticResult := o.runCriticPipeline(activeP.Persona.SystemPrompts.Critic, candA, candB, candC)

	// 6. sanitizeOutput: AI artifact guard (renamed from pseudo "Style Critic")
	// This is NOT the Style Critic; it is a hard safety guardrail.
	finalResponse := sanitizeOutput(selected, activeP.Persona.TargetSpeaker)

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

	// 8. Dynamic Response Scheduler configured with active persona's latency model (Section 14)
	o.sched.UpdateConfig(activeP.GetSchedulerConfig())
	scheduleRes := o.sched.CalculateSchedule(finalResponse, len(retrieval.WorkingContext) > 4)

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

	// 10. Atomic Commit of Interaction Transaction (Section 12 & 21)
	// Bundles incoming message, memory deltas, outgoing message, and scheduler event
	// into a single SQLite transaction, guaranteeing zero partial-state tears.
	tx := storage.InteractionTransaction{
		InMessage:      &inMsg,
		Memories:       memDeltas,
		OutMessage:     &outMsg,
		SchedulerEvent: &schedEvt,
	}
	if err := o.store.CommitInteraction(tx); err != nil {
		return nil, fmt.Errorf("failed to commit interaction transaction: %w", err)
	}
	o.memoryEng.AddWorkingMessage(sessionID, outMsg)

	return &GenerationResult{
		FinalMessage: finalResponse,
		Schedule:     scheduleRes,
		CandidateA:   candA,
		CandidateB:   candB,
		CandidateC:   candC,
		Critic:       criticResult,
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

// sanitizeOutput is a hard safety guardrail that removes AI identity artifacts.
// P0-8 Fix: This is explicitly NOT the Style Critic. It is renamed from the
// previous misleading inline keyword-check block to make its role clear.
// The real StyleCritic is runCriticPipeline above.
func sanitizeOutput(text, personaName string) string {
	aiMarkers := []string{
		"opencode", "人工智能", "语言模型", "有什么可以帮您", "有什么我可以帮您",
		"作为AI", "as an AI", "I'm an AI",
	}
	textLower := strings.ToLower(text)
	for _, marker := range aiMarkers {
		if strings.Contains(textLower, strings.ToLower(marker)) {
			// Return a safe empty-signal rather than a hard-coded phrase.
			// Operators should customize this fallback for their persona.
			return "[sanitized]"
		}
	}
	return text
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
	re := regexp.MustCompile(`(?s)<think>.*?</think>`)
	cleaned := re.ReplaceAllString(text, "")
	cleaned = strings.TrimPrefix(cleaned, "</think>")
	return strings.TrimSpace(cleaned)
}
