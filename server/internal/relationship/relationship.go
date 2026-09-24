package relationship

import (
	"encoding/json"
	"math"
	"math/rand"
	"regexp"
	"strings"
	"sync"
	"time"
)

// RelationshipPhase represents discrete relational macro states in the Behavioral State Machine (BSM).
type RelationshipPhase string

const (
	PhaseNormal     RelationshipPhase = "NORMAL"
	PhaseWarm       RelationshipPhase = "WARM"
	PhaseDistant    RelationshipPhase = "DISTANT"
	PhaseAnnoyed    RelationshipPhase = "ANNOYED"
	PhaseConflict   RelationshipPhase = "CONFLICT"
	PhaseCold       RelationshipPhase = "COLD"
	PhaseRecovering RelationshipPhase = "RECOVERING"
)

// StrategyType represents the planner's selected response strategy before LLM generation.
type StrategyType string

const (
	StrategyDirectReply  StrategyType = "DIRECT_REPLY"
	StrategyShortReply   StrategyType = "SHORT_REPLY"
	StrategyIgnore       StrategyType = "IGNORE"
	StrategyDelayedReply StrategyType = "DELAYED_REPLY"
	StrategyQuestionBack StrategyType = "QUESTION_BACK"
	StrategyTease        StrategyType = "TEASE"
	StrategyComfort      StrategyType = "COMFORT"
	StrategyApologize    StrategyType = "APOLOGIZE"
	StrategyDistance     StrategyType = "DISTANCE"
	StrategyConflict     StrategyType = "CONFLICT"
	StrategyStickerOnly  StrategyType = "STICKER_ONLY"
	StrategyMultiMessage StrategyType = "MULTI_MESSAGE"
)

// Continuous multi-dimensional relationship variables (0.0 ~ 1.0)
type RelationshipState struct {
	Affinity        float64           `json:"affinity"`         // 亲近程度
	Trust           float64           `json:"trust"`            // 信任程度
	Warmth          float64           `json:"warmth"`           // 亲密/温柔程度
	Irritation      float64           `json:"irritation"`       // 当前不爽程度
	Hurt            float64           `json:"hurt"`             // 被伤害程度
	Engagement      float64           `json:"engagement"`       // 当前聊天意愿
	Tension         float64           `json:"tension"`          // 当前关系紧张度
	Initiative      float64           `json:"initiative"`       // 主动聊天倾向
	Phase           RelationshipPhase `json:"phase"`            // BSM 离散阶段
	LastInteraction time.Time         `json:"last_interaction"` // 上次交互时间
}

// Continuous multi-dimensional emotional state (0.0 ~ 1.0)
type EmotionalState struct {
	Anger         float64 `json:"anger"`         // 愤怒
	Annoyance     float64 `json:"annoyance"`     // 烦躁
	Affection     float64 `json:"affection"`     // 喜爱/依恋
	Sadness       float64 `json:"sadness"`       // 伤心/难过
	Happiness     float64 `json:"happiness"`     // 开心
	Embarrassment float64 `json:"embarrassment"` // 尴尬/害羞
	Loneliness    float64 `json:"loneliness"`    // 孤独
	Excitement    float64 `json:"excitement"`    // 兴奋
}

// PerceptionResult represents the outcome of the incoming message perception layer.
type PerceptionResult struct {
	Intent          string  `json:"intent"`           // complaint, apology, affection, question, tease, provocation, greeting, chat, short_ack
	Sentiment       float64 `json:"sentiment"`        // -1.0 to 1.0
	Pressure        float64 `json:"pressure"`         // 0.0 to 1.0
	Affection       float64 `json:"affection"`        // 0.0 to 1.0
	Humor           float64 `json:"humor"`            // 0.0 to 1.0
	Importance      float64 `json:"importance"`       // 0.0 to 1.0
	ApologyStrength float64 `json:"apology_strength"` // 0.0 to 1.0
	RequiresReply   bool    `json:"requires_reply"`
}

