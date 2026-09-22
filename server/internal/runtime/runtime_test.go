package runtime_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/runtime"
	"eidolon/server/internal/scheduler"
	"eidolon/server/internal/storage"
)

func TestRuntime_ProcessMessage_CommitInteractionAndHonestCritic(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_runtime.db")
	personasDir := filepath.Join(tempDir, "personas")
	personaID := "alice_test"
	pDir := filepath.Join(personasDir, personaID)

	if err := os.MkdirAll(pDir, 0755); err != nil {
		t.Fatalf("Failed to create persona dir: %v", err)
	}

	// Create test persona files
	manifest := map[string]interface{}{"name": "Alice", "version": "1.1.0"}
	manData, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(pDir, "manifest.json"), manData, 0644)

	personaDetails := map[string]interface{}{
		"id":             personaID,
		"name":           "Alice",
		"target_speaker": "Alice",
		"system_prompts": map[string]interface{}{
			"generator": "You are Alice.",
			"critic":    "", // Empty critic to verify honest not_run status
		},
	}
	pData, _ := json.Marshal(personaDetails)
	_ = os.WriteFile(filepath.Join(pDir, "persona.json"), pData, 0644)

	behaviorData := map[string]interface{}{
		"conversation_rhythm": map[string]interface{}{
			"base_delay_ms": 2200,
			"latency_model": map[string]interface{}{
				"short": map[string]interface{}{"median_ms": 1100, "p90_ms": 2000, "samples": 12},
			},
		},
	}
	bData, _ := json.Marshal(behaviorData)
	_ = os.WriteFile(filepath.Join(pDir, "behavior.json"), bData, 0644)

	// Initialize components
	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Failed to create storage: %v", err)
	}
	defer store.Close()

	personaMgr := persona.NewPersonaManager(personasDir)
	if _, err := personaMgr.LoadPersona(personaID); err != nil {
		t.Fatalf("Failed to load persona: %v", err)
	}

	memoryEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 3000})

	// Create orchestrator with mock/empty LLM config (triggers fallback generator)
	orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{})

	// Run ProcessMessage
	res, err := orch.ProcessMessage("sess_100", "user_bob", "你好呀，今天在干嘛呢？")
	if err != nil {
		t.Fatalf("ProcessMessage failed: %v", err)
	}

	// Verify honest critic output
	if res.Critic.Status != "not_run" {
		t.Errorf("Expected critic status 'not_run', got '%s'", res.Critic.Status)
	}
	if res.Critic.Score != nil {
		t.Errorf("Expected critic score to be nil when not run, got %v", *res.Critic.Score)
	}

	// Verify 0% fallback to legacy boilerplate
	if strings.Contains(res.FinalMessage, "在呢，怎么啦~") {
		t.Errorf("FinalMessage must never contain '在呢，怎么啦~', got: %s", res.FinalMessage)
	}

	// Verify CommitInteraction committed both inMsg and outMsg atomically to SQLite
	recentMsgs := store.GetRecentMessages("sess_100", 10)
	if len(recentMsgs) != 2 {
		t.Fatalf("Expected exactly 2 messages committed to DB, got %d", len(recentMsgs))
	}
	if recentMsgs[0].Content != "你好呀，今天在干嘛呢？" {
		t.Errorf("InMessage content mismatch: %s", recentMsgs[0].Content)
	}
	if recentMsgs[1].Sender != "Alice" {
		t.Errorf("OutMessage sender mismatch: %s", recentMsgs[1].Sender)
	}

	// Verify Scheduler updated from persona's behavior model (short bucket median = 1100)
	if res.Schedule.Bucket != "short" {
		t.Errorf("Expected schedule bucket 'short', got '%s'", res.Schedule.Bucket)
	}
}

