import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calibrateQuantizedLatencyModel } from './helpers/e2e_harness.js';
import { extractBehaviorAndRhythm } from '../../cli/distillation/behavior.js';

describe('Feature F10 E2E: Distillation Latency Calibration', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F10-T1-1: Detects minute-level timestamp quantization (seconds :00 and 60,000ms jumps)', () => {
    // Simulated minute-quantized delta sequence: 60000ms, 120000ms, 60000ms
    const quantizedDeltas = [60000, 60000, 120000, 60000, 60000];
    const model = calibrateQuantizedLatencyModel(quantizedDeltas);

    assert.strictEqual(model.quantization_detected, true, 'Must flag minute quantization artifact');
  });

  test('F10-T1-2: Replaces 60,000ms spike artifacts with calibrated realistic latency', () => {
    const quantizedDeltas = [60000, 60000, 60000, 60000, 60000];
    const model = calibrateQuantizedLatencyModel(quantizedDeltas);

    assert.ok(model.median_ms < 10000, 'Median latency must be strictly < 10,000ms');
    assert.ok(model.median_ms >= 1500, 'Median latency must be >= 1,500ms');
    assert.notStrictEqual(model.median_ms, 60000, 'Must NOT retain 60,000ms median');
  });

  test('F10-T1-3: Calibrated median latency is strictly bounded within 1,500ms - 8,000ms (never 60,000ms)', () => {
    const variousSequences = [
      [60000, 120000],
      [1000, 2000, 3000, 4000],
      [50000, 60000, 70000],
    ];

    for (const seq of variousSequences) {
      const model = calibrateQuantizedLatencyModel(seq);
      assert.ok(model.median_ms >= 1500 && model.median_ms <= 8000, `Median ${model.median_ms} out of [1500, 8000]`);
    }
  });

  test('F10-T1-4: Short/medium/long latency model buckets conform to realistic human IM ranges', () => {
    const model = calibrateQuantizedLatencyModel([2000, 3500, 5000]);

    assert.ok(model.short.median_ms >= 1500 && model.short.median_ms <= 3000, 'Short bucket in [1500, 3000]');
    assert.ok(model.medium.median_ms >= 3000 && model.medium.median_ms <= 5500, 'Medium bucket in [3000, 5500]');
    assert.ok(model.long.median_ms >= 5000 && model.long.median_ms <= 8000, 'Long bucket in [5000, 8000]');
  });

  test('F10-T1-5: Section 13/31 compliance: typing speed CPM must not be fabricated from timestamps', async () => {
    const messages = [
      { sender: 'Bob', isTarget: false, content: '你好', epochMs: 1000 },
      { sender: 'Alice', isTarget: true, content: '你好呀', epochMs: 4000 },
    ];
    const turns = [
      { context: [{ sender: 'Bob', content: '你好' }], target_message: '你好呀' },
    ];

    const result = await extractBehaviorAndRhythm(turns, messages, 'Alice');
    assert.strictEqual(result.conversation_rhythm.typing_speed_cpm, null, 'Typing speed CPM must remain null');
    assert.strictEqual(result.conversation_rhythm.typing_model.enabled, false);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F10-T2-1: High-resolution millisecond timestamps preserve genuine fast responses', () => {
    const subSecondDeltas = [1800, 2200, 2500, 3100];
    const model = calibrateQuantizedLatencyModel(subSecondDeltas);

    assert.strictEqual(model.quantization_detected, false);
    assert.ok(model.median_ms >= 1800 && model.median_ms <= 3100);
  });

  test('F10-T2-2: Multi-hour asynchronous dialogue gaps (>300s) excluded from live typing delay median', () => {
    const asyncGaps = [2000, 3000, 3600000, 7200000]; // 1hr, 2hr gaps
    const model = calibrateQuantizedLatencyModel(asyncGaps);

    assert.ok(model.median_ms <= 8000, 'Async gaps must not explode median');
  });

  test('F10-T2-3: Multiple turns occurring within the same minute (timeDiff = 0) handle smoothly', () => {
    const zeroDeltas = [0, 0, 0, 60000];
    const model = calibrateQuantizedLatencyModel(zeroDeltas);

    assert.ok(model.median_ms >= 1500 && model.median_ms <= 8000);
    assert.strictEqual(Number.isNaN(model.median_ms), false);
  });

  test('F10-T2-4: Extremely small turn sample size (2-3 turns) computes safe default bounds without NaN', () => {
    const smallDeltas = [2500];
    const model = calibrateQuantizedLatencyModel(smallDeltas);

    assert.strictEqual(Number.isNaN(model.median_ms), false);
    assert.strictEqual(Number.isNaN(model.short.median_ms), false);
  });

  test('F10-T2-5: Empty delta array returns safe fallback model without throwing', () => {
    const model = calibrateQuantizedLatencyModel([]);
    assert.ok(model.median_ms >= 1500 && model.median_ms <= 8000);
  });
});
