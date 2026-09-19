package scheduler

import (
	"math"
	"math/rand"
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
	TotalDelayMs        int    `json:"total_delay_ms"`
	TypingDurationMs    int    `json:"typing_duration_ms"`
	JitterMs            int    `json:"jitter_ms"`
	ShouldDoubleMessage bool   `json:"should_double_message"`
	DoubleMessagePart1  string `json:"double_message_part1,omitempty"`
	DoubleMessagePart2  string `json:"double_message_part2,omitempty"`
	Bucket              string `json:"bucket"` // "short"|"medium"|"long", for logging
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
		cfg.MinDelayMs = 800
	}
	if cfg.MaxDelayMs <= 0 {
		cfg.MaxDelayMs = 20000
	}
	if cfg.BaseDelayMs <= 0 {
		cfg.BaseDelayMs = 3500 // structural fallback only
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
		cfg.MinDelayMs = 800
	}
	if cfg.MaxDelayMs <= 0 {
		cfg.MaxDelayMs = 20000
	}
	if cfg.BaseDelayMs <= 0 {
		cfg.BaseDelayMs = 3500
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
//
// Algorithm:
//  1. Bucket the reply by length (short / medium / long)
//  2. Use observed median_ms from LatencyModel for that bucket
//  3. Add small Gaussian jitter
//  4. Clamp to [MinDelayMs, MaxDelayMs]
//
// NOTE: TypingSpeedCpm is intentionally NOT used.
// Chat timestamps can measure reply latency (perception + think + type + send),
// but not pure typing speed. Fabricating 180 CPM overstates predictability.
func (s *Scheduler) CalculateSchedule(replyText string, rapidConversation bool) ScheduleResult {
	s.mu.Lock()
	defer s.mu.Unlock()

	charCount := len([]rune(replyText))

	// 1. Determine length bucket and select base latency
	bucket, baseMedian := s.selectLatencyBucket(charCount)

	// 2. Rapid conversation shortens expected latency
	if rapidConversation && baseMedian > 1000 {
		baseMedian = int(math.Max(float64(s.cfg.MinDelayMs), float64(baseMedian)*0.75))
	}

	// 3. Gaussian jitter: sigma ≈ 15% of base median, mean 0
	sigma := math.Max(300, float64(baseMedian)*0.15)
	jitter := int(s.rng.NormFloat64() * sigma)

	// 4. Total delay
	rawTotal := baseMedian + jitter
	totalDelay := clamp(rawTotal, s.cfg.MinDelayMs, s.cfg.MaxDelayMs)

	// 5. Typing indicator: 50-80% of total delay
	typingIndicatorDuration := clamp(int(float64(totalDelay)*0.65), 500, totalDelay)

	// 6. Double-message check
	shouldDouble := false
	var part1, part2 string
	if s.rng.Float64() < s.cfg.DoubleMessageProb && charCount > 20 {
		runes := []rune(replyText)
		splitIdx := len(runes) / 2
		for i := splitIdx - 5; i <= splitIdx+5; i++ {
			if i > 0 && i < len(runes) {
				ch := runes[i]
				if ch == '，' || ch == ',' || ch == '！' || ch == '!' || ch == ' ' || ch == '。' {
					splitIdx = i + 1
					shouldDouble = true
					part1 = string(runes[:splitIdx])
					part2 = string(runes[splitIdx:])
					break
				}
			}
		}
	}

	return ScheduleResult{
		TotalDelayMs:        totalDelay,
		TypingDurationMs:    typingIndicatorDuration,
		JitterMs:            jitter,
		ShouldDoubleMessage: shouldDouble,
		DoubleMessagePart1:  part1,
		DoubleMessagePart2:  part2,
		Bucket:              bucket,
	}
}

// selectLatencyBucket picks the appropriate bucket by reply length and returns
// (bucket name, base latency in ms). Falls back to BaseDelayMs if no data.
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

	if b.MedianMs > 0 {
		return name, b.MedianMs
	}
	// No observed data for this bucket; fall back to BaseDelayMs
	return name, s.cfg.BaseDelayMs
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
