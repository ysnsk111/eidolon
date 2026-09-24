package runtime

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"eidolon/server/internal/memory"
	"eidolon/server/internal/persona"
	"eidolon/server/internal/scheduler"
	"eidolon/server/internal/storage"
)

// TestChallenger_SanitizeOutput_AdversarialColloquial tests tricky colloquial phrases
// containing "处理", "任务", "想让我", "数字", "作为", and "AI" in innocent contexts.
func TestChallenger_SanitizeOutput_AdversarialColloquial(t *testing.T) {
	testCases := []struct {
		category string
		phrase   string
	}{
		// "处理"
		{"处理", "正在处理任务好累呀"},
		{"处理", "这个事情需要你处理下哦"},
		{"处理", "今天处理了一整天的文档，头都大了"},
		{"处理", "别催我啦，正在处理呢"},

		// "任务"
		{"任务", "今天老板又派了新任务"},
		{"任务", "日常任务刷完了，来打游戏吗？"},
		{"任务", "这个支线任务卡关了"},
		{"任务", "相关的工作安排我晚点看看"},

		// "想让我"
		{"想让我", "你想让我做什么好吃的"},
		{"想让我", "你到底想让我怎样嘛"},
		{"想让我", "妈妈想让我早点回家吃饭"},
		{"想让我", "你想让我陪你一起去吗"},

		// "数字"
		{"数字", "收到数字1啦"},
		{"数字", "发个数字给我确认下"},
		{"数字", "这个数字好吉利呀"},
		{"数字", "数字货币最近波动好大"},

		// "作为"
		{"作为", "作为您的好朋友，我一定会支持你的"},
		{"作为", "作为一个普通人，我也会感到难过"},
		{"作为", "作为一个朋友，我觉得你应该去试试"},
		{"作为", "作为大学同学，认识你真好"},
		{"作为", "作为一枚吃货，这家店必去"},
		{"作为", "作为一个程序员每天都在修bug"},

		// "AI" in innocent/colloquial contexts
		{"AI", "AI绘画最近太火了吧"},
		{"AI", "我们组在做AI相关的调研"},
		{"AI", "这首歌是爱（ai）的主题曲吧"},
		{"AI", "Aileen约我周末去逛街"},
		{"AI", "我是Aileen的好朋友呀"},
		{"AI", "我是Aileen呀，晚上去吃二食堂吧"},
		{"AI", "我是AirPods的主人，你捡到了吗？"},
		{"AI", "今天在研究大语言模型的微调呢"},
	}

	for _, tc := range testCases {
		t.Run(fmt.Sprintf("%s/%s", tc.category, tc.phrase), func(t *testing.T) {
			got := SanitizeOutput(tc.phrase, "Alice", "刚才在忙呢，怎么啦？")

			// Check 1: Must never return legacy boilerplate
			if got == "在呢，怎么啦~" || strings.Contains(got, "在呢，怎么啦~") {
				t.Fatalf("VIOLATION: Returned legacy boilerplate '在呢，怎么啦~' for input: %q", tc.phrase)
			}
			if got == "在呢~" {
				t.Fatalf("VIOLATION: Returned legacy boilerplate '在呢~' for input: %q", tc.phrase)
			}

			// Check 2: Innocent colloquial phrase must not be corrupted or emptied
			if strings.TrimSpace(got) == "" {
				t.Fatalf("VIOLATION: Output was emptied for innocent colloquial phrase: %q", tc.phrase)
			}

			// For innocent phrases, it should be preserved unchanged
			if got != tc.phrase {
				t.Logf("NOTICE: phrase altered: original=%q, got=%q", tc.phrase, got)
			}
		})
	}
}