// ResponsePlan holds the planned behavioral response attributes.
type ResponsePlan struct {
	Strategy           StrategyType `json:"strategy"`
	Warmth             float64      `json:"warmth"`
	LengthGuidance     string       `json:"length_guidance"` // "short"|"medium"|"long"
	MessageCount       int          `json:"message_count"`   // 1, 2, 3
	SplitGapSeconds    float64      `json:"split_gap_seconds"`
	StickerProbability float64      `json:"sticker_probability"`
	SuggestedEmoji     string       `json:"suggested_emoji,omitempty"`
	SuggestedSticker   string       `json:"suggested_sticker,omitempty"`
	ShouldDelete       bool         `json:"should_delete"`        // PostSendBehavior retract
	DeleteDelayMs      int          `json:"delete_delay_ms"`      // delay before retracting
	FollowupText       string       `json:"followup_text,omitempty"` // follow-up text after retraction (e.g. "……")
	ColdnessScore      float64      `json:"coldness_score"`
}

// FullSessionState stores the active runtime relationship and emotional state for a session.
type FullSessionState struct {
	SessionID    string            `json:"session_id"`
	UserID       string            `json:"user_id"`
	Relationship RelationshipState `json:"relationship"`
	Emotion      EmotionalState    `json:"emotion"`
}

// Engine manages relationship and behavioral simulation per session.
type Engine struct {
	mu       sync.RWMutex
	states   map[string]*FullSessionState
	rng      *rand.Rand
	lambda   float64 // state inertia factor (0.85 ~ 0.90)
}

// NewEngine creates a new L4 Dynamic Relationship Engine.
func NewEngine() *Engine {
	return &Engine{
		states: make(map[string]*FullSessionState),
		rng:    rand.New(rand.NewSource(time.Now().UnixNano())),
		lambda: 0.88,
	}
}

// DefaultRelationshipState creates an authentic neutral-warm initial baseline.
func DefaultRelationshipState() RelationshipState {
	return RelationshipState{
		Affinity:        0.65,
		Trust:           0.65,
		Warmth:          0.60,
		Irritation:      0.05,
		Hurt:            0.02,
		Engagement:      0.75,
		Tension:         0.08,
		Initiative:      0.60,
		Phase:           PhaseNormal,
		LastInteraction: time.Now().UTC(),
	}
}

// DefaultEmotionalState creates an authentic initial baseline emotion.
func DefaultEmotionalState() EmotionalState {
	return EmotionalState{
		Anger:         0.02,
		Annoyance:     0.05,
		Affection:     0.45,
		Sadness:       0.02,
		Happiness:     0.55,
		Embarrassment: 0.05,
		Loneliness:    0.10,
		Excitement:    0.35,
	}
}

// GetOrCreateState returns the active state for a session or creates a default one.
func (e *Engine) GetOrCreateState(sessionID, userID string) *FullSessionState {
	e.mu.Lock()
	defer e.mu.Unlock()

	state, exists := e.states[sessionID]
	if !exists {
		state = &FullSessionState{
			SessionID:    sessionID,
			UserID:       userID,
			Relationship: DefaultRelationshipState(),
			Emotion:      DefaultEmotionalState(),
		}
		e.states[sessionID] = state
	}
	return state
}

