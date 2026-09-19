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
    assert.strictEqual(result.judge_metadata.mode, 'heuristic_judge');
  });

  test('should call llmProvider.judge directly when provider is supplied', async () => {
    const context = [{ sender: 'Bob', content: '明天一起看电影吧！' }];
    const target = '好呀好呀，看哪一部？';
    const candidate = '可以呀，你想看什么类型的电影呢？';

    let judgeCalled = false;
    let receivedModel = '';
    const mockProvider = {
      judgeModel: 'custom-judge-v1',
      async judge(ctx, candA, candB, options) {
        judgeCalled = true;
        receivedModel = options.judgeModel;
        return {
          winner: 'B',
          confidence: 0.90,
          style_similarity: 0.85,
          behavior_similarity: 0.82,
          context_similarity: 0.95,
          reason_codes: ['natural_dialogue', 'good_rhythm'],
          rationale: 'Candidate captured conversational rhythm accurately',
          judge_model: options.judgeModel,
        };
      },
    };

    const result = await executeBlindPairwiseJudge({
      context,
      originalTarget: target,
      generatedCandidate: candidate,
      llmProvider: mockProvider,
      judgeModel: 'custom-judge-v1',
    });

    assert.ok(judgeCalled, 'llmProvider.judge must be called');
    assert.strictEqual(receivedModel, 'custom-judge-v1');
    assert.strictEqual(result.judge_metadata.mode, 'llm_judge');
    assert.strictEqual(result.confidence, 0.90);
    assert.strictEqual(result.dimension_scores.context_similarity, 0.95);
    // composite = 0.85*0.4 + 0.82*0.35 + 0.95*0.25 = 0.34 + 0.287 + 0.2375 = 0.8645 -> 0.865
    assert.strictEqual(result.score, 0.865);
  });

  test('should fall back to deterministic heuristic judge if LLM judge fails', async () => {
    const context = [{ sender: 'Bob', content: '明天一起看电影吧！' }];
    const target = '好呀好呀，看哪一部？';
    const candidate = '可以呀，你想看什么类型的电影呢？';

    const failingProvider = {
      judgeModel: 'faulty-judge',
      async judge() {
        throw new Error('Connection refused to LLM service');
      },
    };

    const result = await executeBlindPairwiseJudge({
      context,
      originalTarget: target,
      generatedCandidate: candidate,
      llmProvider: failingProvider,
    });

    assert.strictEqual(result.judge_metadata.mode, 'heuristic_judge');
    assert.strictEqual(result.judge_metadata.heuristic_fallback, true);
    assert.ok(result.score > 0);
  });
});
