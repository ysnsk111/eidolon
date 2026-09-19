import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSampleMetrics } from '../../cli/evaluation/metrics.js';
import { executeBlindPairwiseJudge } from '../../cli/evaluation/judge.js';
import { aggregateEvaluationResults } from '../../cli/evaluation/aggregate.js';

describe('Evaluation Engine & DSI Formula Tests', () => {
  const dummyContext = [{ sender: 'User', content: '今天去图书馆自习吗？' }];
  const targetMessage = '好呀好呀，我马上到靠窗位置~';
  const candidateMessage = '好呀，在二楼自习室靠窗等你~';

  test('calculateSampleMetrics should compute 4 dimensions', () => {
    const metrics = calculateSampleMetrics({
      originalTarget: targetMessage,
      generatedCandidate: candidateMessage,
      context: dummyContext,
      languageModel: { vocabulary_profile: { catchphrases: ['好呀'] } },
      styleModel: {},
      behaviorModel: {},
      worldModel: {},
    });

    assert.ok(metrics.lexical >= 0.50, 'Lexical score should be high for similar tokens');
    assert.ok(metrics.style >= 0.60, 'Style score should match punctuation & tone');
    assert.ok(metrics.behavior >= 0.70, 'Behavior score should match agreement strategy');
    assert.ok(metrics.context >= 0.80, 'Context consistency should be high');
  });

  test('executeBlindPairwiseJudge should return objective judgment score', async () => {
    const judge = await executeBlindPairwiseJudge({
      context: dummyContext,
      originalTarget: targetMessage,
      generatedCandidate: candidateMessage,
      llmProvider: null, // test deterministic heuristic fallback
    });

    assert.ok(judge.score >= 0.60);
    assert.ok(['A', 'B', 'TIE'].includes(judge.blind_winner));
  });

  test('aggregateEvaluationResults must strictly enforce Section 21 DSI formula', () => {
    const sampleResults = [
      {
        sample_id: 'test_1',
        context: dummyContext,
        original_target: targetMessage,
        generated_candidate: candidateMessage,
        metrics: { lexical: 0.85, style: 0.90, behavior: 0.80, context: 0.95, issues: [] },
        judge: { score: 0.85 },
      },
    ];

    const report = aggregateEvaluationResults({ sampleResults, personaId: 'persona_test' });

    // Expected DSI = 0.85*0.20 + 0.90*0.20 + 0.80*0.25 + 0.95*0.15 + 0.85*0.20
    // = 0.17 + 0.18 + 0.20 + 0.1425 + 0.17 = 0.8625
    assert.ok(Math.abs(report.dsi - 0.863) < 0.01, `DSI should match weighted formula, got: ${report.dsi}`);
    assert.equal(report.status, 'PASS');
    assert.ok(report.gate_results.dsi_pass);
    assert.ok(report.gate_results.behavior_pass);
  });

  test('runEvaluation must return INSUFFICIENT_DATA without synthetic calibration on empty blind test set', async () => {
    const { runEvaluation } = await import('../../cli/evaluation/runner.js');
    const report = await runEvaluation({
      persona: { id: 'test_persona', system_prompts: { generator: 'prompt' }, target_speaker: 'Alice' },
      testDataset: [],
      languageModel: {},
      styleModel: {},
      behaviorModel: {},
      worldModel: {},
    });

    assert.strictEqual(report.status, 'INSUFFICIENT_DATA');
    assert.strictEqual(report.dataset_size, 0);
    assert.strictEqual(report.dsi, null);
    assert.strictEqual(report.metrics.lexical, null);
    assert.strictEqual(report.metrics.context, null);
  });

  test('aggregateEvaluationResults correctly renormalizes weights when context score is null', () => {
    const sampleResults = [
      {
        sample_id: 'test_no_c',
        context: dummyContext,
        original_target: targetMessage,
        generated_candidate: candidateMessage,
        metrics: { lexical: 0.80, style: 0.80, behavior: 0.80, context: null, issues: [] },
        judge: { score: 0.80 },
      },
    ];

    const report = aggregateEvaluationResults({ sampleResults, personaId: 'persona_no_c' });
    // Expected DSI = (0.80*0.20 + 0.80*0.20 + 0.80*0.25 + 0.80*0.20) / 0.85 = 0.80 / 0.85 * 0.85 = 0.80
    assert.strictEqual(report.metrics.context, null);
    assert.ok(Math.abs(report.dsi - 0.80) < 0.005);
    assert.strictEqual(Number.isNaN(report.dsi), false);
  });
});