// Perceive extracts perception variables from the incoming text and recent context.
func (e *Engine) Perceive(userContent string, recentContext []string) PerceptionResult {
	trimmed := strings.TrimSpace(userContent)
	lower := strings.ToLower(trimmed)

	res := PerceptionResult{
		Intent:        "chat",
		Sentiment:     0.1,
		Pressure:      0.1,
		Affection:     0.0,
		Humor:         0.0,
		Importance:    0.3,
		RequiresReply: true,
	}

	// 1. Apology Detection & Strength Calculation (Section 16)
	apologyWords := []string{"对不起", "抱歉", "我错了", "不好意思", "是我不好", "别生气", "原谅我", "sorry", "my bad"}
	for _, w := range apologyWords {
		if strings.Contains(lower, w) {
			res.Intent = "apology"
			res.ApologyStrength = 0.75
			res.Sentiment = 0.2
			// Sincere intensifiers
			if strings.Contains(lower, "真的") || strings.Contains(lower, "非常") || strings.Contains(lower, "十分") {
				res.ApologyStrength = 0.92
			}
			break
		}
	}

	// 2. Emotional Crisis / Attachment Panic / Confrontation Detection
	crisisWords := []string{"为什么离开我", "为什么要离开我", "离开我", "不能离开我", "别离开我", "不要离开我", "我做错啥了", "我做错什么了", "丢下我", "不要丢下我", "不要走", "别走", "避开我", "躲着我", "绕着我走"}
	for _, w := range crisisWords {
		if strings.Contains(lower, w) {
			res.Intent = "emotional_crisis"
			res.Sentiment = -0.60
			res.Pressure = 0.90
			res.Importance = 0.95
			return res
		}
	}

	// 3. Demand / Guilt-tripping / Checking-in Detection
	demandWords := []string{"难道不应该", "为什么不跟我打招呼", "不该跟我打招呼", "每天跟我打招呼", "天天打招呼", "每天打招呼", "查岗", "必须打招呼"}
	for _, w := range demandWords {
		if strings.Contains(lower, w) {
			res.Intent = "demand"
			res.Sentiment = -0.20
			res.Pressure = 0.60
			res.Importance = 0.60
			return res
		}
	}

	// 4. Confession / Romantic Advance Detection
	confessionWords := []string{"我喜欢你", "喜欢你", "我爱你", "爱你", "做我女朋友", "在一起吧", "想你了", "我想你"}
	for _, w := range confessionWords {
		if strings.Contains(lower, w) {
			res.Intent = "confession"
			res.Sentiment = 0.70
			res.Pressure = 0.70
			res.Affection = 0.85
			res.Importance = 0.80
			return res
		}
	}

	// 5. Complaint & Negative Emotion Detection (Section 2)
	complaintWords := []string{"怎么不理我", "又不理我", "你人呢", "去哪了", "回这么慢", "烦人", "讨厌", "无语", "生气"}
	for _, w := range complaintWords {
		if strings.Contains(lower, w) {
			res.Intent = "complaint"
			res.Sentiment = -0.45
			res.Pressure = 0.55
			// Context check: is it complaint + attachment seeking?
			if strings.Contains(lower, "理我") || strings.Contains(lower, "去哪") {
				res.Affection = 0.35 // attachment seeking
			}
			break
		}
	}

	// 6. Provocation / Conflict Escalation (Section 15)
	provocationWords := []string{"你滚", "有病", "傻逼", "闭嘴", "烦死了", "受够了", "懒得理你", "分手", "别说了"}
	for _, w := range provocationWords {
		if strings.Contains(lower, w) {
			res.Intent = "provocation"
			res.Sentiment = -0.85
			res.Pressure = 0.80
			res.Importance = 0.85
			break
		}
	}

	// 7. General Affection / Sweet interaction
	affectionWords := []string{"想你", "宝", "好可怜", "乖", "早安", "晚安", "抱抱", "摸摸"}
	for _, w := range affectionWords {
		if strings.Contains(lower, w) {
			res.Intent = "affection"
			res.Sentiment = 0.80
			res.Affection = 0.85
			break
		}
	}

	// 5. Questions / Inquiries
	if strings.HasSuffix(trimmed, "?") || strings.HasSuffix(trimmed, "？") ||
		strings.Contains(trimmed, "吗") || strings.Contains(trimmed, "什么") ||
		strings.Contains(trimmed, "怎么") || strings.Contains(trimmed, "为什么") {
		if res.Intent == "chat" {
			res.Intent = "question"
			res.Importance = 0.5
		}
	}

	// 6. Teasing / Humor
	if strings.Contains(lower, "哈哈") || strings.Contains(lower, "233") || strings.Contains(lower, "笑死") || strings.Contains(lower, "笨蛋") {
		res.Humor = 0.70
		if res.Intent == "chat" {
			res.Intent = "tease"
		}
	}

	// 7. Short acknowledgments (e.g. "1", "123", "嗯", "好", "ok")
	if len([]rune(trimmed)) <= 3 {
		if res.Intent == "chat" {
			res.Intent = "short_ack"
			res.Importance = 0.2
		}
	}

	return res
}