func TestRuntime_SanitizeOutput_NoFalsePositives(t *testing.T) {
	innocentPhrases := []string{
		"正在处理任务好累呀",
		"你想让我做什么好吃的",
		"收到数字1啦",
		"作为您的好朋友，我一定会支持你的",
		"作为一个普通人，我也会感到难过",
		"作为一个朋友，我觉得你应该去试试",
		"你怎么啦？遇到什么难处了吗？",
		"检查下 async / await 的调用逻辑",
		"需要我做什么准备吗",
		"有什么指令我不太懂",
	}

	for _, phrase := range innocentPhrases {
		sanitized := runtime.SanitizeOutput(phrase, "Alice")
		if sanitized != phrase {
			t.Errorf("SanitizeOutput false-positively altered phrase '%s' -> '%s'", phrase, sanitized)
		}
		if strings.Contains(sanitized, "在呢，怎么啦~") {
			t.Errorf("SanitizeOutput leaked boilerplate '在呢，怎么啦~' on '%s'", phrase)
		}
	}
}

func TestRuntime_SanitizeOutput_TrueAIMarkersAndZeroBoilerplate(t *testing.T) {
	aiInputs := []struct {
		input       string
		fallback    string
		expectClean bool
	}{
		{
			input:       "作为一个AI语言模型，我无法回答这个问题",
			fallback:    "在写方案呢，晚点回复你哦",
			expectClean: false,
		},
		{
			input:       "作为人工智能助手，很高兴为你服务",
			fallback:    "刚才在忙呢",
			expectClean: false,
		},
		{
			input:       "我是由OpenAI训练的大型语言模型",
			fallback:    "在自习室呢",
			expectClean: false,
		},
		{
			input:       "",
			fallback:    "稍等下哈",
			expectClean: false,
		},
	}

	for _, tc := range aiInputs {
		sanitized := runtime.SanitizeOutput(tc.input, "Alice", tc.fallback)

		if strings.Contains(sanitized, "在呢，怎么啦~") {
			t.Errorf("SanitizeOutput returned boilerplate '在呢，怎么啦~' for input '%s'", tc.input)
		}
		if strings.Contains(sanitized, "AI语言模型") || strings.Contains(sanitized, "人工智能") || strings.Contains(sanitized, "OpenAI") {
			t.Errorf("SanitizeOutput failed to strip AI markers: %s", sanitized)
		}
		if tc.fallback != "" && sanitized != tc.fallback {
			t.Errorf("Expected fallback '%s', got '%s'", tc.fallback, sanitized)
		}
	}

	// Mixed sentence: AI clause stripped, natural clause preserved
	mixed := "作为一个AI语言模型，我不能这么做。但是你可以试试换元法！"
	sanitizedMixed := runtime.SanitizeOutput(mixed, "Alice")
	if strings.Contains(sanitizedMixed, "AI语言模型") {
		t.Errorf("SanitizeOutput failed to remove AI marker from mixed sentence: %s", sanitizedMixed)
	}
	if !strings.Contains(sanitizedMixed, "但是你可以试试换元法") {
		t.Errorf("SanitizeOutput removed valid content from mixed sentence: %s", sanitizedMixed)
	}
}

func TestRuntime_TimeoutConfiguration(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_timeout.db")
	personasDir := filepath.Join(tempDir, "personas")

	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("NewStorage failed: %v", err)
	}
	defer store.Close()

	personaMgr := persona.NewPersonaManager(personasDir)
	memoryEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 3000})

	// 1. Default timeout: 15s (when TimeoutMs = 0)
	orchDef := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{})
	if orchDef.GetClientTimeout() != 15*time.Second {
		t.Errorf("Expected default timeout 15s, got %v", orchDef.GetClientTimeout())
	}

	// 2. Minimum bound: 5s (when TimeoutMs = 2000)
	orchLow := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{TimeoutMs: 2000})
	if orchLow.GetClientTimeout() != 5*time.Second {
		t.Errorf("Expected lower bound 5s, got %v", orchLow.GetClientTimeout())
	}

	// 3. Maximum bound: 15s (when TimeoutMs = 45000 legacy)
	orchHigh := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{TimeoutMs: 45000})
	if orchHigh.GetClientTimeout() != 15*time.Second {
		t.Errorf("Expected upper bound 15s, got %v", orchHigh.GetClientTimeout())
	}

	// 4. Valid configured timeout: 10s
	orchMid := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{TimeoutMs: 10000})
	if orchMid.GetClientTimeout() != 10*time.Second {
		t.Errorf("Expected configured timeout 10s, got %v", orchMid.GetClientTimeout())
	}
}

