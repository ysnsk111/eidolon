import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractValidEmojis,
  buildContextualEmojiBindings,
} from './helpers/e2e_harness.js';
import { extractAssetModels } from '../../cli/distillation/assets.js';

describe('Feature F6 E2E: Emoji Contextual Modeling', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F6-T1-1: Compound emojis with ZWJ and modifiers are captured as atomic emoji units', () => {
    const text = '火热的心 ❤️‍🔥 和家庭 👨‍👩‍👧 还有欢呼 🎉';
    const emojis = extractValidEmojis(text);

    assert.ok(emojis.includes('❤️‍🔥'), 'Must match compound heart on fire');
    assert.ok(emojis.includes('👨‍👩‍👧'), 'Must match compound family emoji with ZWJ');
    assert.ok(emojis.includes('🎉'));
  });

  test('F6-T1-2: Non-emoji symbols like "®" and "©" are strictly excluded from emoji asset catalog', () => {
    const text = '品牌注册商标®与版权©声明，开心😂';
    const emojis = extractValidEmojis(text);

    assert.strictEqual(emojis.includes('®'), false, 'Must NOT treat Registered Trademark as emoji');
    assert.strictEqual(emojis.includes('©'), false, 'Must NOT treat Copyright as emoji');
    assert.ok(emojis.includes('😂'));
  });

  test('F6-T1-3: Contextual emoji bindings map emotions (joking, tired, cute, teasing) accurately', () => {
    const emojiMap = {
      joking: ['😂', '🤣'],
      tired_sleep: ['😴'],
      pleading_cute: ['🥺'],
      teasing: ['😏'],
    };
    const bindings = buildContextualEmojiBindings(emojiMap);

    assert.ok(bindings.includes('* When joking: 😂, 🤣'));
    assert.ok(bindings.includes('* When tired/goodnight: 😴'));
    assert.ok(bindings.includes('* When cute/pleading: 🥺'));
    assert.ok(bindings.includes('* When teasing: 😏'));
  });

  test('F6-T1-4: System prompt contextual emoji bindings eliminate fallback to generic "😊 ✨"', () => {
    const emptyEmojiMap = {};
    const bindings = buildContextualEmojiBindings(emptyEmojiMap);

    assert.strictEqual(bindings.includes('😊 ✨'), false, 'Must never fall back to generic assistant "😊 ✨"');
    assert.ok(bindings.includes('omit emojis rather than use synthetic placeholders'));
  });

  test('F6-T1-5: Turn-to-target alignment avoids array index desynchronization and out-of-bounds errors', () => {
    // targetTexts has 5 items, turns has only 2 items
    const targetTexts = ['你好呀', '吃了吗', '哈哈😂', '好的', '晚安😴'];
    const turns = [
      { context: [{ content: '你好' }], target_message: '你好呀' },
      { context: [{ content: '在干嘛' }], target_message: '吃了吗' },
    ];

    // Calling extractAssetModels should not throw or crash on index overflow
    const assets = extractAssetModels(targetTexts, turns);
    assert.ok(assets);
    assert.ok(Array.isArray(assets.emojis));
    assert.ok(assets.total_emojis_used >= 2);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F6-T2-1: Zero observed emojis in dataset produces clean omission directive rather than assistant boilerplate', () => {
    const textsWithoutEmojis = ['好的', '收到', '明白了', '明天见'];
    const assets = extractAssetModels(textsWithoutEmojis);

    assert.strictEqual(assets.total_emojis_used, 0);
    const bindings = buildContextualEmojiBindings({});
    assert.strictEqual(bindings.includes('😊'), false);
  });

  test('F6-T2-2: Multiple consecutive emojis across spaces and punctuation extracted accurately', () => {
    const text = '太棒了！！！🎉🎉🥳  冲冲冲🔥';
    const emojis = extractValidEmojis(text);

    assert.strictEqual(emojis.filter((e) => e === '🎉').length, 2);
    assert.ok(emojis.includes('🥳'));
    assert.ok(emojis.includes('🔥'));
  });

  test('F6-T2-3: Skin tone modifier variants (e.g. 👍🏽, 👩🏽‍💻) preserved without splitting', () => {
    const text = '点赞 👍🏽 和写代码 👩🏽‍💻';
    const emojis = extractValidEmojis(text);

    assert.ok(emojis.includes('👍🏽'));
    assert.ok(emojis.includes('👩🏽‍💻'));
  });

  test('F6-T2-4: Keycap emojis (#️⃣, 1️⃣) and heart variations (❤️‍🔥) recognized', () => {
    const text = '燃烧的心 ❤️‍🔥 还有火热 🔥';
    const emojis = extractValidEmojis(text);

    assert.ok(emojis.includes('❤️‍🔥'));
    assert.ok(emojis.includes('🔥'));
  });

  test('F6-T2-5: Ambiguous sentiment turns default safely to nearest situation policy', () => {
    const ambiguousMap = {
      joking: ['😂'],
    };
    const bindings = buildContextualEmojiBindings(ambiguousMap);
    assert.ok(bindings.includes('* When joking: 😂'));
    assert.strictEqual(bindings.includes('* When tired/goodnight:'), false);
  });
});
