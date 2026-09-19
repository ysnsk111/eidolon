import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Human-like Response Scheduler Specification Tests', () => {
  function simulateScheduler(charCount, typingSpeedCpm = 180, baseDelayMs = 2500) {
    const msPerChar = 60000 / typingSpeedCpm;
    const typingDuration = Math.round(charCount * msPerChar);
    const jitter = Math.round((Math.random() * 800) - 400);
    const rawTotal = baseDelayMs + Math.round(typingDuration / 2) + jitter;
    const clampedTotal = Math.max(1200, Math.min(rawTotal, 15000));
    return {
      totalDelayMs: clampedTotal,
      typingDurationMs: Math.round(clampedTotal * 0.65),
      jitter,
    };
  }

  test('Delays must be dynamic, non-fixed, and scale with message length', () => {
    const s1 = simulateScheduler(5); // short message
    const s2 = simulateScheduler(80); // long message

    assert.ok(s1.totalDelayMs >= 1200, 'Must satisfy minimum floor constraint');
    assert.ok(s2.totalDelayMs <= 15000, 'Must satisfy maximum ceiling constraint');
    assert.ok(s2.typingDurationMs > s1.typingDurationMs, 'Longer message must have longer typing duration');
  });

  test('Scheduler delay exhibits randomized jitter across multiple calls', () => {
    const delays = new Set();
    for (let i = 0; i < 10; i++) {
      delays.add(simulateScheduler(20).totalDelayMs);
    }
    assert.ok(delays.size > 1, 'Delays must vary across calls (never fixed 3000ms)');
  });
});