func TestRuntime_SinglePassGeneration(t *testing.T) {
	var generationCalls int32
	var criticCalls int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bodyBytes, _ := io.ReadAll(r.Body)
		bodyStr := string(bodyBytes)

		if strings.Contains(bodyStr, "Evaluate these candidates") {
			atomic.AddInt32(&criticCalls, 1)
		} else if !strings.Contains(bodyStr, "Extract memories") {
			atomic.AddInt32(&generationCalls, 1)
		}

		// Return authentic direct single-pass colloquial text (NO 3-candidate JSON)
		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "哈哈好呀，晚点去吃二食堂",
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_single_pass.db")
	personasDir := filepath.Join(tempDir, "personas")
	personaID := "bob_test"
	pDir := filepath.Join(personasDir, personaID)
	_ = os.MkdirAll(pDir, 0755)

	manifest := map[string]interface{}{"name": "Bob", "version": "1.1.0"}
	manData, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(pDir, "manifest.json"), manData, 0644)

	personaDetails := map[string]interface{}{
		"id":             personaID,
		"name":           "Bob",
		"target_speaker": "Bob",
		"system_prompts": map[string]interface{}{
			"generator": "You are Bob. Reply directly in casual dialogue.",
			"critic":    "You are Critic.",
		},
	}
	pData, _ := json.Marshal(personaDetails)
	_ = os.WriteFile(filepath.Join(pDir, "persona.json"), pData, 0644)

	store, _ := storage.NewStorage(dbPath)
	defer store.Close()

	personaMgr := persona.NewPersonaManager(personasDir)
	_, _ = personaMgr.LoadPersona(personaID)

	memoryEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 2500})

	orch := runtime.NewOrchestrator(store, personaMgr, memoryEng, sched, runtime.LLMConfig{
		BaseURL:   server.URL,
		Model:     "test-model",
		TimeoutMs: 15000,
	})

	res, err := orch.ProcessMessage("sess_single", "user_alice", "晚上一起吃饭吗？")
	if err != nil {
		t.Fatalf("ProcessMessage failed: %v", err)
	}

	// Verify single-pass generation output
	if res.FinalMessage != "哈哈好呀，晚点去吃二食堂" {
		t.Errorf("Expected direct message '哈哈好呀，晚点去吃二食堂', got: '%s'", res.FinalMessage)
	}
	if res.CandidateA != "哈哈好呀，晚点去吃二食堂" {
		t.Errorf("Expected CandidateA match FinalMessage, got: '%s'", res.CandidateA)
	}

	// Verify Critic was honest and bypassed (not_run)
	if res.Critic.Status != "not_run" {
		t.Errorf("Expected Critic status 'not_run', got '%s'", res.Critic.Status)
	}
	if res.Critic.Score != nil {
		t.Errorf("Expected Critic score nil, got %v", *res.Critic.Score)
	}

	// Verify Style Critic LLM call was eliminated (0 critic calls) and generation was direct single-pass (1 call)
	if atomic.LoadInt32(&generationCalls) != 1 {
		t.Errorf("Expected exactly 1 dialogue generation call, got %d", atomic.LoadInt32(&generationCalls))
	}
	if atomic.LoadInt32(&criticCalls) != 0 {
		t.Errorf("Expected 0 Style Critic calls (bypassed from online path), got %d", atomic.LoadInt32(&criticCalls))
	}
}

