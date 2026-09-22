package scheduler

import (
	"math"
	"math/rand"
	"strings"
	"sync"
	"time"
)

// LatencyBucket holds observed response latency statistics for a message-length bucket.
type LatencyBucket struct {
	MedianMs int `json:"median_ms"` // 0 means no data
	P90Ms    int `json:"p90_ms"`    // 0 means no data
	Samples  int `json:"samples"`
}

// LatencyModel is derived from historical messages, bucketed by response length.
// All fields may be zero if data is insufficient.
type LatencyModel struct {
	Short  LatencyBucket `json:"short"`  // response length <= 20 chars
	Medium LatencyBucket `json:"medium"` // response length 21-60 chars
	Long   LatencyBucket `json:"long"`   // response length > 60 chars
}

// Config holds scheduler configuration derived from persona distillation.
type Config struct {
	// BaseDelayMs is the fallback median latency if LatencyModel has no data.
	BaseDelayMs int `json:"base_delay_ms"`
	// LatencyModel replaces TypingSpeedCpm: latency is observed, not synthesized from CPM.
	LatencyModel LatencyModel `json:"latency_model"`
	// DoubleMessageProb is the probability of splitting a reply into two messages.
	DoubleMessageProb float64 `json:"double_message_probability"`
	// MinDelayMs and MaxDelayMs are hard clamps for safety.
	MinDelayMs int `json:"min_delay_ms"`
	MaxDelayMs int `json:"max_delay_ms"`
}

// ScheduleResult is returned by CalculateSchedule.
type ScheduleResult struct {
	TotalDelayMs        int      `json:"total_delay_ms"`
	TypingDurationMs    int      `json:"typing_duration_ms"`
	JitterMs            int      `json:"jitter_ms"`
	ShouldDoubleMessage bool     `json:"should_double_message"`
	DoubleMessagePart1  string   `json:"double_message_part1,omitempty"`
	DoubleMessagePart2  string   `json:"double_message_part2,omitempty"`
	Parts               []string `json:"parts,omitempty"`
	InterMessageGapsMs  []int    `json:"inter_message_gaps_ms,omitempty"`
	Bucket              string   `json:"bucket"` // "short"|"medium"|"long", for logging
}

// SchedulingContext holds relational and contextual parameters for human-like timing (Sections 7, 8, 9).
type SchedulingContext struct {
	RapidConversation bool
	Warmth            float64 // 0.0 ~ 1.0
	Irritation        float64 // 0.0 ~ 1.0
	Engagement        float64 // 0.0 ~ 1.0
	IsQuestion        bool
	TargetCount       int // 1, 2, 3
}

// Scheduler computes human-like delays based on observed response latency distributions.
type Scheduler struct {
	mu  sync.Mutex
	cfg Config
	rng *rand.Rand
}