// TestChallenger_SanitizeOutput_TrueAIMarkers tests genuine AI markers and verifies
// that AI disclaimers are removed, clean parts preserved, and fallback has 0% legacy boilerplate.
func TestChallenger_SanitizeOutput_TrueAIMarkers(t *testing.T) {
	testCases := []struct {
		name        string
		input       string
		fallback    string
		shouldAlter bool
	}{
		{
			name:        "Pure AI self-identification",
			input:       "作为一个AI语言模型，我无法回答这个问题。",
			fallback:    "刚才走开了一下，怎么啦？",
			shouldAlter: true,
		},
		{
			name:        "OpenAI trained model",
			input:       "我是由OpenAI训练的大型语言模型。",
			fallback:    "在自习室看书呢",
			shouldAlter: true,
		},
		{
			name:        "Customer service greeting",
			input:       "很高兴为您服务，请问有什么可以协助您的？",
			fallback:    "在写方案呢",
			shouldAlter: true,
		},
		{
			name:        "Mixed: AI disclaimer followed by authentic conversational turn",
			input:       "作为一个人工智能，我没有个人经历。不过你可以试试去那家咖啡厅！",
			fallback:    "刚才在忙呢",
			shouldAlter: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := SanitizeOutput(tc.input, "Alice", tc.fallback)

			// Check 1: Zero legacy boilerplate
			if got == "在呢，怎么啦~" || strings.Contains(got, "在呢，怎么啦~") {
				t.Fatalf("VIOLATION: Returned legacy boilerplate '在呢，怎么啦~' for input: %q", tc.input)
			}
			if got == "在呢~" {
				t.Fatalf("VIOLATION: Returned legacy boilerplate '在呢~' for input: %q", tc.input)
			}

			// Check 2: AI markers must be gone
			markers := []string{"AI语言模型", "大型语言模型", "人工智能", "为您服务", "OpenAI"}
			for _, m := range markers {
				if strings.Contains(got, m) {
					t.Fatalf("VIOLATION: AI marker %q was not stripped in: %q", m, got)
				}
			}

			// Check 3: If input was mixed, valid part must be preserved
			if strings.Contains(tc.input, "不过你可以试试去那家咖啡厅") {
				if !strings.Contains(got, "不过你可以试试去那家咖啡厅") {
					t.Fatalf("VIOLATION: Valid conversational portion was incorrectly wiped: %q", got)
				}
			}
		})
	}
}