func TestRuntime_SinglePassGeneration_ThinkTagsAndPrefixStripping(t *testing.T) {
	testCases := []struct {
		name        string
		rawOutput   string
		expectedMsg string
	}{
		{
			name:        "Think tags stripped",
			rawOutput:   "<think>Let me ponder what to say</think>知道啦，等我一下",
			expectedMsg: "知道啦，等我一下",
		},
		{
			name:        "Speaker prefix stripped",
			rawOutput:   "Bob: 知道啦，等我一下",
			expectedMsg: "知道啦，等我一下",
		},
		{
			name:        "Trailing full stop stripped",
			rawOutput:   "知道了，等我下。",
			expectedMsg: "知道了，等我下",
		},
		{
			name:        "Outer quotes stripped",
			rawOutput:   `"马上就来啦"`,
			expectedMsg: "马上就来啦",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				resp := map[string]interface{}{
					"choices": []map[string]interface{}{
						{"message": map[string]interface{}{"content": tc.rawOutput}},
					},
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(resp)
			}))
			defer server.Close()

			tempDir := t.TempDir()
			dbPath := filepath.Join(tempDir, "test_prefix.db")
			personasDir := filepath.Join(tempDir, "personas")
			personaID := "bob_test2"
			pDir := filepath.Join(personasDir, personaID)
			_ = os.MkdirAll(pDir, 0755)

			manifest := map[string]interface{}{"name": "Bob", "version": "1.1.0"}
			manData, _ := json.Marshal(manifest)
			_ = os.WriteFile(filepath.Join(pDir, "manifest.json"), manData, 0644)

			personaDetails := map[string]interface{}{
				"id":             personaID,
				"name":           "Bob",
				"target_speaker": "Bob",
				"system_prompts": map[string]interface{}{"generator": "You are Bob."},
			}
			pData, _ := json.Marshal(personaDetails)
			_ = os.WriteFile(filepath.Join(pDir, "persona.json"), pData, 0644)

			store, _ := storage.NewStorage(dbPath)
			defer store.Close()

			personaMgr := persona.NewPersonaManager(personasDir)
			_, _ = personaMgr.LoadPersona(personaID)

			orch := runtime.NewOrchestrator(store, personaMgr, memory.NewEngine(store), scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 2500}), runtime.LLMConfig{
				BaseURL:   server.URL,
				Model:     "test-model",
				TimeoutMs: 15000,
			})

			res, err := orch.ProcessMessage("sess_prefix", "user_alice", "快点来呀")
			if err != nil {
				t.Fatalf("ProcessMessage failed: %v", err)
			}
			if res.FinalMessage != tc.expectedMsg {
				t.Errorf("[%s] Expected '%s', got '%s'", tc.name, tc.expectedMsg, res.FinalMessage)
			}
		})
	}
}

func TestRuntime_ZeroBoilerplateFallbackAcrossTurns(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_zero_boilerplate.db")
	personasDir := filepath.Join(tempDir, "personas")
	personaID := "charlie_test"
	pDir := filepath.Join(personasDir, personaID)
	_ = os.MkdirAll(pDir, 0755)

	manifest := map[string]interface{}{"name": "Charlie", "version": "1.1.0"}
	manData, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(pDir, "manifest.json"), manData, 0644)

	personaDetails := map[string]interface{}{
		"id":             personaID,
		"name":           "Charlie",
		"target_speaker": "Charlie",
		"linguistic_fingerprint": map[string]interface{}{
			"openers": []string{"在呢~ 刚看到", "早呀"},
			"vocabulary": map[string]interface{}{
				"catchphrases": []string{"好呀好呀"},
			},
		},
		"system_prompts": map[string]interface{}{"generator": "You are Charlie."},
	}
	pData, _ := json.Marshal(personaDetails)
	_ = os.WriteFile(filepath.Join(pDir, "persona.json"), pData, 0644)

	store, _ := storage.NewStorage(dbPath)
	defer store.Close()

	personaMgr := persona.NewPersonaManager(personasDir)
	_, _ = personaMgr.LoadPersona(personaID)

	// Orchestrator without LLM configuration (forces fallback generation on every turn)
	orch := runtime.NewOrchestrator(store, personaMgr, memory.NewEngine(store), scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 2500}), runtime.LLMConfig{})

	inputs := []string{
		"早呀，起床没？",
		"晚安啦好梦",
		"在吗在吗",
		"今天有什么好玩的？",
		"123",
		"哈哈哈哈太逗了",
	}

	for _, input := range inputs {
		res, err := orch.ProcessMessage("sess_turns", "user_alice", input)
		if err != nil {
			t.Fatalf("ProcessMessage failed on input '%s': %v", input, err)
		}

		// Strictly assert 0% occurrence of legacy boilerplate
		if res.FinalMessage == "在呢，怎么啦~" || strings.Contains(res.FinalMessage, "在呢，怎么啦~") {
			t.Errorf("0%% boilerplate violation: turn produced '在呢，怎么啦~' on input '%s'", input)
		}
		if strings.TrimSpace(res.FinalMessage) == "" {
			t.Errorf("Empty message returned on turn with input '%s'", input)
		}
	}
}