// NewScheduler creates a Scheduler. Defaults are applied only for structural validity;
// meaningful latency values must come from the persona's distilled LatencyModel.
func NewScheduler(cfg Config) *Scheduler {
	if cfg.MinDelayMs <= 0 {
		cfg.MinDelayMs = 1500
	}
	if cfg.MaxDelayMs <= 0 || cfg.MaxDelayMs > 8000 {
		cfg.MaxDelayMs = 8000
	}
	if cfg.BaseDelayMs <= 0 {
		cfg.BaseDelayMs = 3000 // structural fallback only
	} else if cfg.BaseDelayMs > 8000 {
		cfg.BaseDelayMs = 8000
	}
	if cfg.DoubleMessageProb <= 0 {
		cfg.DoubleMessageProb = 0.08
	}
	return &Scheduler{
		cfg: cfg,
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// UpdateConfig updates the scheduler configuration dynamically (e.g. when persona loads).
func (s *Scheduler) UpdateConfig(cfg Config) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if cfg.MinDelayMs <= 0 {
		cfg.MinDelayMs = 1500
	}
	if cfg.MaxDelayMs <= 0 || cfg.MaxDelayMs > 8000 {
		cfg.MaxDelayMs = 8000
	}
	if cfg.BaseDelayMs <= 0 {
		cfg.BaseDelayMs = 3000
	} else if cfg.BaseDelayMs > 8000 {
		cfg.BaseDelayMs = 8000
	}
	if cfg.DoubleMessageProb <= 0 {
		cfg.DoubleMessageProb = 0.08
	}
	s.cfg = cfg
}

// GetConfig returns a copy of current scheduler config.
func (s *Scheduler) GetConfig() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

// CalculateSchedule computes human-like delay using the observed latency model.
func (s *Scheduler) CalculateSchedule(replyText string, rapidConversation bool) ScheduleResult {
	return s.CalculateScheduleAdvanced(replyText, SchedulingContext{
		RapidConversation: rapidConversation,
		Warmth:            0.5,
		Irritation:        0.0,
		Engagement:        0.7,
	})
}

// CalculateScheduleAdvanced computes multi-factor interactive human-like delay (Sections 7 & 8).
// Latency = Base * RelationshipFactor * EmotionFactor * IntentFactor * RandomFactor
func (s *Scheduler) CalculateScheduleAdvanced(replyText string, ctx SchedulingContext) ScheduleResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	charCount := len([]rune(replyText))

	// 1. Determine length bucket and select base latency
	bucket, baseMedian := s.selectLatencyBucket(charCount)

	// 2. Multi-factor Interactive Latency (Section 8)
	// RelationshipFactor = 1 - 0.25 * warmth
	relFactor := math.Max(0.65, 1.0-0.25*ctx.Warmth)
	// EmotionFactor = 1 + 0.8 * irritation
	emoFactor := 1.0 + 0.80*ctx.Irritation
	// IntentFactor: questions answered faster
	intentFactor := 1.0
	if ctx.IsQuestion {
		intentFactor = 0.75
	}
	// Engagement factor: higher engagement reduces sluggishness
	engageFactor := math.Max(0.75, 1.15-0.35*ctx.Engagement)

	adjustedMedian := float64(baseMedian) * relFactor * emoFactor * intentFactor * engageFactor

	// 3. Rapid conversation shortens expected latency
	if ctx.RapidConversation && adjustedMedian > 1000 {
		adjustedMedian = math.Max(float64(s.cfg.MinDelayMs), adjustedMedian*0.75)
	}

	// 4. Gaussian jitter: sigma ≈ 15% of adjusted median, mean 0
	sigma := math.Max(250, adjustedMedian*0.15)
	jitter := int(s.rng.NormFloat64() * sigma)

	// 5. Total delay clamped to safety bounds
	rawTotal := int(adjustedMedian) + jitter
	totalDelay := clamp(rawTotal, s.cfg.MinDelayMs, s.cfg.MaxDelayMs)

	// 6. Typing indicator: 65% - 75% of total delay (reading delay: 25% - 35%)
	typingIndicatorDuration := clamp(int(float64(totalDelay)*0.70), 0, totalDelay)

	// 7. Message Splitting Planner (Section 9)
	shouldDouble := false
	var part1, part2 string
	var parts []string
	var interGaps []int

	wantSplit := ctx.TargetCount >= 2 || (s.rng.Float64() < s.cfg.DoubleMessageProb && charCount > 20)
	if wantSplit && charCount > 15 {
		runes := []rune(replyText)
		mid := len(runes) / 2
		bestSplit := -1
		minDist := len(runes)

		// Priority 1: sentence ends (\n, 。, ！, !, ？, ?, ~)
		primaryDelims := []rune{'\n', '。', '！', '!', '？', '?', '~'}
		for i := 3; i < len(runes)-3; i++ {
			for _, d := range primaryDelims {
				if runes[i] == d {
					dist := int(math.Abs(float64(i - mid)))
					if dist < minDist {
						minDist = dist
						bestSplit = i + 1
					}
				}
			}
		}

		// Priority 2: commas (，, ,) if no sentence boundary found near middle
		if bestSplit == -1 {
			for i := 3; i < len(runes)-3; i++ {
				if runes[i] == '，' || runes[i] == ',' {
					dist := int(math.Abs(float64(i - mid)))
					if dist < minDist {
						minDist = dist
						bestSplit = i + 1
					}
				}
			}
		}

		if bestSplit > 0 {
			p1 := strings.TrimSpace(string(runes[:bestSplit]))
			p2 := strings.TrimSpace(string(runes[bestSplit:]))
			if len([]rune(p1)) >= 2 && len([]rune(p2)) >= 2 {
				shouldDouble = true
				part1 = p1
				part2 = p2
				parts = []string{p1, p2}
				gap := 800 + int(s.rng.Float64()*800) // 800ms ~ 1600ms
				interGaps = []int{gap}
			}
		}
	}

	if len(parts) == 0 {
		parts = []string{replyText}
	}

	return ScheduleResult{
		TotalDelayMs:        totalDelay,
		TypingDurationMs:    typingIndicatorDuration,
		JitterMs:            jitter,
		ShouldDoubleMessage: shouldDouble,
		DoubleMessagePart1:  part1,
		DoubleMessagePart2:  part2,
		Parts:               parts,
		InterMessageGapsMs:  interGaps,
		Bucket:              bucket,
	}
}

// selectLatencyBucket picks the appropriate bucket by reply length and returns
// (bucket name, base latency in ms). Clamps bucket median into realistic human IM bounds [1500, 8000]ms.
func (s *Scheduler) selectLatencyBucket(charCount int) (string, int) {
	var b LatencyBucket
	var name string

	switch {
	case charCount <= 20:
		name = "short"
		b = s.cfg.LatencyModel.Short
	case charCount <= 60:
		name = "medium"
		b = s.cfg.LatencyModel.Medium
	default:
		name = "long"
		b = s.cfg.LatencyModel.Long
	}

	median := s.cfg.BaseDelayMs
	if b.MedianMs > 0 {
		median = b.MedianMs
	}

	// Clamp bucket median into [1500, 8000] ms (respecting test-provided MinDelayMs if smaller)
	minBound := 1500
	if s.cfg.MinDelayMs > 0 && s.cfg.MinDelayMs < minBound {
		minBound = s.cfg.MinDelayMs
	}
	maxBound := 8000
	if s.cfg.MaxDelayMs > 0 && s.cfg.MaxDelayMs < maxBound {
		maxBound = s.cfg.MaxDelayMs
	}

	median = clamp(median, minBound, maxBound)
	return name, median
}

func clamp(val, min, max int) int {
	if val < min {
		return min
	}
	if val > max {
		return max
	}
	return val
}
