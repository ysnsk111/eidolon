import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTxtChat } from '../../cli/ingestion/txt.js';
import { chunkAndSplit } from '../../cli/distillation/chunker.js';
import { extractLanguageFingerprint } from '../../cli/distillation/language.js';
import { extractBehaviorAndRhythm } from '../../cli/distillation/behavior.js';
import { extractAssetModels } from '../../cli/distillation/assets.js';
import { buildWorldModel } from '../../cli/distillation/context.js';
import { constructPersonaPackage } from '../../cli/distillation/persona.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');

describe('Distillation Pipeline Tests', () => {
  const sampleTxt = path.join(fixturesDir, 'chat_sample.txt');
  const worldMd = path.join(fixturesDir, 'world_context.md');
  const normalized = parseTxtChat(sampleTxt);

  test('Chunker should split data into isolated train, validation, and blind test sets', () => {
    const split = chunkAndSplit(normalized);
    assert.ok(split.totalTurns > 0, 'Turns should be generated');
    assert.ok(split.distillationSet.length > 0, 'Distillation set should have items');
    assert.ok(split.isolationAudit.passed, 'Data isolation audit must pass');
  });

  test('Layer 1 Language Fingerprint should compute real statistical distributions', () => {
    const fp = extractLanguageFingerprint(normalized.messages, 'Alice');

    assert.ok(fp.sample_size > 0);
    assert.ok(fp.message_length.median > 0, 'Median message length must be calculated');
    assert.ok(fp.message_length.p90 >= fp.message_length.median, 'P90 must be >= median');
    assert.ok(typeof fp.punctuation.ellipsis_rate === 'number');
    assert.ok(typeof fp.punctuation.question_rate === 'number');
    assert.ok(Array.isArray(fp.vocabulary_profile.top_vocabulary));
  });

  test('Layer 2, 3, 4 Behavior and Rhythm should calculate conditional style and delay bounds', async () => {
    const split = chunkAndSplit(normalized);
    const behavior = await extractBehaviorAndRhythm(split.distillationSet, normalized.messages, 'Alice');

    assert.ok(typeof behavior.conditional_style.p_emoji_given_joking === 'number');
    assert.ok(behavior.conversation_rhythm.base_delay_ms >= 1200);
    assert.strictEqual(behavior.conversation_rhythm.typing_speed_cpm, null, 'Typing speed CPM must not be fabricated from chat timestamps');
    assert.strictEqual(behavior.conversation_rhythm.typing_model.enabled, false);
    assert.ok(behavior.conversation_rhythm.response_latency);
    assert.ok(Array.isArray(behavior.response_policies));
    assert.ok(behavior.response_policies.length > 0);
  });

  test('Layer 5 Emoji & Sticker Model should associate contexts', () => {
    const texts = normalized.messages.filter((m) => m.isTarget).map((m) => m.content);
    const assets = extractAssetModels(texts);

    assert.ok(Array.isArray(assets.emojis));
    assert.ok(assets.total_emojis_used >= 0);
  });

  test('Layer 6 World Model should enforce strict provenance between context and chat', async () => {
    const split = chunkAndSplit(normalized);
    const world = await buildWorldModel(worldMd, normalized.messages, split.distillationSet);

    assert.ok(world.entities.length > 0);
    assert.ok(world.provenance_summary.strict_provenance_enforced);

    // Verify entities origin distinction
    const hasSupplied = world.entities.some((e) => e.source === 'supplied_context');
    const hasConversational = world.entities.some((e) => e.source === 'historical_conversation');
    assert.ok(hasSupplied, 'Must track supplied context entities');
    assert.ok(hasConversational, 'Must track historical conversation entities');
  });

  test('Persona Construction should generate comprehensive 1:1 agent system prompts', () => {
    const fp = extractLanguageFingerprint(normalized.messages, 'Alice');
    const split = chunkAndSplit(normalized);

    const personaPkg = constructPersonaPackage({
      personaId: 'persona_test_001',
      targetSpeaker: 'Alice',
      counterpartSpeaker: 'User',
      languageModel: fp,
      styleModel: { favored_punctuations: ['~'], metrics: fp.punctuation, length_distribution: fp.message_length },
      behaviorModel: { response_policies: [], conversation_rhythm: { base_delay_ms: 3000 } },
      worldModel: { entities: [], relationships: [], timeline: [] },
      assetsModel: { emojis: [{ asset: '🥺', count: 1 }], stickers: [] },
      memorySeed: {},
    });

    assert.equal(personaPkg.id, 'persona_test_001');
    assert.ok(personaPkg.system_prompts.generator.includes('Alice'));
    assert.ok(personaPkg.system_prompts.generator.includes('[CORE LINGUISTIC FINGERPRINT]'));
    assert.ok(personaPkg.system_prompts.critic.includes('[CRITIQUE DIMENSIONS]'));
    assert.ok(personaPkg.system_prompts.judge.includes('[BLIND PROTOCOL]'));
    assert.ok(personaPkg.system_prompts.memory.includes('[EXTRACTION RULES]'));
  });
});
