import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeMessages } from '../../cli/ingestion/normalize.js';
import { chunkAndSplit } from '../../cli/distillation/chunker.js';
import { extractLanguageFingerprint } from '../../cli/distillation/language.js';
import { extractBehaviorAndRhythm } from '../../cli/distillation/behavior.js';
import { constructPersonaPackage } from '../../cli/distillation/persona.js';
import { calculateSampleMetrics } from '../../cli/evaluation/metrics.js';
import { aggregateEvaluationResults } from '../../cli/evaluation/aggregate.js';

describe('End-to-End Distillation & Golden Regression Tests', () => {
  test('should run full distillation and evaluation regression against golden dataset', async () => {
    // 1. Load golden dataset
    const goldenPath = path.join(process.cwd(), 'tests', 'golden', 'dataset.jsonl');
    const lines = fs.readFileSync(goldenPath, 'utf-8').trim().split('\n');
    const rawMessages = lines.map((l) => JSON.parse(l));

    // 2. Normalize
    const normalized = normalizeMessages(rawMessages, { targetSpeaker: 'Alice' });
    assert.strictEqual(normalized.targetSpeaker, 'Alice');
    assert.ok(normalized.messages.length >= 8);

    // 3. Chunker & Split
    const split = chunkAndSplit(normalized);
    assert.ok(split.distillationSet.length > 0);
    assert.strictEqual(split.isolationAudit.speakerLeakage, 0);

    // 4. Language Fingerprint
    const language = extractLanguageFingerprint(normalized.messages, 'Alice');
    assert.ok(language.message_length.median > 0);
    assert.ok(language.chinese_particles);
    assert.ok(language.chinese_particles.overall_particle_rate > 0);

    // 5. Behavior & Rhythm
    const behavior = await extractBehaviorAndRhythm(split.distillationSet, normalized.messages, 'Alice');
    assert.strictEqual(behavior.conversation_rhythm.typing_speed_cpm, null, 'Typing speed CPM must not be fabricated');
    assert.strictEqual(behavior.conversation_rhythm.typing_model.enabled, false);
    assert.ok(behavior.conversation_rhythm.response_latency);

    // 6. Persona Construction
    const persona = constructPersonaPackage({
      personaId: 'alice_golden',
      targetSpeaker: 'Alice',
      counterpartSpeaker: 'Bob',
      languageModel: language,
      styleModel: {},
      behaviorModel: behavior,
      worldModel: { entities: [], facts: [] },
      assetsModel: { emojis: [] },
      memorySeed: { l0: [], l1: [], l2: [], l3: [] },
    });
    assert.ok(persona.system_prompts.generator);
    assert.ok(persona.prompt_versions);

    // 7. Evaluation Metrics & DSI Aggregation: Golden Regression 3 Baselines (Section 17)
    // Baseline A: Identity Baseline (upper bound verification: target == candidate)
    const identitySampleResults = split.distillationSet.map((sample) => {
      const metrics = calculateSampleMetrics({
        originalTarget: sample.target_message,
        generatedCandidate: sample.target_message,
        context: sample.context,
        languageModel: language,
        styleModel: {},
        behaviorModel: behavior,
        worldModel: {},
      });

      return {
        sample_id: sample.id,
        context: sample.context,
        original_target: sample.target_message,
        generated_candidate: sample.target_message,
        metrics,
        judge: { score: 0.90 },
      };
    });

    const identityReport = aggregateEvaluationResults({
      sampleResults: identitySampleResults,
      personaId: 'alice_golden',
      qualityGate: {
        dsiThreshold: 0.75,
        lexicalThreshold: 0.75,
        styleThreshold: 0.75,
        behaviorThreshold: 0.75,
        contextThreshold: 0.80,
      },
    });

    // Verify Identity Baseline Upper Bound
    assert.ok(identityReport.dsi >= 0.75, `Expected Identity DSI >= 0.75, got ${identityReport.dsi}`);
    assert.ok(identityReport.metrics.lexical >= 0.75);
    assert.ok(identityReport.metrics.style >= 0.75);

    // Baseline B: Bad Baseline (deliberately mismatched, stiff customer-service tone)
    const badCandidates = [
      '尊敬的用户您好，根据服务规范与业务办理流程，您所提交的问题已被客服系统登记，请耐心等待处理。',
      '关于您所咨询的业务事项，目前暂无更多公开信息，请参阅官方帮助文档或咨询后台技术支持。',
      '该请求不符合标准服务工单规范，请按照标准化格式重新提交您的业务申报表单。',
      '经系统核验，相关会话状态正常，如有其他技术疑问请拨打服务热线进行人工接入。',
    ];

    const badSampleResults = split.distillationSet.map((sample, idx) => {
      const badCand = badCandidates[idx % badCandidates.length];
      const metrics = calculateSampleMetrics({
        originalTarget: sample.target_message,
        generatedCandidate: badCand,
        context: sample.context,
        languageModel: language,
        styleModel: {},
        behaviorModel: behavior,
        worldModel: {},
      });

      return {
        sample_id: sample.id,
        context: sample.context,
        original_target: sample.target_message,
        generated_candidate: badCand,
        metrics,
        judge: { score: 0.20 }, // Pairwise blind judge strongly penalizes robotic out-of-character text
      };
    });

    const badReport = aggregateEvaluationResults({
      sampleResults: badSampleResults,
      personaId: 'alice_golden',
      qualityGate: {
        dsiThreshold: 0.75,
      },
    });

    // Section 17 Assertion: Bad Candidate DSI MUST be significantly strictly lower than Good Candidate DSI
    assert.ok(
      badReport.dsi < identityReport.dsi,
      `Discriminative failure: Bad Candidate DSI (${badReport.dsi}) must be < Identity DSI (${identityReport.dsi})`
    );
    assert.ok(
      badReport.metrics.lexical < identityReport.metrics.lexical,
      `Lexical metric must penalize out-of-vocabulary candidate (${badReport.metrics.lexical} vs ${identityReport.metrics.lexical})`
    );
    assert.ok(badReport.dsi < 0.60, `Bad Candidate DSI should be low, got ${badReport.dsi}`);

    // Baseline C: Synthetic Generation Baseline (simulated realistic generator candidates)
    const syntheticCandidates = [
      '好呀好呀，我已经在图书馆靠窗的老位置坐好啦，快来~',
      '豚骨拉面真的绝了！热腾腾的汤底最治愈啦~',
      '哪有嘛，明明是因为拉面真的太香太好吃了呀！',
      '不用担心啦，这周末我们一起突击复习，稳过的！加油摸摸头~',
      '今天辛苦啦，早点休息，明天见哦，晚安~',
    ];

    const syntheticSampleResults = split.distillationSet.map((sample, idx) => {
      const synCand = syntheticCandidates[idx % syntheticCandidates.length];
      const metrics = calculateSampleMetrics({
        originalTarget: sample.target_message,
        generatedCandidate: synCand,
        context: sample.context,
        languageModel: language,
        styleModel: {},
        behaviorModel: behavior,
        worldModel: {},
      });

      return {
        sample_id: sample.id,
        context: sample.context,
        original_target: sample.target_message,
        generated_candidate: synCand,
        metrics,
        judge: { score: 0.85 },
      };
    });

    const syntheticReport = aggregateEvaluationResults({
      sampleResults: syntheticSampleResults,
      personaId: 'alice_golden',
      qualityGate: {
        dsiThreshold: 0.65,
      },
    });

    // Synthetic candidate should substantially outperform bad baseline
    assert.ok(
      syntheticReport.dsi > badReport.dsi,
      `Synthetic candidate DSI (${syntheticReport.dsi}) must exceed bad baseline (${badReport.dsi})`
    );
    assert.ok(
      syntheticReport.metrics.lexical > badReport.metrics.lexical,
      'Synthetic candidate lexical similarity should exceed bad baseline'
    );
  });
});