func TestRuntime_ChineseQuoteUTF8AndQuoteTrimming(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Chinese double quotation marks",
			input:    "“今天天气真好呀”",
			expected: "今天天气真好呀",
		},
		{
			name:     "Chinese double quotation marks without trailing ya",
			input:    "“今天天气真好”",
			expected: "今天天气真好",
		},
		{
			name:     "Chinese single quotation marks",
			input:    "‘今天天气真好呀’",
			expected: "今天天气真好呀",
		},
		{
			name:     "Standard ASCII double quotation marks",
			input:    "\"今天天气真好呀\"",
			expected: "今天天气真好呀",
		},
		{
			name:     "Standard ASCII single quotation marks",
			input:    "'今天天气真好呀'",
			expected: "今天天气真好呀",
		},
		{
			name:     "Nested Chinese and ASCII quotation marks",
			input:    "“\"今天天气真好呀\"”",
			expected: "今天天气真好呀",
		},
		{
			name:     "Quotation marks with leading and trailing spaces",
			input:    "  “今天天气真好呀”  ",
			expected: "今天天气真好呀",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := runtime.CleanSinglePassOutput(tc.input, "Alice")
			if got != tc.expected {
				t.Errorf("[%s] Expected %q, got %q", tc.name, tc.expected, got)
			}

			// Validate UTF-8 compliance: must be valid UTF-8
			if !utf8.ValidString(got) {
				t.Errorf("[%s] Result is not valid UTF-8: %q", tc.name, got)
			}

			// Validate JSON serialization does not produce \ufffd replacement characters
			jsonBytes, err := json.Marshal(map[string]string{"reply": got})
			if err != nil {
				t.Fatalf("[%s] json.Marshal failed: %v", tc.name, err)
			}
			jsonStr := string(jsonBytes)
			if strings.Contains(jsonStr, "\\ufffd") || strings.Contains(jsonStr, "\ufffd") {
				t.Errorf("[%s] json.Marshal emitted replacement character \\ufffd: %s", tc.name, jsonStr)
			}
		})
	}
}

func TestRuntime_SanitizeOutput_LatinWordBoundary(t *testing.T) {
	// Innocent sentences containing "我是" followed by Latin names/words starting with "ai"
	innocentCases := []struct {
		name  string
		input string
	}{
		{
			name:  "Latin name Aileen",
			input: "我是Aileen呀，晚上去吃二食堂吧",
		},
		{
			name:  "Latin product AirPods",
			input: "我是AirPods的主人，你捡到了吗？",
		},
		{
			name:  "Latin name Aidan",
			input: "我是Aidan，今晚有空出来打球吗？",
		},
		{
			name:  "Latin word airline",
			input: "我是airline地勤人员，需要核对您的信息",
		},
		{
			name:  "Latin word aim",
			input: "我是aimer的歌迷，特别喜欢她的歌",
		},
		{
			name:  "Prefix 作为 with Latin name Aileen",
			input: "作为Aileen的好朋友，我一定会支持你的",
		},
	}

	for _, tc := range innocentCases {
		t.Run(tc.name, func(t *testing.T) {
			got := runtime.SanitizeOutput(tc.input, "Alice")
			if got != tc.input {
				t.Errorf("[%s] Innocent input was falsely modified: expected %q, got %q", tc.name, tc.input, got)
			}
		})
	}

	// True AI markers that MUST be sanitized
	trueAIMarkerCases := []struct {
		name     string
		input    string
		fallback string
	}{
		{
			name:     "Standalone 我是AI",
			input:    "我是AI，很高兴认识你",
			fallback: "刚才在忙呢，怎么啦？",
		},
		{
			name:     "我是AI with full stop",
			input:    "其实我是AI。今天天气真好呀",
			fallback: "今天天气真好呀", // The AI sentence is stripped and innocent sentence preserved
		},
		{
			name:     "我是AI exact",
			input:    "我是AI",
			fallback: "刚才在忙呢，怎么啦？",
		},
		{
			name:     "我是AI助手",
			input:    "我是ai助手，有什么可以帮您",
			fallback: "刚才在忙呢，怎么啦？",
		},
		{
			name:     "Innocent sentence preserved while AI disclaimer stripped",
			input:    "我是Aileen呀。作为一个AI，我不吃饭。",
			fallback: "我是Aileen呀。",
		},
	}

	for _, tc := range trueAIMarkerCases {
		t.Run(tc.name, func(t *testing.T) {
			got := runtime.SanitizeOutput(tc.input, "Alice")
			if got != tc.fallback {
				t.Errorf("[%s] Expected %q, got %q", tc.name, tc.fallback, got)
			}
		})
	}
}