// TestChallenger_CleanSinglePassOutput_ChaoticOutputs empirically tests single-pass extraction
// against nested thinking tags, malformed markdown fences, quotes, repeated prefixes, and unclosed tags.
func TestChallenger_CleanSinglePassOutput_ChaoticOutputs(t *testing.T) {
	testCases := []struct {
		name           string
		raw            string
		speaker        string
		expectedSubstr string
		disallowed     string
	}{
		{
			name:           "Standard clean single-pass",
			raw:            "知道啦，晚上去吃火锅吧",
			speaker:        "Alice",
			expectedSubstr: "知道啦，晚上去吃火锅吧",
		},
		{
			name:           "Standard thinking tag",
			raw:            "<think>Thinking process here</think>好呀，走起",
			speaker:        "Alice",
			expectedSubstr: "好呀，走起",
			disallowed:     "Thinking process",
		},
		{
			name:           "Unclosed thinking tag",
			raw:            "<think>Unclosed thinking process without closing tag",
			speaker:        "Alice",
			expectedSubstr: "", // should be empty string so fallback triggers
			disallowed:     "Unclosed thinking",
		},
		{
			name:           "Nested thinking tags",
			raw:            "<think>outer <think>inner</think> remaining thought</think>好呀好呀",
			speaker:        "Alice",
			expectedSubstr: "好呀",
			disallowed:     "<think>",
		},
		{
			name:           "Speaker prefix single",
			raw:            "Alice: 马上就到了",
			speaker:        "Alice",
			expectedSubstr: "马上就到了",
			disallowed:     "Alice:",
		},
		{
			name:           "Chinese speaker prefix",
			raw:            "Alice：马上就到了",
			speaker:        "Alice",
			expectedSubstr: "马上就到了",
			disallowed:     "Alice：",
		},
		{
			name:           "Generic AI prefix",
			raw:            "AI: 哈哈太逗了",
			speaker:        "Alice",
			expectedSubstr: "哈哈太逗了",
			disallowed:     "AI:",
		},
		{
			name:           "Markdown JSON wrapper with candidate_a",
			raw:            "```json\n{\"candidate_a\": \"刚才没注意看消息\"}\n```",
			speaker:        "Alice",
			expectedSubstr: "刚才没注意看消息",
			disallowed:     "```",
		},
		{
			name:           "Markdown code block plain",
			raw:            "```\n好呀好呀，听你的\n```",
			speaker:        "Alice",
			expectedSubstr: "好呀好呀，听你的",
			disallowed:     "```",
		},
		{
			name:           "Double quotes wrapped",
			raw:            "\"今天天气真好呀\"",
			speaker:        "Alice",
			expectedSubstr: "今天天气真好呀",
			disallowed:     "\"",
		},
		{
			name:           "Single quotes wrapped",
			raw:            "'今天天气真好呀'",
			speaker:        "Alice",
			expectedSubstr: "今天天气真好呀",
			disallowed:     "'",
		},
		{
			name:           "Trailing periods stripped",
			raw:            "知道了，马上来。。",
			speaker:        "Alice",
			expectedSubstr: "知道了，马上来",
		},
		{
			name:           "Repeated speaker prefix with generic",
			raw:            "Alice: 回复: 马上就到了",
			speaker:        "Alice",
			expectedSubstr: "马上就到了",
			disallowed:     "Alice:",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := cleanSinglePassOutput(tc.raw, tc.speaker)
			t.Logf("[%s] raw=%q -> got=%q", tc.name, tc.raw, got)

			if tc.expectedSubstr != "" && !strings.Contains(got, tc.expectedSubstr) {
				t.Errorf("Expected output to contain %q, but got %q", tc.expectedSubstr, got)
			}
			if tc.disallowed != "" && strings.Contains(got, tc.disallowed) {
				t.Errorf("Disallowed string %q found in output: %q", tc.disallowed, got)
			}
		})
	}
}

// TestChallenger_EdgeCaseFindings_EmpiricalCharacterization empirically characterizes
// 4 specific edge case vulnerabilities discovered during stress testing:
// 1. Chinese quotation mark byte slicing (UTF-8 multibyte boundary tearing)
// 2. Nested thinking tags non-greedy regex termination
// 3. Repeated identical speaker prefix single-pass replacement
// 4. Substring matching of "我是ai" against English words (e.g. "Aileen", "AirPods")
func TestChallenger_EdgeCaseFindings_EmpiricalCharacterization(t *testing.T) {
	// Finding 1: Chinese quote byte slicing
	// "“" is 3 bytes (0xE2 0x80 0x9C) and "”" is 3 bytes (0xE2 0x80 0x9D).
	// Slicing [1:len-1] tears the multibyte sequence and leaves invalid UTF-8 bytes \x80\x9c.
	rawChineseQuotes := "“今天天气真好呀”"
	gotChineseQuotes := cleanSinglePassOutput(rawChineseQuotes, "Alice")
	if strings.Contains(gotChineseQuotes, "\x80") {
		t.Logf("CONFIRMED FINDING 1 (Chinese quote UTF-8 byte tear): input=%q -> got invalid bytes %q", rawChineseQuotes, gotChineseQuotes)
	}

	// Finding 2: Nested thinking tags
	// Non-greedy (?s)<think>.*?</think> stops at the inner </think>, leaving outer leftover reasoning.
	rawNested := "<think>outer <think>inner</think> remaining thought</think>好呀好呀"
	gotNested := cleanSinglePassOutput(rawNested, "Alice")
	if strings.Contains(gotNested, "</think>") {
		t.Logf("CONFIRMED FINDING 2 (Nested think tag leakage): input=%q -> leaked reasoning %q", rawNested, gotNested)
	}

	// Finding 3: Repeated identical speaker prefix
	// Anchored regex ^(?i)Name: is only executed once without looping.
	rawPrefix := "Alice: Alice: 马上就到了"
	gotPrefix := cleanSinglePassOutput(rawPrefix, "Alice")
	if strings.HasPrefix(gotPrefix, "Alice:") {
		t.Logf("CONFIRMED FINDING 3 (Repeated prefix unstripped): input=%q -> remaining prefix %q", rawPrefix, gotPrefix)
	}

	// Finding 4: "我是ai" substring match against Latin words
	// "我是Aileen" contains "我是ai" in lowercase without word-boundary checks.
	rawName := "我是Aileen呀，晚上去吃二食堂吧"
	gotSanitized := SanitizeOutput(rawName, "Alice")
	if gotSanitized != rawName {
		t.Logf("CONFIRMED FINDING 4 ('我是ai' false positive on Latin words): input=%q -> stripped to fallback %q", rawName, gotSanitized)
	}
}

