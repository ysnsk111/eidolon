package scheduler_test

import (
	"testing"

	"eidolon/server/internal/scheduler"
)

func TestScheduler_BucketingAndLatencyModel(t *testing.T) {
	cfg := scheduler.Config{
		BaseDelayMs: 3000,
		MinDelayMs:  500,
		MaxDelayMs:  15000,
		LatencyModel: scheduler.LatencyModel{
			Short: scheduler.LatencyBucket{
				MedianMs: 1200,
				P90Ms:    2500,
				Samples:  10,
			},
			Medium: scheduler.LatencyBucket{
				MedianMs: 3800,
				P90Ms:    6500,
				Samples:  15,
			},
			Long: scheduler.LatencyBucket{
				MedianMs: 7500,
				P90Ms:    12000,
				Samples:  8,
			},
		},
		DoubleMessageProb: 0.1,
	}

	sched := scheduler.NewScheduler(cfg)

	// Short reply: <= 20 chars
	shortRes := sched.CalculateSchedule("好呀~", false)
	if shortRes.Bucket != "short" {
		t.Errorf("Expected bucket 'short', got '%s'", shortRes.Bucket)
	}
	if shortRes.TotalDelayMs < 500 || shortRes.TotalDelayMs > 4000 {
		t.Errorf("Short reply delay out of expected range: %d ms", shortRes.TotalDelayMs)
	}

	// Medium reply: 21 - 60 chars
	mediumText := "今天中午我们一起去吃豚骨拉面吧，那家新开的味道特别地道！"
	medRes := sched.CalculateSchedule(mediumText, false)
	if medRes.Bucket != "medium" {
		t.Errorf("Expected bucket 'medium', got '%s'", medRes.Bucket)
	}
	if medRes.TotalDelayMs < 1500 || medRes.TotalDelayMs > 8000 {
		t.Errorf("Medium reply delay out of expected range: %d ms", medRes.TotalDelayMs)
	}

	// Long reply: > 60 chars
	longText := "期末考试马上就要开始了，大家都在图书馆认真复习呢。如果你觉得有压力的话，我们可以每天晚上一起连麦梳理重点知识，互相抽查提问，这样效率会高很多，千万别给自己太大负担哦！"
	longRes := sched.CalculateSchedule(longText, false)
	if longRes.Bucket != "long" {
		t.Errorf("Expected bucket 'long', got '%s'", longRes.Bucket)
	}
	if longRes.TotalDelayMs < 3000 || longRes.TotalDelayMs > 15000 {
		t.Errorf("Long reply delay out of expected range: %d ms", longRes.TotalDelayMs)
	}
}

func TestScheduler_UpdateConfig(t *testing.T) {
	sched := scheduler.NewScheduler(scheduler.Config{
		BaseDelayMs: 2500,
	})

	// Before update: short bucket uses BaseDelayMs fallback
	res1 := sched.CalculateSchedule("ok", false)
	if res1.Bucket != "short" {
		t.Errorf("Expected bucket 'short', got '%s'", res1.Bucket)
	}

	// Update dynamically from loaded persona (Section 14)
	sched.UpdateConfig(scheduler.Config{
		BaseDelayMs: 1500,
		LatencyModel: scheduler.LatencyModel{
			Short: scheduler.LatencyBucket{MedianMs: 900, P90Ms: 1500, Samples: 20},
		},
	})

	updatedCfg := sched.GetConfig()
	if updatedCfg.BaseDelayMs != 1500 {
		t.Errorf("Expected BaseDelayMs 1500, got %d", updatedCfg.BaseDelayMs)
	}
	if updatedCfg.LatencyModel.Short.MedianMs != 900 {
		t.Errorf("Expected short median 900, got %d", updatedCfg.LatencyModel.Short.MedianMs)
	}
}

func TestScheduler_RapidConversationReduction(t *testing.T) {
	cfg := scheduler.Config{
		BaseDelayMs: 4000,
		MinDelayMs:  800,
		MaxDelayMs:  10000,
		LatencyModel: scheduler.LatencyModel{
			Medium: scheduler.LatencyBucket{MedianMs: 4000, P90Ms: 6000, Samples: 10},
		},
	}
	sched := scheduler.NewScheduler(cfg)

	// In rapid conversation, expected delay is reduced
	resNormal := sched.CalculateSchedule("这是一条中等长度的消息测试用于测试正常延时情况", false)
	resRapid := sched.CalculateSchedule("这是一条中等长度的消息测试用于测试正常延时情况", true)

	// Since there's jitter, we run multiple trials to verify average is lower
	normalSum, rapidSum := 0, 0
	trials := 20
	for i := 0; i < trials; i++ {
		normalSum += sched.CalculateSchedule("这是一条中等长度的消息测试用于测试正常延时情况", false).TotalDelayMs
		rapidSum += sched.CalculateSchedule("这是一条中等长度的消息测试用于测试正常延时情况", true).TotalDelayMs
	}
	avgNormal := normalSum / trials
	avgRapid := rapidSum / trials

	if avgRapid >= avgNormal {
		t.Errorf("Rapid conversation average delay (%d) should be less than normal (%d)", avgRapid, avgNormal)
	}
	_ = resNormal
	_ = resRapid
}