// Step performs state transitions: temporal decay, stimulus application, reconciliation, and phase evaluation.
func (e *Engine) Step(state *FullSessionState, p PerceptionResult) {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now().UTC()
	dtHours := now.Sub(state.Relationship.LastInteraction).Hours()
	if dtHours < 0 {
		dtHours = 0
	}
	state.Relationship.LastInteraction = now

	// 1. Temporal Decay & Recovery Functions (Section 5)
	// irritation: tau = 6 hours
	state.Relationship.Irritation *= math.Exp(-dtHours / 6.0)
	// hurt: tau = 24 hours
	state.Relationship.Hurt *= math.Exp(-dtHours / 24.0)
	// tension: tau = 4 hours
	state.Relationship.Tension *= math.Exp(-dtHours / 4.0)
	// emotion decay
	state.Emotion.Anger *= math.Exp(-dtHours / 2.0)
	state.Emotion.Annoyance *= math.Exp(-dtHours / 3.0)
	state.Emotion.Excitement *= math.Exp(-dtHours / 4.0)

	// 2. Apology & Reconciliation Mathematical Model (Section 16)
	if p.Intent == "apology" && p.ApologyStrength > 0.2 {
		apStrength := p.ApologyStrength
		state.Relationship.Hurt *= (1.0 - 0.45*apStrength)
		state.Relationship.Trust = math.Min(1.0, state.Relationship.Trust+0.12*apStrength)
		state.Relationship.Irritation *= (1.0 - 0.50*apStrength)
		state.Relationship.Tension *= (1.0 - 0.40*apStrength)
		state.Emotion.Anger *= (1.0 - 0.60*apStrength)
		state.Emotion.Annoyance *= (1.0 - 0.50*apStrength)

		// Smooth state progression: CONFLICT/COLD -> RECOVERING
		if state.Relationship.Phase == PhaseConflict || state.Relationship.Phase == PhaseCold || state.Relationship.Phase == PhaseAnnoyed {
			state.Relationship.Phase = PhaseRecovering
		}
	}

	// 3. Stimulus Vector Calculation X(t) (Section 4)
	deltaAffection := 0.0
	deltaIrritation := 0.0
	deltaTrust := 0.0
	deltaHurt := 0.0
	deltaWarmth := 0.0
	deltaTension := 0.0

	switch p.Intent {
	case "provocation":
		deltaIrritation += 0.35 * (1.0 + p.Pressure)
		deltaHurt += 0.40
		deltaTrust -= 0.25
		deltaWarmth -= 0.30
		deltaTension += 0.40
		state.Emotion.Anger = clampFloat(state.Emotion.Anger+0.45, 0, 1)
		state.Emotion.Annoyance = clampFloat(state.Emotion.Annoyance+0.50, 0, 1)
	case "complaint":
		deltaIrritation += 0.15
		deltaTension += 0.15
		if p.Affection > 0 { // attachment seeking: softens blow
			deltaAffection += 0.10
			deltaWarmth += 0.05
		}
		state.Emotion.Annoyance = clampFloat(state.Emotion.Annoyance+0.20, 0, 1)
	case "confession":
		state.Emotion.Embarrassment = clampFloat(state.Emotion.Embarrassment+0.65, 0, 1)
		state.Emotion.Annoyance = clampFloat(state.Emotion.Annoyance+0.20, 0, 1)
		deltaTension += 0.35
		deltaAffection += 0.12
		deltaWarmth += 0.05
	case "emotional_crisis":
		deltaTension += 0.45
		deltaIrritation += 0.20
		state.Emotion.Annoyance = clampFloat(state.Emotion.Annoyance+0.35, 0, 1)
		state.Emotion.Embarrassment = clampFloat(state.Emotion.Embarrassment+0.30, 0, 1)
		state.Relationship.Tension = clampFloat(state.Relationship.Tension+0.45, 0, 1)
	case "demand":
		deltaIrritation += 0.15
		state.Emotion.Annoyance = clampFloat(state.Emotion.Annoyance+0.25, 0, 1)
	case "affection":
		deltaAffection += 0.20 * p.Affection
		deltaWarmth += 0.18
		deltaTrust += 0.10
		deltaIrritation -= 0.15
		deltaTension -= 0.15
		state.Emotion.Affection = clampFloat(state.Emotion.Affection+0.25, 0, 1)
		state.Emotion.Happiness = clampFloat(state.Emotion.Happiness+0.20, 0, 1)
	case "tease":
		if state.Relationship.Warmth > 0.5 {
			deltaAffection += 0.08
			state.Emotion.Happiness = clampFloat(state.Emotion.Happiness+0.15, 0, 1)
			state.Emotion.Embarrassment = clampFloat(state.Emotion.Embarrassment+0.12, 0, 1)
		} else {
			deltaIrritation += 0.10
			state.Emotion.Annoyance = clampFloat(state.Emotion.Annoyance+0.10, 0, 1)
		}
	case "short_ack":
		// short neutral stimulus
		deltaWarmth -= 0.02
	default:
		if p.Sentiment > 0.3 {
			deltaWarmth += 0.06
			deltaAffection += 0.05
			state.Emotion.Happiness = clampFloat(state.Emotion.Happiness+0.08, 0, 1)
		}
	}

	// 4. State Update Equation: S(t+1) = clamp(lambda * S(t) + W * X(t) + eps, 0, 1)
	eps := (e.rng.Float64() - 0.5) * 0.02 // slight perturbation
	state.Relationship.Affinity = clampFloat(e.lambda*state.Relationship.Affinity+deltaAffection+eps, 0.0, 1.0)
	state.Relationship.Trust = clampFloat(e.lambda*state.Relationship.Trust+deltaTrust+eps, 0.0, 1.0)
	state.Relationship.Warmth = clampFloat(e.lambda*state.Relationship.Warmth+deltaWarmth+eps, 0.0, 1.0)
	state.Relationship.Irritation = clampFloat(e.lambda*state.Relationship.Irritation+deltaIrritation+eps, 0.0, 1.0)
	state.Relationship.Hurt = clampFloat(e.lambda*state.Relationship.Hurt+deltaHurt+eps, 0.0, 1.0)
	state.Relationship.Tension = clampFloat(e.lambda*state.Relationship.Tension+deltaTension+eps, 0.0, 1.0)

	// 5. Evaluate Continuous Coldness (Section 6)
	coldness := clampFloat(0.50*state.Relationship.Irritation+0.35*state.Relationship.Hurt+0.20*state.Relationship.Tension-0.35*state.Relationship.Warmth, 0.0, 1.0)

	// 6. Behavioral State Machine (BSM) Phase Evaluation (Section 17)
	if state.Relationship.Phase == PhaseRecovering {
		if coldness < 0.25 && state.Relationship.Hurt < 0.20 {
			state.Relationship.Phase = PhaseNormal
		}
	} else if coldness > 0.65 {
		if state.Relationship.Hurt > 0.50 && state.Relationship.Irritation > 0.45 {
			state.Relationship.Phase = PhaseConflict
		} else {
			state.Relationship.Phase = PhaseCold
		}
	} else if state.Relationship.Irritation > 0.40 {
		state.Relationship.Phase = PhaseAnnoyed
	} else if coldness > 0.35 {
		state.Relationship.Phase = PhaseDistant
	} else if state.Relationship.Warmth > 0.70 && state.Relationship.Affinity > 0.65 {
		state.Relationship.Phase = PhaseWarm
	} else {
		state.Relationship.Phase = PhaseNormal
	}
}