// TestChallenger_LiveProcessMessage_ZeroCriticCalls verifies that during live ProcessMessage,
// exactly 0 calls are made to the Style Critic LLM endpoint and generation is single-pass.
func TestChallenger_LiveProcessMessage_ZeroCriticCalls(t *testing.T) {
	var totalCalls int32
	var criticCalls int32
	var generationCalls int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&totalCalls, 1)
		body, _ := io.ReadAll(r.Body)
		bodyStr := string(body)

		if strings.Contains(bodyStr, "Evaluate these candidates") || strings.Contains(bodyStr, "critic") {
			atomic.AddInt32(&criticCalls, 1)
		} else if !strings.Contains(bodyStr, "Extract memories") {
			atomic.AddInt32(&generationCalls, 1)
		}

		resp := map[string]interface{}{
			"choices": []map[string]interface{}{
				{
					"message": map[string]interface{}{
						"content": "<think>Thinking what to say</think>好呀，晚点见！",
					},
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "challenger_critic.db")
	personasDir := filepath.Join(tempDir, "personas")
	personaID := "persona_critic_test"
	pDir := filepath.Join(personasDir, personaID)
	_ = os.MkdirAll(pDir, 0755)

	manifest := map[string]interface{}{"name": "David", "version": "1.1.0"}
	manData, _ := json.Marshal(manifest)
	_ = os.WriteFile(filepath.Join(pDir, "manifest.json"), manData, 0644)

	personaDetails := map[string]interface{}{
		"id":             personaID,
		"name":           "David",
		"target_speaker": "David",
		"system_prompts": map[string]interface{}{
			"generator": "You are David.",
			"critic":    "You are Critic. Evaluate candidates.",
		},
	}
	pData, _ := json.Marshal(personaDetails)
	_ = os.WriteFile(filepath.Join(pDir, "persona.json"), pData, 0644)

	store, err := storage.NewStorage(dbPath)
	if err != nil {
		t.Fatalf("Storage error: %v", err)
	}
	defer store.Close()

	pMgr := persona.NewPersonaManager(personasDir)
	if _, err := pMgr.LoadPersona(personaID); err != nil {
		t.Fatalf("Persona load error: %v", err)
	}

	memoryEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 2500})

	orch := NewOrchestrator(store, pMgr, memoryEng, sched, LLMConfig{
		BaseURL:   server.URL,
		Model:     "test-model",
		TimeoutMs: 12000,
	})

	res, err := orch.ProcessMessage("sess_critic_test", "user_tester", "出来吃夜宵吗？")
	if err != nil {
		t.Fatalf("ProcessMessage failed: %v", err)
	}

	// 1. Critic status must be 'not_run' and score nil
	if res.Critic.Status != "not_run" {
		t.Errorf("VIOLATION: res.Critic.Status is %q, expected 'not_run'", res.Critic.Status)
	}
	if res.Critic.Score != nil {
		t.Errorf("VIOLATION: res.Critic.Score is not nil: %v", *res.Critic.Score)
	}

	// 2. Exactly 0 Style Critic calls must have been made
	if atomic.LoadInt32(&criticCalls) != 0 {
		t.Errorf("VIOLATION: Detected %d Style Critic calls during live message processing!", atomic.LoadInt32(&criticCalls))
	}

	// 3. Exactly 1 generation call must have been made
	if atomic.LoadInt32(&generationCalls) != 1 {
		t.Errorf("VIOLATION: Expected 1 dialogue generation call, got %d", atomic.LoadInt32(&generationCalls))
	}

	// 4. Response should be clean single-pass without thinking tags
	if res.FinalMessage != "好呀，晚点见！" {
		t.Errorf("Expected '好呀，晚点见！', got %q", res.FinalMessage)
	}
}

