import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateHumanDelay } from './helpers/e2e_harness.js';

describe('Feature F11 E2E: Dynamic Scheduler & Typing Simulation', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F11-T1-1: Dynamic delays scale naturally with response text length', () => {
    // Fix jitter to 0 to test pure scaling
    const shortDelay = calculateHumanDelay(5, { jitter: 0 });
    const longDelay = calculateHumanDelay(50, { jitter: 0 });

    assert.ok(
      longDelay.totalDelayMs >= shortDelay.totalDelayMs,
      `Long delay (${longDelay.totalDelayMs}) should be >= short delay (${shortDelay.totalDelayMs})`
    );
    assert.ok(
      longDelay.typingDurationMs >= shortDelay.typingDurationMs,
      `Long typing (${longDelay.typingDurationMs}) should be >= short typing (${shortDelay.typingDurationMs})`
    );
  });

  test('F11-T1-2: Total delay strictly bounded within [1,500ms, 8,000ms]', () => {
    const lengths = [1, 5, 15, 30, 80, 200, 1000];

    for (const len of lengths) {
      for (let i = 0; i < 5; i++) {
        const res = calculateHumanDelay(len);
        assert.ok(
          res.totalDelayMs >= 1500,
          `Length ${len}: total delay ${res.totalDelayMs} below 1500ms floor`
        );
        assert.ok(
          res.totalDelayMs <= 8000,
          `Length ${len}: total delay ${res.totalDelayMs} above 8000ms ceiling`
        );
      }
    }
  });

  test('F11-T1-3: Reading delay is 25% - 35% of total delay', () => {
    const res = calculateHumanDelay(20);
    const readingRatio = res.readingDelayMs / res.totalDelayMs;

    assert.ok(readingRatio >= 0.25 && readingRatio <= 0.35, `Reading ratio ${readingRatio} out of [0.25, 0.35]`);
  });

  test('F11-T1-4: Typing duration is 65% - 75% of total delay', () => {
    const res = calculateHumanDelay(20);
    const typingRatio = res.typingDurationMs / res.totalDelayMs;

    assert.ok(typingRatio >= 0.65 && typingRatio <= 0.75, `Typing ratio ${typingRatio} out of [0.65, 0.75]`);
    assert.strictEqual(res.readingDelayMs + res.typingDurationMs, res.totalDelayMs);
  });

  test('F11-T1-5: Typing status simulation refreshes sendChatAction every 4000ms for longer typing', () => {
    // Force a long typing duration ~5000ms
    const res = calculateHumanDelay(100, { jitter: 0, baseDelayMs: 6000 });

    assert.ok(res.typingDurationMs > 4000);
    assert.ok(res.typingRefreshSteps.length >= 2, 'Must split into multiple 4s refresh steps');
    assert.strictEqual(res.typingRefreshSteps[0], 4000);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F11-T2-1: Ultra-short response (1 character) clamped to minimum floor (>= 1,500ms)', () => {
    const res = calculateHumanDelay(1, { baseDelayMs: 500, jitter: -500 });
    assert.strictEqual(res.totalDelayMs, 1500, 'Must clamp to floor 1500ms');
  });

  test('F11-T2-2: Very long response (>100 characters) clamped to maximum ceiling (<= 8,000ms)', () => {
    const res = calculateHumanDelay(500, { baseDelayMs: 10000, jitter: 1000 });
    assert.strictEqual(res.totalDelayMs, 8000, 'Must clamp to ceiling 8000ms');
  });

  test('F11-T2-3: Randomized Gaussian jitter produces non-identical delays across multiple calls', () => {
    const delays = new Set();
    for (let i = 0; i < 20; i++) {
      delays.add(calculateHumanDelay(20).totalDelayMs);
    }

    assert.ok(delays.size > 1, 'Delays must exhibit non-zero variance due to jitter');
  });

  test('F11-T2-4: Custom baseline delay configuration respected within safety bounds', () => {
    const resCustom = calculateHumanDelay(10, { baseDelayMs: 3000, jitter: 0 });
    assert.ok(resCustom.totalDelayMs >= 3000 && resCustom.totalDelayMs <= 8000);
  });

  test('F11-T2-5: Step partitioning sums exactly to total typing duration', () => {
    for (let len = 5; len <= 100; len += 20) {
      const res = calculateHumanDelay(len);
      const sumSteps = res.typingRefreshSteps.reduce((a, b) => a + b, 0);
      assert.strictEqual(sumSteps, res.typingDurationMs, 'Refresh steps must sum to typing duration');
    }
  });
});