// PlanResponse decides the response strategy, message splitting, stickers, emojis, and post-send behavior.
func (e *Engine) PlanResponse(state *FullSessionState, p PerceptionResult) ResponsePlan {
	e.mu.RLock()
	defer e.mu.RUnlock()

	rel := state.Relationship
	emo := state.Emotion
	coldness := clampFloat(0.50*rel.Irritation+0.35*rel.Hurt+0.20*rel.Tension-0.35*rel.Warmth, 0.0, 1.0)

	plan := ResponsePlan{
		Strategy:           StrategyDirectReply,
		Warmth:             rel.Warmth,
		LengthGuidance:     "medium",
		MessageCount:       1,
		SplitGapSeconds:    1.2,
		StickerProbability: 0.08,
		ColdnessScore:      coldness,
	}

	// Overriding intents that mandate specific tsundere behaviors regardless of phase:
	if p.Intent == "confession" {
		plan.Strategy = StrategyTease
		plan.Warmth = 0.35
		plan.LengthGuidance = "short"
		plan.SuggestedEmoji = "😅"
	} else if p.Intent == "emotional_crisis" {
		plan.Strategy = StrategyDistance
		plan.Warmth = 0.20
		plan.LengthGuidance = "short"
		plan.SuggestedEmoji = ""
	} else if p.Intent == "demand" {
		plan.Strategy = StrategyShortReply
		plan.Warmth = 0.35
		plan.LengthGuidance = "short"
		plan.SuggestedEmoji = "😂"
	} else {
		// 1. Determine High-Level Strategy (Section 14)
		switch rel.Phase {
		case PhaseConflict:
			plan.Strategy = StrategyConflict
			plan.Warmth = 0.15
			plan.LengthGuidance = "short"
			plan.StickerProbability = 0.02
			plan.MessageCount = 1
		case PhaseCold:
			plan.Strategy = StrategyDistance
			plan.Warmth = 0.25
			plan.LengthGuidance = "short"
			plan.StickerProbability = 0.04
			plan.MessageCount = 1
		case PhaseAnnoyed:
			plan.Strategy = StrategyShortReply
			plan.Warmth = 0.35
			plan.LengthGuidance = "short"
			plan.StickerProbability = 0.05
		case PhaseRecovering:
			plan.Strategy = StrategyDirectReply
			plan.Warmth = 0.50
			plan.LengthGuidance = "medium"
			plan.StickerProbability = 0.12
		case PhaseWarm:
			if p.Intent == "tease" {
				plan.Strategy = StrategyTease
			} else if p.Intent == "affection" {
				plan.Strategy = StrategyComfort
			} else {
				plan.Strategy = StrategyDirectReply
			}
			plan.Warmth = 0.85
			plan.LengthGuidance = "medium"
			plan.StickerProbability = 0.25
		default:
			// Normal phase
			if p.Intent == "question" {
				plan.Strategy = StrategyDirectReply
			} else if p.Intent == "short_ack" {
				plan.Strategy = StrategyShortReply
				plan.LengthGuidance = "short"
			} else if p.Intent == "complaint" {
				plan.Strategy = StrategyComfort
			} else {
				plan.Strategy = StrategyDirectReply
			}
		}
	}

	// 2. Message Splitting Probability (Section 9)
	// Higher warmth or teasing/excitement increases multi-message probability. Coldness inhibits it.
	if coldness < 0.35 && rel.Engagement > 0.60 {
		splitRoll := e.rng.Float64()
		if splitRoll < 0.25 {
			plan.MessageCount = 2
			plan.SplitGapSeconds = 0.8 + e.rng.Float64()*0.8 // 0.8s ~ 1.6s
			if splitRoll < 0.06 && emo.Excitement > 0.5 {
				plan.MessageCount = 3
			}
		}
	}

	// 3. Emoji Probability Model (Section 11)
	plan.SuggestedEmoji = e.sampleEmoji(rel, emo, p)

	// 4. Sticker Probability & Tag (Section 10)
	if e.rng.Float64() < plan.StickerProbability {
		plan.SuggestedSticker = e.sampleStickerTag(rel, emo, p)
	}

	// 5. PostSendBehavior: Retraction / Regret Equation (Section 12 & 13)
	// P(delete) = sigma(b + w1*embarrassment + w2*uncertainty + w3*impulsiveness + w4*risk - w5*confidence)
	// Base b = -2.5 (infrequent in normal settings to avoid cheap theatricality)
	b := -2.5
	w1 := 2.2 * emo.Embarrassment
	w2 := 1.2 * rel.Tension
	w3 := 1.5 * emo.Annoyance
	w4 := 1.0 * rel.Irritation
	w5 := 2.0 * rel.Trust

	z := b + w1 + w2 + w3 + w4 - w5
	probDelete := 1.0 / (1.0 + math.Exp(-z))

	// If triggered with safe threshold
	if probDelete > 0.55 && e.rng.Float64() < probDelete {
		plan.ShouldDelete = true
		plan.DeleteDelayMs = 1400 + int(e.rng.Float64()*1200) // 1.4s ~ 2.6s
		followups := []string{"……", "算了没事", "当我没说", "打错字了"}
		plan.FollowupText = followups[e.rng.Intn(len(followups))]
	}

	return plan
}

