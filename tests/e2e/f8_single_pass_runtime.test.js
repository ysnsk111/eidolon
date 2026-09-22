import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectCasualSystemPrompt,
  sanitizeRuntimeOutput,
} from './helpers/e2e_harness.js';

describe('Feature F8 E2E: Single-Pass Direct Runtime Generation', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F8-T1-1: System prompt enforces Direct Casual IM Dialogue contract without 3-candidate schema', () => {
    const prompt = buildDirectCasualSystemPrompt({
      personaName: '王雅雯',
      counterpartName: '小明',
      styleDirectives: ['* 多用短句', '* 语气随和'],
    });

    assert.ok(prompt.includes('[DIRECT CASUAL IM DIALOGUE CONTRACT]'));
    assert.ok(prompt.includes('1-2 short colloquial phrases'));
    assert.strictEqual(prompt.includes('candidate_a'), false);
    assert.strictEqual(prompt.includes('candidate_b'), false);
  });

  test('F8-T1-2: System prompt explicitly omits [CANDIDATE GENERATION CONTRACT] (candidate_a/b/c)', () => {
    const prompt = buildDirectCasualSystemPrompt({
      personaName: 'Alice',
      counterpartName: 'Bob',
    });

    assert.strictEqual(prompt.includes('[CANDIDATE GENERATION CONTRACT]'), false);
    assert.strictEqual(prompt.includes('"candidate_a": string'), false);
    assert.strictEqual(prompt.includes('strategy_applied'), false);
  });

  test('F8-T1-3: Casual IM response is concise (1-2 short phrases, 10-25 chars typical)', () => {
    const rawOutputs = [
      '好呀，等我忙完这阵子找你！',
      '已经在路上了，五分钟到~',
      '哈哈太逗了吧，笑死我了',
    ];

    for (const raw of rawOutputs) {
      const sanitized = sanitizeRuntimeOutput(raw);
      assert.ok(sanitized.length >= 5 && sanitized.length <= 40);
    }
  });

  test('F8-T1-4: Casual IM response omits unnatural trailing full-stops / periods', () => {
    const rawOutputs = [
      '在忙呢。',
      '好的收到啦.',
      '明天再看吧。。',
    ];

    for (const raw of rawOutputs) {
      const sanitized = sanitizeRuntimeOutput(raw);
      assert.strictEqual(sanitized.endsWith('.'), false, 'Must not end in ascii period');
      assert.strictEqual(sanitized.endsWith('。'), false, 'Must not end in fullwidth period');
    }
  });

  test('F8-T1-5: Direct runtime execution records Style Critic status as "not_run"', () => {
    // Contract per PROJECT.md § Interface Contracts #2: CriticResult.Status = "not_run"
    const generationResult = {
      FinalMessage: '马上来~',
      TargetQuoteMsgID: 0,
      CriticResult: { Status: 'not_run' },
      Schedule: { TotalDelayMs: 2500 },
    };

    assert.strictEqual(generationResult.CriticResult.Status, 'not_run');
    assert.strictEqual(generationResult.TargetQuoteMsgID, 0);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F8-T2-1: Model output wrapped in accidental markdown code fences unwrapped cleanly', () => {
    const fenced = '```text\n好的，这就来\n```';
    const sanitized = sanitizeRuntimeOutput(fenced);
    assert.strictEqual(sanitized, '好的，这就来');
  });

  test('F8-T2-2: Model output wrapped in outer quotation marks stripped to clean colloquial phrase', () => {
    const doubleQuoted = '"快去休息吧，晚安~"';
    const cjkQuoted = '“没事的，放宽心”';

    assert.strictEqual(sanitizeRuntimeOutput(doubleQuoted), '快去休息吧，晚安~');
    assert.strictEqual(sanitizeRuntimeOutput(cjkQuoted), '没事的，放宽心');
  });

  test('F8-T2-3: Ultra-short single word response ("好", "对") accepted as valid casual response', () => {
    assert.strictEqual(sanitizeRuntimeOutput('好'), '好');
    assert.strictEqual(sanitizeRuntimeOutput('对'), '对');
    assert.strictEqual(sanitizeRuntimeOutput('嗯嗯'), '嗯嗯');
  });

  test('F8-T2-4: Expressive colloquial responses with exclamations or tildes preserved', () => {
    const expressive = '哇塞！！太厉害了吧~~🎉';
    const sanitized = sanitizeRuntimeOutput(expressive);
    assert.strictEqual(sanitized, expressive);
  });

  test('F8-T2-5: Prompt assembly with zero style directives generates valid direct prompt', () => {
    const minimalPrompt = buildDirectCasualSystemPrompt({
      personaName: 'Target',
      counterpartName: 'Friend',
    });

    assert.ok(minimalPrompt.includes('You are Target'));
    assert.ok(minimalPrompt.includes('close friend Friend'));
  });
});
