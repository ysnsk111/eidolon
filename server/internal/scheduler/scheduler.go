package scheduler

import (
	"math/rand"
	"time"
)

type Config struct {
	BaseDelayMs          int     `json:"base_delay_ms"`
	TypingSpeedCpm       int     `json:"typing_speed_cpm"`
	DoubleMessageProb    float64 `json:"double_message_probability"`
	MinDelayMs           int     `json:"min_delay_ms"`
	MaxDelayMs           int     `json:"max_delay_ms"`
}

type ScheduleResult struct {
	TotalDelayMs        int     `json:"total_delay_ms"`
	TypingDurationMs    int     `json:"typing_duration_ms"`
	JitterMs            int     `json:"jitter_ms"`
	ShouldDoubleMessage bool    `json:"should_double_message"`
	DoubleMessagePart1  string  `json:"double_message_part1,omitempty"`
	DoubleMessagePart2  string  `json:"double_message_part2,omitempty"`
}

type Scheduler struct {
	cfg Config
	rng *rand.Rand
}

func NewScheduler(cfg Config) *Scheduler {
	if cfg.BaseDelayMs <= 0 {
		cfg.BaseDelayMs = 2500
	}
	if cfg.TypingSpeedCpm <= 0 {
		cfg.TypingSpeedCpm = 180
	}
	if cfg.MinDelayMs <= 0 {
		cfg.MinDelayMs = 1200
	}
	if cfg.MaxDelayMs <= 0 {
		cfg.MaxDelayMs = 15000
	}
	if cfg.DoubleMessageProb <= 0 {
		cfg.DoubleMessageProb = 0.08
	}

	return &Scheduler{
		cfg: cfg,
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// CalculateSchedule computes human delay and typing duration (Section 46 & 47)
func (s *Scheduler) CalculateSchedule(replyText string, rapidConversation bool) ScheduleResult {
	charCount := len([]rune(replyText))

	// 1. Length Factor (typing duration based on characters per minute)
	// CPM to ms per char: (60 * 1000) / CPM
	msPerChar := float64(60000) / float64(s.cfg.TypingSpeedCpm)
	typingDuration := int(float64(charCount) * msPerChar)

	// 2. Complexity & Conversation Factors
	complexityFactor := 0
	if charCount > 40 {
		complexityFactor = 1500
	}
	if rapidConversation {
		complexityFactor -= 800
	}

	// 3. Random Gaussian Jitter: [-600ms, +900ms]
	jitter := int(s.rng.NormFloat64()*400.0) + 200

	// 4. Clamped Total Delay
	rawTotal := s.cfg.BaseDelayMs + (typingDuration / 2) + complexityFactor + jitter
	totalDelay := clamp(rawTotal, s.cfg.MinDelayMs, s.cfg.MaxDelayMs)

	// Realistic typing indicator: active for 40% - 85% of total delay
	typingIndicatorDuration := clamp(int(float64(totalDelay)*0.65), 800, totalDelay)

	// 5. Double-message probability check
	shouldDouble := false
	var part1, part2 string
	if s.rng.Float64() < s.cfg.DoubleMessageProb && charCount > 20 {
		// Split at natural boundary (comma, exclamation, or space)
		runes := []rune(replyText)
		splitIdx := len(runes) / 2
		for i := splitIdx - 5; i <= splitIdx + 5; i++ {
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
	}
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
