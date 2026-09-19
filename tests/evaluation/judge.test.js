import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { executeBlindPairwiseJudge } from '../../cli/evaluation/judge.js';

describe('Pairwise Blind Judge Specification Tests', () => {
  test('should return structured scores and reason_codes in blind protocol', async () => {
    const context = [{ sender: 'Bob', content: '明天一起看电影吧！' }];
    const target = '好呀好呀，看哪一部？';
    const candidate = '可以呀，你想看什么类型的电影呢？';

    const result = await executeBlindPairwiseJudge({
      context,
      originalTarget: target,
      generatedCandidate: candidate,
      llmProvider: null,
    });

    assert.ok(result.judge_metadata.blind, 'Judge must maintain blind protocol');
    assert.ok(['A', 'B', 'TIE'].includes(result.blind_winner));
    assert.ok(Array.isArray(result.reason_codes), 'Must return structured reason_codes');
    assert.ok(result.score > 0 && result.score <= 1.0);
    assert.ok(result.confidence > 0);
  });
});