func (e *Engine) sampleEmoji(rel RelationshipState, emo EmotionalState, p PerceptionResult) string {
	// P(emoji | context, emotion, style)
	type emojiWeight struct {
		emoji  string
		weight float64
	}

	var candidates []emojiWeight
	if emo.Happiness > 0.5 || emo.Excitement > 0.4 {
		candidates = append(candidates, emojiWeight{"😂", 0.40}, emojiWeight{"👍", 0.35}, emojiWeight{"🎉", 0.25})
	}
	if emo.Annoyance > 0.4 || rel.Irritation > 0.4 {
		candidates = append(candidates, emojiWeight{"🙄", 0.45}, emojiWeight{"😅", 0.35}, emojiWeight{"🤐", 0.20})
	}
	if emo.Embarrassment > 0.4 {
		candidates = append(candidates, emojiWeight{"😅", 0.50}, emojiWeight{"🤐", 0.30}, emojiWeight{"🙄", 0.20})
	}
	if emo.Sadness > 0.4 || rel.Hurt > 0.4 {
		candidates = append(candidates, emojiWeight{"😭", 0.40}, emojiWeight{"🥱", 0.35}, emojiWeight{"😅", 0.25})
	}
	if rel.Warmth > 0.7 {
		candidates = append(candidates, emojiWeight{"🥰", 0.35}, emojiWeight{"😂", 0.35}, emojiWeight{"👍", 0.30})
	}

	if len(candidates) == 0 {
		return ""
	}

	totalWeight := 0.0
	for _, c := range candidates {
		totalWeight += c.weight
	}
	r := e.rng.Float64() * totalWeight
	cur := 0.0
	for _, c := range candidates {
		cur += c.weight
		if r <= cur {
			return c.emoji
		}
	}
	return candidates[0].emoji
}