func TestRuntime_CaseInsensitiveThinkTags(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Uppercase <THINK> tags",
			input:    "<THINK>internal reasoning block</THINK>马上就到啦",
			expected: "马上就到啦",
		},
		{
			name:     "Titlecase <Think> tags",
			input:    "<Think>some thoughts</Think>马上就到啦",
			expected: "马上就到啦",
		},
		{
			name:     "Mixed case <tHiNk> tags",
			input:    "<tHiNk>mixed thinking</tHiNk>好呀好呀",
			expected: "好呀好呀",
		},
		{
			name:     "Nested <think> tags",
			input:    "<think>outer <think>inner</think> remaining thought</think>好呀好呀",
			expected: "好呀好呀",
		},
		{
			name:     "Dangling uppercase closing tag",
			input:    "</THINK>好呀好呀",
			expected: "好呀好呀",
		},
		{
			name:     "Unclosed uppercase <THINK> tag",
			input:    "好呀好呀<THINK>unclosed reasoning...",
			expected: "好呀好呀",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := runtime.CleanOutput(tc.input)
			if got != tc.expected {
				t.Errorf("[%s] Expected %q, got %q", tc.name, tc.expected, got)
			}
		})
	}
}

func TestRuntime_RepeatedSpeakerPrefixStripping(t *testing.T) {
	testCases := []struct {
		name     string
		input    string
		speaker  string
		expected string
	}{
		{
			name:     "Single speaker prefix",
			input:    "Alice: 马上就到了",
			speaker:  "Alice",
			expected: "马上就到了",
		},
		{
			name:     "Duplicated identical speaker prefix",
			input:    "Alice: Alice: 马上就到了",
			speaker:  "Alice",
			expected: "马上就到了",
		},
		{
			name:     "Tripled speaker prefix",
			input:    "Alice: Alice: Alice: 马上就到了",
			speaker:  "Alice",
			expected: "马上就到了",
		},
		{
			name:     "Speaker prefix with generic AI prefix",
			input:    "Alice: AI: 马上就到了",
			speaker:  "Alice",
			expected: "马上就到了",
		},
		{
			name:     "Generic Assistant prefix followed by speaker",
			input:    "Assistant: Alice: 马上就到了",
			speaker:  "Alice",
			expected: "马上就到了",
		},
		{
			name:     "Speaker prefix with Chinese colon",
			input:    "Alice：Alice: 马上就到了",
			speaker:  "Alice",
			expected: "马上就到了",
		},
		{
			name:     "Quoted duplicated speaker prefix",
			input:    "“Alice: Alice: 马上就到了”",
			speaker:  "Alice",
			expected: "马上就到了",
		},
		{
			name:     "Interleaved speaker prefix and quotes",
			input:    "Alice: “Alice: 马上就到了”",
			speaker:  "Alice",
			expected: "马上就到了",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := runtime.CleanSinglePassOutput(tc.input, tc.speaker)
			if got != tc.expected {
				t.Errorf("[%s] Expected %q, got %q", tc.name, tc.expected, got)
			}
		})
	}
}