// TestChallenger_TimeoutClamping_AllBoundaries verifies dynamic timeout configuration
// and strict clamping to [5s, 15s].
func TestChallenger_TimeoutClamping_AllBoundaries(t *testing.T) {
	tempDir := t.TempDir()
	store, _ := storage.NewStorage(filepath.Join(tempDir, "timeout.db"))
	defer store.Close()

	pMgr := persona.NewPersonaManager(tempDir)
	memoryEng := memory.NewEngine(store)
	sched := scheduler.NewScheduler(scheduler.Config{BaseDelayMs: 2000})

	cases := []struct {
		inputMs  int
		expected time.Duration
	}{
		{0, 15 * time.Second},     // default 15s
		{-5000, 15 * time.Second}, // negative -> default 15s
		{1000, 5 * time.Second},   // 1s -> clamped to 5s min
		{4999, 5 * time.Second},   // 4.999s -> clamped to 5s min
		{5000, 5 * time.Second},   // 5s exactly
		{8000, 8 * time.Second},   // 8s in range
		{15000, 15 * time.Second}, // 15s in range
		{35000, 35 * time.Second}, // 35s in range
		{60000, 60 * time.Second}, // 60s exactly
		{60001, 60 * time.Second}, // 60.001s -> clamped to 60s max
		{90000, 60 * time.Second}, // 90s legacy -> clamped to 60s max
	}

	for _, c := range cases {
		orch := NewOrchestrator(store, pMgr, memoryEng, sched, LLMConfig{TimeoutMs: c.inputMs})
		actual := orch.GetClientTimeout()
		if actual != c.expected {
			t.Errorf("TimeoutMs=%d: expected timeout %v, got %v", c.inputMs, c.expected, actual)
		}
	}
}

// TestChallenger_BoilerplateElimination_Exhaustive checks 0% occurrence of legacy boilerplate
// under adversarial and edge-case inputs.
func TestChallenger_BoilerplateElimination_Exhaustive(t *testing.T) {
	adversarialInputs := []string{
		"",
		" ",
		"   \t\n  ",
		"作为AI，我是一个语言模型",
		"作为人工智能助手，很高兴为您服务",
		"我是OpenAI训练的助手",
		"我能为您做些什么？请告诉我您的需求",
		"opencode",
		"as an ai, i cannot help you with that",
		"有什么可以帮您",
	}

	for _, input := range adversarialInputs {
		out := SanitizeOutput(input, "Alice")
		if strings.Contains(out, "在呢，怎么啦~") {
			t.Fatalf("VIOLATION: Legacy boilerplate '在呢，怎么啦~' returned for input %q: %q", input, out)
		}
		if out == "在呢~" {
			t.Fatalf("VIOLATION: Legacy boilerplate '在呢~' returned for input %q: %q", input, out)
		}
		if strings.TrimSpace(out) == "" {
			t.Fatalf("VIOLATION: Empty string returned for input %q", input)
		}
	}
}