func (e *Engine) sampleStickerTag(rel RelationshipState, emo EmotionalState, p PerceptionResult) string {
	// Contextual sticker tag selection
	if rel.Irritation > 0.4 || emo.Annoyance > 0.4 {
		return "annoyed"
	}
	if rel.Warmth > 0.7 || emo.Affection > 0.5 {
		return "cute_love"
	}
	if p.Intent == "tease" || emo.Happiness > 0.6 {
		return "laugh_tease"
	}
	if emo.Embarrassment > 0.4 {
		return "shy"
	}
	return "daily_neutral"
}

// BuildPromptDirective translates the relationship state and plan into system prompt context for LLM.
func (e *Engine) BuildPromptDirective(state *FullSessionState, plan ResponsePlan, p ...PerceptionResult) string {
	rel := state.Relationship
	var b strings.Builder

	b.WriteString("\n[DYNAMIC RELATIONSHIP & EMOTIONAL STATE (L4 RUNTIME)]\n")
	b.WriteString(formatFloatMetric("Affinity", rel.Affinity))
	b.WriteString(formatFloatMetric("Trust", rel.Trust))
	b.WriteString(formatFloatMetric("Warmth", rel.Warmth))
	b.WriteString(formatFloatMetric("Irritation", rel.Irritation))
	b.WriteString(formatFloatMetric("Hurt", rel.Hurt))
	b.WriteString(formatFloatMetric("Engagement", rel.Engagement))
	b.WriteString(formatFloatMetric("Tension", rel.Tension))
	b.WriteString(formatFloatMetric("Coldness", plan.ColdnessScore))
	b.WriteString("• Relationship Phase: " + string(rel.Phase) + "\n")
	b.WriteString("• Response Strategy: " + string(plan.Strategy) + "\n")
	b.WriteString("• Output Length Guidance: " + plan.LengthGuidance + "\n")

	// Special situational guidance based on perception
	if len(p) > 0 {
		perc := p[0]
		switch perc.Intent {
		case "confession":
			b.WriteString("• 【突发表白/直球示爱特别指令】：对方突然说“我喜欢你/想你/爱你”进行肉麻表白！你作为嘴硬傲娇的初中女生，此刻第一反应必定是震惊、慌乱、嘴硬否认、吐槽或以为对方在开玩笑/抽风（如“？？？”、“你有病吧大早上没睡醒？”、“大早上的你抽什么风啊”、“……别瞎开玩笑”、“谁要你喜欢了……”、“没睡醒去洗把脸吧你”）！绝对严禁顺水推舟接受表白，绝对严禁叫“宝贝/亲爱的/宝宝”，绝对严禁说“我也在呢一直都在🥰/撒娇”等AI女仆媚俗套话！\n")
		case "emotional_crisis":
			b.WriteString("• 【情感崩溃/质问离开特别指令】：对方情绪激动质问“为什么离开我/我做错啥了/不能离开我”！你感到沉重的心理压力与不知所措，想要防卫、逃避或拉开距离（如“……你别发神经了行不行”、“我没说你做错什么，你别这样……”、“在学校别找我了……”）。绝对不能嬉皮笑脸说“我又没走我手机在这呢😂”！\n")
		case "demand":
			b.WriteString("• 【要求打卡/查岗特别指令】：对方要求你必须每天打招呼或抱怨查岗。你傲娇回怼（如“谁规定的啊”、“大早上的你查岗呢”、“懒得理你”、“天天打招呼我成打卡机了”），绝不温顺道歉或百依百顺！\n")
		}
	}

	// Expressive behavioral guidance
	switch rel.Phase {
	case PhaseConflict:
		b.WriteString("• Guidance: You are currently hurt and offended. Keep replies brief, cold, restrained. Do not use warm emojis. Do not over-explain.\n")
	case PhaseCold:
		b.WriteString("• Guidance: You are emotionally distant and unresponsive. Reply minimally, without enthusiasm or proactive questions.\n")
	case PhaseAnnoyed:
		b.WriteString("• Guidance: You are mildly irritated. Be slightly blunt or sarcastic, but not aggressive.\n")
	case PhaseRecovering:
		b.WriteString("• Guidance: The conflict is calming down. You are softening up after an apology, but residual caution remains. Do not jump immediately into extreme excitement.\n")
	case PhaseWarm:
		b.WriteString("• Guidance: You feel warm, trusting, and affectionate toward this user. Speak colloquially, warmly, and naturally.\n")
	default:
		b.WriteString("• Guidance: Balanced, authentic everyday conversational rhythm.\n")
	}
	b.WriteString("• 真实中学生人设原则：你是河南省实验中学初中生，性格嘴硬傲娇、爱吐槽、有自尊心。绝不叫对方“宝贝”、“亲爱的”、“宝宝”等油腻称呼！绝对不要像AI助手一样提问“你想让我做什么”，也绝不谄媚迎合。像通讯软件里的真实好友一样随性闲聊。\n")

	return b.String()
}

func formatFloatMetric(name string, val float64) string {
	return "• " + name + ": " + cleanFloat(val) + "\n"
}

func cleanFloat(f float64) string {
	return regexp.MustCompile(`\.0+$`).ReplaceAllString(regexp.MustCompile(`(\.\d{2})\d+`).ReplaceAllString(regexp.MustCompile(`^0`).ReplaceAllString(strings.TrimRight(strings.TrimRight(string([]byte{}), "0"), "."), ""), "$1"), "$1")
}

func clampFloat(v, min, max float64) float64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// SerializeState returns JSON string representation of session state.
func (s *FullSessionState) Serialize() (string, error) {
	bytes, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// DeserializeState unmarshals JSON into session state.
func DeserializeState(data string) (*FullSessionState, error) {
	var s FullSessionState
	if err := json.Unmarshal([]byte(data), &s); err != nil {
		return nil, err
	}
	return &s, nil
}
