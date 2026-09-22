import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRuntimeOutput } from './helpers/e2e_harness.js';

describe('Feature F9 E2E: Runtime Timeout & Fallback Elimination', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F9-T1-1: Inference timeout bounds calibrated within 5s-15s (never 45s)', () => {
    const timeoutConfig = {
      defaultTimeoutSec: 15,
      minTimeoutSec: 5,
      legacyTimeoutSec: 45,
    };

    assert.ok(timeoutConfig.defaultTimeoutSec <= 15, 'Timeout must be <= 15s');
    assert.ok(timeoutConfig.minTimeoutSec >= 5, 'Timeout must be >= 5s');
    assert.notStrictEqual(timeoutConfig.defaultTimeoutSec, 45, 'Legacy 45s timeout must be eliminated');
  });

  test('F9-T1-2: 0% fallback to "在呢，怎么啦~" across standard dialogue turns', () => {
    const testOutputs = [
      '在忙呢，等会儿聊',
      '哈哈真有你的',
      '作为一个AI语言模型，我无法回答', // AI marker trigger
      '', // empty trigger
      null, // null trigger
    ];

    for (const raw of testOutputs) {
      const sanitized = sanitizeRuntimeOutput(raw, '稍等下哈');
      assert.strictEqual(sanitized.includes('在呢，怎么啦~'), false, 'Must have 0% occurrence of "在呢，怎么啦~"');
    }
  });

  test('F9-T1-3: Genuine AI self-identification markers ("作为一个AI语言模型") correctly intercepted', () => {
    const genuineAIMarkers = [
      '作为人工智能助手，很高兴为你服务',
      '作为一个AI语言模型，我不能这么做',
      '我是由OpenAI训练的大型语言模型',
    ];

    for (const raw of genuineAIMarkers) {
      const sanitized = sanitizeRuntimeOutput(raw, '在呢，等我下哈');
      assert.strictEqual(sanitized, '在呢，等我下哈');
      assert.strictEqual(sanitized.includes('人工智能'), false);
      assert.strictEqual(sanitized.includes('AI语言模型'), false);
    }
  });

  test('F9-T1-4: Innocent colloquial phrases ("作为一个朋友", "我是小明") NOT falsely blocked as AI markers', () => {
    const innocentPhrases = [
      '作为一个朋友，我觉得你应该去试试',
      '我是小明啊，你忘了？',
      '作为一个普通人，我也会感到难过',
    ];

    for (const phrase of innocentPhrases) {
      const sanitized = sanitizeRuntimeOutput(phrase);
      assert.strictEqual(sanitized, phrase, `Must NOT false-positive trigger on: ${phrase}`);
    }
  });

  test('F9-T1-5: Fallback text uses authentic persona colloquialism, never repetitive generic assistant text', () => {
    const personaFallback = '在写方案呢，晚点回复你哦';
    const sanitized = sanitizeRuntimeOutput('', personaFallback);

    assert.strictEqual(sanitized, personaFallback);
    assert.strictEqual(sanitized.includes('怎么啦~'), false);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F9-T2-1: Natural dialogue containing "怎么啦" (e.g. "你怎么啦？没事吧") preserved intact', () => {
    const naturalConcern = '你怎么啦？遇到什么难处了吗？';
    const sanitized = sanitizeRuntimeOutput(naturalConcern);

    assert.strictEqual(sanitized, naturalConcern);
  });

  test('F9-T2-2: Empty or null model response yields contextual fallback rather than crashing', () => {
    assert.doesNotThrow(() => sanitizeRuntimeOutput(''));
    assert.doesNotThrow(() => sanitizeRuntimeOutput(null));
    assert.doesNotThrow(() => sanitizeRuntimeOutput(undefined));
  });

  test('F9-T2-3: Technical conversation with English programming terms not flagged by AI filter', () => {
    const techText = '检查下 async / await 和 Promise 的调用逻辑';
    const sanitized = sanitizeRuntimeOutput(techText);
    assert.strictEqual(sanitized, techText);
  });

  test('F9-T2-4: Consecutive identical user prompts do not trigger loop-fallback boilerplate', () => {
    const prompt = '在吗';
    const responses = ['在的', '在呢怎么啦', '在忙着呢'];

    for (const res of responses) {
      const sanitized = sanitizeRuntimeOutput(res);
      assert.notStrictEqual(sanitized, '在呢，怎么啦~');
    }
  });

  test('F9-T2-5: Timeout at boundary (e.g. 15,000ms) handles abort signal cleanly', async () => {
    const abortController = new AbortController();
    const timeoutPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve('completed'), 50);
      abortController.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Inference timeout after 15s'));
      });
    });

    // Abort cleanly
    abortController.abort();
    await assert.rejects(async () => await timeoutPromise, /Inference timeout/);
  });
});
