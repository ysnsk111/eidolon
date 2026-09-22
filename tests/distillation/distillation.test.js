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

    // F5 DoD: Zero artificial whitespace between Chinese bigrams
    for (const b of fp.vocabulary_profile.top_bigrams) {
      assert.ok(!/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(b.token), `Chinese bigram should not have space: ${b.token}`);
    }

    // F5 DoD: Catchphrases must not contain stopword noise, artificial spaces, or media tokens
    for (const cp of fp.vocabulary_profile.catchphrases) {
      assert.ok(!/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(cp), `Catchphrase should not have space: ${cp}`);
      assert.ok(!cp.includes('图片'), `Catchphrase must not contain media token '图片': ${cp}`);
      assert.ok(!cp.includes('我是群聊'), `Catchphrase must not contain announcement: ${cp}`);
    }

    // F5 DoD: Openers and Closers must be clean authentic messages
    for (const opener of fp.openers) {
      assert.ok(!opener.startsWith('#'), `Opener must not start with #: ${opener}`);
      assert.ok(!opener.includes('我是群聊'), `Opener must not be announcement: ${opener}`);
      assert.ok(!opener.includes('[图片]'), `Opener must not contain [图片]: ${opener}`);
    }
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
    const split = chunkAndSplit(normalized);
    const assets = extractAssetModels(texts, split.distillationSet);

    assert.ok(Array.isArray(assets.emojis));
    assert.ok(assets.total_emojis_used >= 0);

    // F6 DoD: Emojis associate with contextual emotional tags
    const pleading = assets.emojis.find((e) => e.asset === '🥺');
    if (pleading) {
      assert.ok(pleading.contexts.includes('pleading_cute'), '🥺 should be associated with pleading_cute');
    }
    const sleep = assets.emojis.find((e) => e.asset === '😴');
    if (sleep) {
      assert.ok(sleep.contexts.includes('tired_sleep'), '😴 should be associated with tired_sleep');
    }

    // F6 DoD: Compound emojis supported and non-emojis like ® filtered
    const sampleWithSpecial = ['你好 👍🏻 👨‍👩‍👧‍👦 🇨🇳 ® © 哈哈'];
    const specialAssets = extractAssetModels(sampleWithSpecial);
    const foundAssets = specialAssets.emojis.map((e) => e.asset);
    assert.ok(foundAssets.includes('👍🏻'), 'Should recognize skin-tone modified emoji');
    assert.ok(!foundAssets.includes('®'), 'Should filter out trademark symbol ®');
    assert.ok(!foundAssets.includes('©'), 'Should filter out copyright symbol ©');
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
      assetsModel: { emojis: [{ asset: '🥺', count: 1, contexts: ['pleading_cute'] }], stickers: [] },
      memorySeed: {},
    });

    assert.equal(personaPkg.id, 'persona_test_001');
    assert.ok(personaPkg.system_prompts.generator.includes('Alice'));
    assert.ok(personaPkg.system_prompts.generator.includes('[CORE LINGUISTIC FINGERPRINT]'));
    assert.ok(personaPkg.system_prompts.critic.includes('[CRITIQUE DIMENSIONS]'));
    assert.ok(personaPkg.system_prompts.judge.includes('[BLIND PROTOCOL]'));
    assert.ok(personaPkg.system_prompts.memory.includes('[EXTRACTION RULES]'));

    // F6 & F7 DoD: Check generator prompt contracts and emoji bindings
    assert.ok(!personaPkg.system_prompts.generator.includes('😊 ✨'), "Must not contain generic fallback '😊 ✨'");
    assert.ok(!personaPkg.system_prompts.generator.includes('[CANDIDATE GENERATION CONTRACT]'), 'Must not contain legacy candidate generation contract');
    assert.ok(personaPkg.system_prompts.generator.includes('[DIRECT CASUAL IM DIALOGUE CONTRACT]'), 'Must contain direct casual IM dialogue contract');
    assert.ok(personaPkg.system_prompts.generator.includes('Emoji Habits & Contextual Bindings'), 'Must include contextual emoji bindings');
  });

  test('Persona few-shot selection must filter out headers, image placeholders, and group announcements', () => {
    const fp = extractLanguageFingerprint(normalized.messages, 'Alice');
    const dirtyDistillationSet = [
      {
        id: 'turn_dirty_1',
        context: [{ sender: 'User', content: '666 页\n### 2026-05-27' }],
        target_message: '我是群聊“河南省实验中学初一36”',
      },
      {
        id: 'turn_dirty_2',
        context: [{ sender: 'User', content: '[图片]' }],
        target_message: '看到了 [图片] 这题选C',
      },
      {
        id: 'turn_clean_1',
        context: [{ sender: 'Bob', content: '今天去图书馆吗？' }],
        target_message: '肯定去呀~ 早呀',
      },
      {
        id: 'turn_clean_burst',
        context: [
          { sender: 'Bob', content: '在吗' },
          { sender: 'Bob', content: '中午一起吃饭吗' },
        ],
        target_message: '好呀好呀！吃烤肉',
      },
    ];

    const personaPkg = constructPersonaPackage({
      personaId: 'persona_clean_test',
      targetSpeaker: 'Alice',
      counterpartSpeaker: 'Bob',
      languageModel: fp,
      styleModel: {},
      behaviorModel: { response_policies: [], conversation_rhythm: { base_delay_ms: 3000 } },
      worldModel: { entities: [], relationships: [], timeline: [] },
      assetsModel: { emojis: [{ asset: '🥺', count: 2, contexts: ['pleading_cute'] }], stickers: [] },
      memorySeed: {},
      distillationSet: dirtyDistillationSet,
    });

    const genPrompt = personaPkg.system_prompts.generator;
    assert.ok(!genPrompt.includes('### 2026-05-27'), 'Few-shot must not contain date header');
    assert.ok(!genPrompt.includes('[图片]'), 'Few-shot must not contain [图片]');
    assert.ok(!genPrompt.includes('我是群聊'), 'Few-shot must not contain group announcement');
    assert.ok(genPrompt.includes('Bob:'), 'Few-shot must use dynamic counterpart naming');
    assert.ok(genPrompt.includes('在吗\n中午一起吃饭吗'), 'Burst messages from counterpart must be joined');
    assert.ok(genPrompt.includes('When asking, acting cute or pleading: 🥺'), 'Contextual emoji binding must be present');
  });
});
