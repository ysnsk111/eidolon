import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPollutedContent,
  cleanMessageContent,
  isGroupAnnouncement,
  isSystemNotice,
  isSystemSender,
  sanitizeMessage,
} from '../../cli/ingestion/sanitize.js';

import { parseMdString } from '../../cli/ingestion/md.js';
import { normalizeMessages } from '../../cli/ingestion/normalize.js';
import { extractLanguageFingerprint } from '../../cli/distillation/language.js';
import { extractAssetModels, detectContextTags } from '../../cli/distillation/assets.js';
import { constructPersonaPackage, buildFewShotBlock } from '../../cli/distillation/persona.js';

describe('Data & Distillation Engine Overhaul Verification Tests', () => {

  // =========================================================================
  // Task 1: Ingestion Sanitizer Overhaul
  // =========================================================================
  describe('Task 1: Ingestion Sanitizer & Pollution Detection', () => {
    test('isPollutedContent strictly identifies group announcements, group declarations, and system notices', () => {
      const pollutedSamples = [
        '我是群聊“河南省实验中学初一36”',
        '我是群聊“河南省实验中学初一36?',
        '我是群聊"河南省实验中学初一36"',
        '我是群聊【河南省实验中学】',
        '我是群聊: 河南省实验中学',
        '我是群聊：户外摄影',
        '群公告：明天下午两点开会',
        '群规：禁止在群里发送广告',
        '群主提醒：请大家配合改备注',
        '本群须知：文明聊天，禁止刷屏',
        '欢迎加入河南省实验中学交流群',
        '欢迎新成员加入本群',
        '### 2026-05-27',
        '### [2026-05-27 10:20:00]',
        '## 会话记录 2026-05-27',
        '# 聊天记录导出',
        '[图片]',
        '[语音]',
        '[视频]',
        '[表情包]',
        '[动画表情]',
        '看这个 [图片] 好搞笑',
        '王小明 撤回了一条消息',
        '李雷 加入了群聊',
        '韩梅梅 移出了群聊',
        '小华 拍了拍 小红',
        '对方正在输入...',
        '你已添加了张三，现在可以开始聊天了。',
        '[微信红包] 恭喜发财，大吉大利',
        '[通话时长 12:34]',
      ];

      for (const sample of pollutedSamples) {
        assert.equal(
          isPollutedContent(sample),
          true,
          `Expected isPollutedContent to be true for: "${sample}"`
        );
      }
    });

    test('isPollutedContent allows authentic, clean conversation text', () => {
      const cleanSamples = [
        '明天去哪里吃饭呀',
        '好呀好呀，吃烤肉去！',
        '哈哈太好笑了，真的假的呀？',
        '收到收到，没问题妥妥的！',
        '晚安啦，早点休息',
        '这道题选C，不要选错啦',
      ];

      for (const sample of cleanSamples) {
        assert.equal(
          isPollutedContent(sample),
          false,
          `Expected isPollutedContent to be false for: "${sample}"`
        );
      }
    });

    test('cleanMessageContent purges system artifacts and extracts clean text', () => {
      // Group declarations must be completely purged to empty string
      assert.equal(cleanMessageContent('我是群聊“河南省实验中学初一36”'), '');
      assert.equal(cleanMessageContent('我是群聊“河南省实验中学初一36?'), '');
      assert.equal(cleanMessageContent('群公告：明天下午两点开会'), '');
      assert.equal(cleanMessageContent('群规：禁止发广告'), '');
      assert.equal(cleanMessageContent('欢迎加入群聊！请大家改备注'), '');
      assert.equal(cleanMessageContent('张三 撤回了一条消息'), '');
      assert.equal(cleanMessageContent('[图片]'), '');
      assert.equal(cleanMessageContent('### 2026-05-27'), '');

      // Mixed text should have headers and media tokens stripped cleanly
      const mixed = '看这个 [图片] 太逗了\n### 2026-05-27\n赶紧去看看';
      const cleaned = cleanMessageContent(mixed);
      assert.ok(!cleaned.includes('[图片]'));
      assert.ok(!cleaned.includes('###'));
      assert.ok(cleaned.includes('太逗了'));
    });
  });

  // =========================================================================
  // Task 2: Markdown Ingestion & Speaker Parsing
  // =========================================================================
  describe('Task 2: Markdown Chat Parsing Sanitization', () => {
    test('never attributes group declarations or headers as speaker message content', () => {
      const rawMd = `
### 2026-05-27
我是群聊“河南省实验中学初一36?”
群公告：明天期末考试
User: 666 页
王雅雯: 我是群聊“河南省实验中学初一36”
王雅雯: 我就直说了，直接问了
群主: 严禁发广告
王雅雯: 这道题选C
### 附录 考试须知
User: 好的收到
`;

      const result = parseMdString(rawMd, { targetSpeaker: '王雅雯' });

      // No message in the entire stream should contain group declaration or announcements
      for (const m of result.messages) {
        assert.ok(!m.content.includes('我是群聊'), `Message content must not contain "我是群聊": "${m.content}"`);
        assert.ok(!m.content.includes('群公告'), `Message content must not contain "群公告": "${m.content}"`);
        assert.ok(!m.content.includes('考试须知'), `Message content must not contain "考试须知": "${m.content}"`);
        assert.notEqual(m.sender, '群主', 'System entity "群主" must not be parsed as a conversation speaker');
      }

      // Valid target messages must be preserved
      const directMsg = result.messages.find((m) => m.content.includes('我就直说了'));
      assert.ok(directMsg, 'Target message "我就直说了" must be preserved');
      assert.equal(directMsg.sender, '王雅雯');

      const answerMsg = result.messages.find((m) => m.content.includes('这道题选C'));
      assert.ok(answerMsg, 'Target message "这道题选C" must be preserved');
    });
  });

  // =========================================================================
  // Task 3: Ingestion Normalization & Speaker Separation
  // =========================================================================
  describe('Task 3: Speaker Separation & System Sender Elimination', () => {
    test('strictly separates targetSpeaker from counterpartSpeaker and drops system senders', () => {
      const rawMessages = [
        { sender: '群公告', content: '重要通知' },
        { sender: '我是群聊“初一36班”', content: '欢迎加入' },
        { sender: 'Alice', content: '在吗？中午吃什么' },
        { sender: 'Bob', content: '吃烤肉吧！好久没吃了' },
        { sender: 'Alice', content: '好呀好呀，走起！' },
        { sender: 'System', content: 'Alice 撤回了一条消息' },
      ];

      const res = normalizeMessages(rawMessages, { targetSpeaker: 'Alice' });

      assert.equal(res.targetSpeaker, 'Alice');
      assert.equal(res.counterpartSpeaker, 'Bob');
      assert.notEqual(res.targetSpeaker.toLowerCase(), res.counterpartSpeaker.toLowerCase());

      // Ensure system entities are not counted as speakers
      assert.equal(res.speakers['群公告'], undefined);
      assert.equal(res.speakers['我是群聊“初一36班”'], undefined);
      assert.equal(res.speakers['System'], undefined);

      // Verify messages count
      assert.equal(res.messages.length, 3);
      assert.equal(res.targetMessageCount, 2);
    });

    test('recovers distinct counterpartSpeaker if caller mistakenly passed duplicate names', () => {
      const rawMessages = [
        { sender: 'Alice', content: '你好' },
        { sender: 'Bob', content: '嗨' },
      ];

      const res = normalizeMessages(rawMessages, { targetSpeaker: 'Alice', counterpartSpeaker: 'Alice' });
      assert.equal(res.targetSpeaker, 'Alice');
      assert.equal(res.counterpartSpeaker, 'Bob', 'Must resolve counterpart to distinct speaker Bob');
    });
  });

  // =========================================================================
  // Task 4: Language Distillation Tokenization & Catchphrase Extraction
  // =========================================================================
  describe('Task 4: Language Distillation & CJK Tokenization Overhaul', () => {
    test('eliminates broken tokens with spaces between Chinese characters', () => {
      const messages = [
        { sender: 'Alice', isTarget: true, content: '图 片 已经 发 送 了，不 是 这 样 的，好 吧，这 么 简 单。' },
        { sender: 'Alice', isTarget: true, content: '好呀好呀，确实没问题，好的收到！' },
        { sender: 'Alice', isTarget: true, content: '晚安啦，明天见，没事儿。' },
      ];

      const fp = extractLanguageFingerprint(messages, 'Alice');

      // Verify no whitespace between Chinese characters in vocabulary, bigrams, or trigrams
      for (const v of fp.vocabulary_profile.top_vocabulary) {
        assert.ok(
          !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(v.token),
          `Vocabulary token must not contain whitespace between CJK: "${v.token}"`
        );
      }
      for (const b of fp.vocabulary_profile.top_bigrams) {
        assert.ok(
          !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(b.token),
          `Bigram must not contain whitespace between CJK: "${b.token}"`
        );
      }
      for (const t of fp.vocabulary_profile.top_trigrams) {
        assert.ok(
          !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(t.token),
          `Trigram must not contain whitespace between CJK: "${t.token}"`
        );
      }
    });

    test('catchphrase extraction selects authentic colloquial phrases and excludes stopwords, media tokens, and broken spaces', () => {
      const messages = [
        { sender: 'Alice', isTarget: true, content: '没事没事，懂了就好！好的，收到啦！' },
        { sender: 'Alice', isTarget: true, content: '确实确实，好吧，没问题妥妥的！' },
        { sender: 'Alice', isTarget: true, content: '晚安安，明天见！' },
        { sender: 'Alice', isTarget: true, content: '哈哈哈笑死我了太逗了！' },
        { sender: 'Alice', isTarget: true, content: '这个那个什么怎么不是因为所以但是图片照片群聊公告' },
      ];

      const fp = extractLanguageFingerprint(messages, 'Alice');
      const catchphrases = fp.vocabulary_profile.catchphrases;

      // Authentic colloquial idioms must be captured
      const expectedColloquial = ['没事', '好的', '收到', '确实', '好吧', '没问题', '晚安', '哈哈'];
      const hasColloquial = expectedColloquial.some((exp) =>
        catchphrases.some((cp) => cp.includes(exp))
      );
      assert.ok(hasColloquial, `Catchphrases should contain authentic colloquial phrases: ${JSON.stringify(catchphrases)}`);

      // Forbidden words and tokens must NEVER be present
      const forbidden = ['这个', '那个', '什么', '怎么', '不是', '因为', '所以', '但是', '图片', '照片', '群聊', '公告'];
      for (const cp of catchphrases) {
        for (const fb of forbidden) {
          assert.notEqual(cp, fb, `Catchphrase must not be stopword or media token: "${cp}"`);
        }
        assert.ok(
          !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(cp),
          `Catchphrase must not contain spaces between Chinese characters: "${cp}"`
        );
      }
    });
  });

  // =========================================================================
  // Task 5: Emoji Contextual Modeling (Section 14 & 23)
  // =========================================================================
  describe('Task 5: Emoji Contextual Modeling per Section 14 & 23', () => {
    test('calculates authentic frequency, context distribution, and positional style', () => {
      const turns = [
        { context: [{ content: '真好笑' }], target_message: '哈哈哈太搞笑了😂' },
        { context: [{ content: '笨蛋' }], target_message: '哼才不是呢😏' },
        { context: [{ content: '好想你' }], target_message: '我也想你呀🥰' },
        { context: [{ content: '明天去吃饭吗' }], target_message: '好呀没问题走起👍' },
        { context: [{ content: '怎么会这样' }], target_message: '为什么呢🤔' },
        { context: [{ content: '好困' }], target_message: '晚安去睡了😴' },
      ];

      const assets = extractAssetModels(turns);

      assert.ok(assets.emoji_probability > 0, 'Emoji probability should be calculated');
      assert.equal(assets.total_emojis_used, 6);

      // Verify contextual bindings for each emotional phase
      const laughingEmoji = assets.emojis.find((e) => e.asset === '😂');
      assert.ok(laughingEmoji, 'Must model 😂');
      assert.ok(laughingEmoji.contexts.includes('joking'), '😂 must bind to joking context');
      assert.ok(laughingEmoji.position_style.text_suffix > 0, '😂 must model text_suffix positional style');

      const teasingEmoji = assets.emojis.find((e) => e.asset === '😏');
      assert.ok(teasingEmoji, 'Must model 😏');
      assert.ok(teasingEmoji.contexts.includes('teasing') || teasingEmoji.contexts.includes('teasing_banter'));

      const affectionEmoji = assets.emojis.find((e) => e.asset === '🥰');
      assert.ok(affectionEmoji, 'Must model 🥰');
      assert.ok(affectionEmoji.contexts.includes('affection'));

      const agreeEmoji = assets.emojis.find((e) => e.asset === '👍');
      assert.ok(agreeEmoji, 'Must model 👍');
      assert.ok(agreeEmoji.contexts.includes('agreement'));

      const thinkEmoji = assets.emojis.find((e) => e.asset === '🤔');
      assert.ok(thinkEmoji, 'Must model 🤔');
      assert.ok(thinkEmoji.contexts.includes('thinking'));

      const sleepEmoji = assets.emojis.find((e) => e.asset === '😴');
      assert.ok(sleepEmoji, 'Must model 😴');
      assert.ok(sleepEmoji.contexts.includes('tired_night') || sleepEmoji.contexts.includes('tired_sleep'));
    });

    test('reflects authentic persona usage without injecting generic default emojis', () => {
      const textsNoEmoji = ['好的', '收到', '明天见', '没问题'];
      const assets = extractAssetModels(textsNoEmoji);

      assert.equal(assets.total_emojis_used, 0);
      assert.equal(assets.emoji_probability, 0);
      assert.equal(assets.characteristic_emojis.length, 0, 'Must not inject generic emojis when target uses none');
    });
  });

  // =========================================================================
  // Task 6: Few-Shot Extraction & Generator Prompt Contract
  // =========================================================================
  describe('Task 6: Persona Construction & Few-Shot Validation', () => {
    test('buildFewShotBlock enforces ZERO role reversal, length bounds [2, 35], and eliminates pollution', () => {
      const dirtyDistillationSet = [
        // 1. Polluted turn with "我是群聊"
        {
          id: 'turn_polluted_group',
          context: [{ sender: 'Bob', content: '在吗？' }],
          target_message: '我是群聊“河南省实验中学初一36”',
        },
        // 2. Polluted turn with markdown header
        {
          id: 'turn_polluted_header',
          context: [{ sender: 'Bob', content: '今天去哪\n### 2026-05-27' }],
          target_message: '去吃火锅吧',
        },
        // 3. Polluted turn with image placeholder
        {
          id: 'turn_polluted_image',
          context: [{ sender: 'Bob', content: '[图片]' }],
          target_message: '看到了 [图片] 这题选C',
        },
        // 4. Role reversal: target speaker talking in counterpart context
        {
          id: 'turn_role_reversal',
          context: [{ sender: 'Alice', content: '我先问你' }],
          target_message: '好呀好呀',
          target_speaker: 'Alice',
        },
        // 5. Length out of bounds (< 2 chars)
        {
          id: 'turn_too_short',
          context: [{ sender: 'Bob', content: '好' }],
          target_message: '嗯',
        },
        // 6. Length out of bounds (> 35 chars)
        {
          id: 'turn_too_long',
          context: [{ sender: 'Bob', content: '今天的天气看起来非常不错你打算怎么度过呢不如我们一起出去逛街然后再去吃好吃的吧？' }],
          target_message: '好的呀',
        },
        // 7. Authentic turn: greeting
        {
          id: 'turn_clean_greeting',
          context: [{ sender: 'Bob', content: '早呀，今天去图书馆吗？' }],
          target_message: '肯定去呀~ 早安！',
          target_speaker: 'Alice',
        },
        // 8. Authentic turn: banter
        {
          id: 'turn_clean_banter',
          context: [{ sender: 'Bob', content: '笨蛋，昨天的数学题你又做错啦' }],
          target_message: '哼！才没有呢，我那是笔误！',
          target_speaker: 'Alice',
        },
        // 9. Authentic turn: agreement
        {
          id: 'turn_clean_agreement',
          context: [{ sender: 'Bob', content: '中午吃烤肉好不好？' }],
          target_message: '好呀好呀！走起！',
          target_speaker: 'Alice',
        },
        // 10. Authentic turn: affection
        {
          id: 'turn_clean_affection',
          context: [{ sender: 'Bob', content: '今天辛苦啦，抱抱' }],
          target_message: '你也辛苦啦，抱抱~ 🥰',
          target_speaker: 'Alice',
        },
        // 11. Authentic turn: casual sharing
        {
          id: 'turn_clean_casual',
          context: [{ sender: 'Bob', content: '晚上有什么安排吗？' }],
          target_message: '打算看一部电影，你呢？',
          target_speaker: 'Alice',
        },
      ];

      const fewShotStr = buildFewShotBlock(dirtyDistillationSet, 'Alice', 'Bob');

      // Must NOT contain polluted turns
      assert.ok(!fewShotStr.includes('我是群聊'), 'Must not contain "我是群聊"');
      assert.ok(!fewShotStr.includes('###'), 'Must not contain "###"');
      assert.ok(!fewShotStr.includes('[图片]'), 'Must not contain "[图片]"');

      // ZERO role reversal: Bob is prompt, Alice is response
      assert.ok(fewShotStr.includes('Bob: 早呀，今天去图书馆吗？\nAlice: 肯定去呀~ 早安！'));
      assert.ok(fewShotStr.includes('Bob: 笨蛋，昨天的数学题你又做错啦\nAlice: 哼！才没有呢，我那是笔误！'));
      assert.ok(fewShotStr.includes('Bob: 中午吃烤肉好不好？\nAlice: 好呀好呀！走起！'));
      assert.ok(fewShotStr.includes('Bob: 今天辛苦啦，抱抱\nAlice: 你也辛苦啦，抱抱~ 🥰'));
      assert.ok(fewShotStr.includes('Bob: 晚上有什么安排吗？\nAlice: 打算看一部电影，你呢？'));

      // Ensure no turn where Alice prompts Alice
      assert.ok(!fewShotStr.includes('Alice: 我先问你'), 'Must not contain role reversal turn');
    });

    test('Generator prompt adheres strictly to manual IM dialogue requirements', () => {
      const personaPkg = constructPersonaPackage({
        personaId: 'persona_overhaul_test',
        targetSpeaker: '林小汐',
        counterpartSpeaker: '陈默',
        languageModel: {
          vocabulary_profile: { catchphrases: ['好呀', '晚安', '没事', '确实'] },
          message_length: { median: 16, p90: 28 },
          sentence_length: { median: 12, p90: 20 },
          punctuation: { ellipsis_rate: 0.12, question_rate: 0.18 },
        },
        styleModel: {},
        behaviorModel: { response_policies: [], conversation_rhythm: { base_delay_ms: 2500 } },
        worldModel: { entities: [], relationships: [], timeline: [] },
        assetsModel: {
          emojis: [
            { asset: '😂', raw_count: 5, contexts: ['joking'] },
            { asset: '🥰', raw_count: 3, contexts: ['affection'] },
          ],
          stickers: [],
        },
        memorySeed: {},
        distillationSet: [
          {
            context: [{ sender: '陈默', content: '吃饭了吗？' }],
            target_message: '刚吃完火锅呢！',
            target_speaker: '林小汐',
          },
        ],
      });

      const genPrompt = personaPkg.system_prompts.generator;

      // Header requirement
      assert.ok(
        genPrompt.includes('You are 林小汐, chatting on WeChat/Telegram. Reply in 1-2 short colloquial phrases (10-25 characters), natural, warm, and authentic. No assistant boilerplate.'),
        'Must contain the required Generator prompt header'
      );

      // Conversational WeChat/Telegram contract
      assert.ok(genPrompt.includes('[DIRECT CASUAL IM DIALOGUE CONTRACT]'));
      assert.ok(genPrompt.includes('1-2 short phrases or broken sentences (10-25 characters)'));
      assert.ok(!genPrompt.includes('😊 ✨'), 'Must never include generic placeholder emojis');
      assert.ok(genPrompt.includes('陈默: 吃饭了吗？\n林小汐: 刚吃完火锅呢！'));
    });
  });
});
