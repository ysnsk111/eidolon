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

    // 7. Evaluation Metrics & DSI Aggregation
    const sampleResults = split.distillationSet.map((sample) => {
      const metrics = calculateSampleMetrics({
        originalTarget: sample.target_message,
        generatedCandidate: sample.target_message, // identical candidate for baseline self-consistency
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
        judge: { score: 0.88 },
      };
    });

    const report = aggregateEvaluationResults({
      sampleResults,
      personaId: 'alice_golden',
      qualityGate: {
        dsiThreshold: 0.75,
        lexicalThreshold: 0.75,
        styleThreshold: 0.75,
        behaviorThreshold: 0.75,
        contextThreshold: 0.80,
      },
    });

    // Verify DSI
    assert.ok(report.dsi >= 0.75, `Expected DSI >= 0.75, got ${report.dsi}`);
    assert.ok(report.metrics.lexical >= 0.75);
    assert.ok(report.metrics.style >= 0.75);
  });
});