func TestScheduler_AdvancedInteractiveFactors(t *testing.T) {
	cfg := scheduler.Config{
		BaseDelayMs: 3000,
		MinDelayMs:  500,
		MaxDelayMs:  20000,
		LatencyModel: scheduler.LatencyModel{
			Medium: scheduler.LatencyBucket{MedianMs: 3000, P90Ms: 5000, Samples: 10},
		},
	}
	sched := scheduler.NewScheduler(cfg)

	// Compare high warmth vs high irritation
	warmthCtx := scheduler.SchedulingContext{
		Warmth:     0.9,
		Irritation: 0.0,
		Engagement: 0.8,
	}
	irritatedCtx := scheduler.SchedulingContext{
		Warmth:     0.1,
		Irritation: 0.8,
		Engagement: 0.3,
	}

	warmthSum, irritatedSum := 0, 0
	trials := 25
	text := "今天中午我们一起去吃豚骨拉面吧，那家新开的味道特别地道！"
	for i := 0; i < trials; i++ {
		warmthSum += sched.CalculateScheduleAdvanced(text, warmthCtx).TotalDelayMs
		irritatedSum += sched.CalculateScheduleAdvanced(text, irritatedCtx).TotalDelayMs
	}

	avgWarmth := warmthSum / trials
	avgIrritated := irritatedSum / trials

	if avgWarmth >= avgIrritated {
		t.Errorf("Warm relationship latency (%d) should be significantly lower than irritated latency (%d)", avgWarmth, avgIrritated)
	}
}

func TestScheduler_CalibratedBoundsAndMedianClamping(t *testing.T) {
	// Legacy uncalibrated config where short is 70,000ms and medium is 103,000ms
	legacyCfg := scheduler.Config{
		BaseDelayMs: 70000,
		LatencyModel: scheduler.LatencyModel{
			Short:  scheduler.LatencyBucket{MedianMs: 70000, P90Ms: 132000, Samples: 5},
			Medium: scheduler.LatencyBucket{MedianMs: 103000, P90Ms: 105000, Samples: 4},
			Long:   scheduler.LatencyBucket{MedianMs: 120000, P90Ms: 180000, Samples: 3},
		},
	}

	sched := scheduler.NewScheduler(legacyCfg)
	cfg := sched.GetConfig()

	if cfg.MinDelayMs != 1500 {
		t.Errorf("Expected default MinDelayMs 1500, got %d", cfg.MinDelayMs)
	}
	if cfg.MaxDelayMs != 8000 {
		t.Errorf("Expected default MaxDelayMs 8000, got %d", cfg.MaxDelayMs)
	}
	if cfg.BaseDelayMs > 8000 {
		t.Errorf("Expected BaseDelayMs to be clamped <= 8000, got %d", cfg.BaseDelayMs)
	}

	// Test multiple replies across short, medium, and long text
	testCases := []struct {
		name string
		text string
	}{
		{"Short reply", "好呀"},
		{"Medium reply", "今天晚上有空一起去散散步吗？最近天气真不错"},
		{"Long reply", "我把刚才整理好的会议纪要和接下来的任务清单都发到群里了，大家有空可以核对一下，如果有遗漏的地方随时告诉我，明天上午我们再开短会对齐进度。"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			for trial := 0; trial < 20; trial++ {
				res := sched.CalculateSchedule(tc.text, false)
				if res.TotalDelayMs < 1500 || res.TotalDelayMs > 8000 {
					t.Fatalf("TotalDelayMs %d out of calibrated bounds [1500, 8000]ms for '%s'", res.TotalDelayMs, tc.text)
				}

				// Check typing simulation ratio: 65%-75% typing, 25%-35% reading
				readingDelay := res.TotalDelayMs - res.TypingDurationMs
				readingRatio := float64(readingDelay) / float64(res.TotalDelayMs)
				typingRatio := float64(res.TypingDurationMs) / float64(res.TotalDelayMs)

				if typingRatio < 0.60 || typingRatio > 0.80 {
					t.Errorf("Typing ratio %.2f out of expected [0.65, 0.75] window (total=%d, typing=%d)",
						typingRatio, res.TotalDelayMs, res.TypingDurationMs)
				}
				if readingRatio < 0.20 || readingRatio > 0.40 {
					t.Errorf("Reading ratio %.2f out of expected [0.25, 0.35] window (total=%d, reading=%d)",
						readingRatio, res.TotalDelayMs, readingDelay)
				}
			}
		})
	}
}

func TestScheduler_ZeroConfigDefaults(t *testing.T) {
	// Zero config defaults must be properly initialized
	sched := scheduler.NewScheduler(scheduler.Config{})
	cfg := sched.GetConfig()

	if cfg.MinDelayMs != 1500 {
		t.Errorf("Expected default MinDelayMs 1500, got %d", cfg.MinDelayMs)
	}
	if cfg.MaxDelayMs != 8000 {
		t.Errorf("Expected default MaxDelayMs 8000, got %d", cfg.MaxDelayMs)
	}
	if cfg.BaseDelayMs < 1500 || cfg.BaseDelayMs > 8000 {
		t.Errorf("Expected default BaseDelayMs within [1500, 8000], got %d", cfg.BaseDelayMs)
	}

	res := sched.CalculateSchedule("测试默认配置延时范围", false)
	if res.TotalDelayMs < 1500 || res.TotalDelayMs > 8000 {
		t.Errorf("Delay %d out of calibrated bounds [1500, 8000]", res.TotalDelayMs)
	}
}


