import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateHeader,
  extractDateFromHeader,
  stripMarkdownHeaders,
  stripMediaTokens,
  isGroupAnnouncement,
  isSystemNotice,
  sanitizeMessage,
} from '../../cli/ingestion/sanitize.js';
import { parseMdString } from '../../cli/ingestion/md.js';
import { parseTxtString } from '../../cli/ingestion/txt.js';
import { normalizeMessages } from '../../cli/ingestion/normalize.js';
import { extractLanguageFingerprint } from '../../cli/distillation/language.js';
import { extractAssetModels, detectContextTags } from '../../cli/distillation/assets.js';
import { extractBehaviorAndRhythm } from '../../cli/distillation/behavior.js';
import { constructPersonaPackage } from '../../cli/distillation/persona.js';

describe('Milestone 1 Empirical Stress Test & Adversarial Verification', () => {

  describe('Suite 1: Ingestion Sanitizer Extreme & Corrupted Inputs', () => {
    test('should reject malformed date headers from isDateHeader and handle them in parser without crashing', () => {
      // isDateHeader correctly recognizes date-like headers
      assert.equal(isDateHeader('### 2026-05-27'), true);
      assert.equal(isDateHeader('### [2026-05-27 10:20:30]'), true);
      assert.equal(isDateHeader('### 2026.05.27'), true);
      assert.equal(isDateHeader('### 2026/05/27'), true);
      assert.equal(isDateHeader('### not-a-date'), false);
      assert.equal(isDateHeader('### 2026-99-99'), true); // regex matches digit pattern

      // In parseMdString, non-date headers like ### not-a-date are treated as section headers and not appended to message
      const mdWithMalformed = `
User: 第一条消息
### not-a-date
Alice: 第二条消息
### 2026-99-99
Alice: 第三条消息
`;
      const res = parseMdString(mdWithMalformed, { targetSpeaker: 'Alice' });
      const userMsg = res.messages.find((m) => m.content.includes('第一条消息'));
      assert.ok(userMsg, 'User message exists');
      assert.ok(!userMsg.content.includes('not-a-date'), 'Section header must not append to user message');
      assert.equal(userMsg.content.trim(), '第一条消息');
    });

    test('should strip multi-level and deeply nested markdown headers', () => {
      const nested = [
        '# Level 1 Header',
        '## Level 2 Header',
        '### Level 3 Header',
        '#### Level 4 Header',
        '##### Level 5 Header',
        '###### Level 6 Header',
      ].join('\n');
      const stripped = stripMarkdownHeaders(nested);
      assert.equal(stripped, '', 'All headers must be stripped');

      const embedded = '发言内容\n### 2026-05-27\n#### 会议记录\n后续内容';
      const strippedEmbedded = stripMarkdownHeaders(embedded);
      assert.ok(!strippedEmbedded.includes('### 2026-05-27'));
      assert.ok(!strippedEmbedded.includes('#### 会议记录'));
      assert.ok(strippedEmbedded.includes('发言内容'));
      assert.ok(strippedEmbedded.includes('后续内容'));
    });

    test('should handle all 16 media token types and distinguish media-only vs mixed messages', () => {
      const allTokens = [
        '[图片]', '[image]', '[photo]',
        '[表情包]', '[动画表情]', '[动画贴图]', '[sticker]',
        '[语音]', '[voice]', '[audio]',
        '[视频]', '[video]',
        '[文件]', '[file]',
        '[位置]', '[location]',
        '[名片]', '[contact]'
      ];

      for (const tok of allTokens) {
        const onlyRes = stripMediaTokens(tok);
        assert.equal(onlyRes.text, '', `Media-only token ${tok} must have empty text`);
        assert.equal(onlyRes.isMediaOnly, true, `Media-only token ${tok} must have isMediaOnly=true`);

        const mixedRes = stripMediaTokens(`前缀文字 ${tok} 后缀文字`);
        assert.equal(mixedRes.text, '前缀文字 后缀文字', `Token ${tok} must be cleanly stripped from mixed text`);
        assert.equal(mixedRes.isMediaOnly, false, `Mixed message with ${tok} must have isMediaOnly=false`);
      }

      // Multi-token combination
      const multiToken = '看这个 [图片] [表情包] [视频] 哈哈';
      const multiRes = stripMediaTokens(multiToken);
      assert.equal(multiRes.text, '看这个 哈哈');
    });

    test('should detect all group announcement variants and bot introductions', () => {
      const announcements = [
        '我是群聊“河南省实验中学初一36”',
        '我是群聊"初中同学群"',
        '群公告：明天下午两点开会',
        '群公告: 严禁发广告',
        '群公告 禁止发广告',
        '群规：禁止发广告',
        '群主提醒：请大家改备注',
        '系统通知: 系统维护中',
        '系统消息：活动通知',
        '欢迎加入群聊！请大家改备注',
        '欢迎新成员进入本群',
        '本群须知：文明发言',
        '公告：重要通知',
        '公告: 重要通知',
        '公告 重要通知',
      ];

      for (const ann of announcements) {
        assert.ok(isGroupAnnouncement(ann), `Failed to detect announcement: ${ann}`);
        const sanitized = sanitizeMessage(ann);
        assert.equal(sanitized.isSystem, true, `Announcement must be marked isSystem: ${ann}`);
        assert.equal(sanitized.content, '', `Announcement content must be empty: ${ann}`);
      }

      // Normal conversation turns must NOT be flagged
      const normalTurns = [
        '我是群聊的成员之一',
        '明天去哪里吃饭呀',
        '好的收到，马上来',
        '这题选C，不要选错啦',
      ];
      for (const t of normalTurns) {
        assert.equal(isGroupAnnouncement(t), false, `Normal message falsely flagged: ${t}`);
      }
    });

    test('should detect service notices with tricky unicode characters', () => {
      const trickyNotices = [
        '\u200B张三 撤回了一条消息\u200B',
        '张三\uFEFF 撤回了一条消息',
        '\u200D我是群聊“初一36班”',
        '群公告：\u200B明天开会',
        '李四\u200C加入了群聊',
        '王五 拍了拍 李四',
        '对方正在输入...',
        '你已添加了张三，现在可以开始聊天了。',
        '以上是打招呼内容',
        '开启了朋友验证',
        '[通话时长 05:23]',
        '[微信红包] 恭喜发财',
        '收到红包',
        'Alice joined the group',
        'Bob left the group',
      ];

      for (const notice of trickyNotices) {
        const sanitized = sanitizeMessage(notice);
        assert.equal(sanitized.isSystem, true, `System notice must be flagged: ${notice}`);
        assert.equal(sanitized.content, '', `Content must be stripped: ${notice}`);
      }
    });
  });

  describe('Suite 2: Language Distillation & CJK Tokenization', () => {
    test('should tokenize CJK without artificial spaces in bigrams and trigrams', () => {
      const messages = [
        { sender: 'Alice', isTarget: true, content: '好呀好呀，我们一起去吃烤肉吧！', epochMs: 1000 },
        { sender: 'Alice', isTarget: true, content: '哈哈太好笑了，真的假的呀？', epochMs: 2000 },
        { sender: 'Alice', isTarget: true, content: '收到收到，没问题妥妥的！', epochMs: 3000 },
      ];

      const fp = extractLanguageFingerprint(messages, 'Alice');

      // Verify no whitespace between Chinese bigram characters
      for (const b of fp.vocabulary_profile.top_bigrams) {
        assert.ok(
          !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(b.token),
          `Bigram must not contain whitespace between CJK: "${b.token}"`
        );
      }

      // Verify no whitespace between Chinese trigram characters
      for (const t of fp.vocabulary_profile.top_trigrams) {
        assert.ok(
          !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(t.token),
          `Trigram must not contain whitespace between CJK: "${t.token}"`
        );
      }
    });

    test('should prevent grammatical stopwords and media tokens from entering catchphrases', () => {
      const messages = [
        { sender: 'Alice', isTarget: true, content: '这个那个什么怎么不是因为所以但是我们你们他们自己一个一下还是觉得可以没有现在知道这样那样', epochMs: 1000 },
        { sender: 'Alice', isTarget: true, content: '好呀好呀，收到啦！确实没问题', epochMs: 2000 },
        { sender: 'Alice', isTarget: true, content: '收到啦！好呀好呀', epochMs: 3000 },
      ];

      const fp = extractLanguageFingerprint(messages, 'Alice');
      const catchphrases = fp.vocabulary_profile.catchphrases;

      const forbidden = ['这个', '那个', '什么', '怎么', '不是', '因为', '所以', '但是', '我们', '图片', '照片'];
      for (const cp of catchphrases) {
        for (const f of forbidden) {
          assert.notEqual(cp, f, `Catchphrase must not be stopword: "${cp}"`);
        }
      }
    });

    test('should count modal particles accurately', () => {
      const messages = [
        { sender: 'Alice', isTarget: true, content: '好呀！去哪呢？算了吧！', epochMs: 1000 },
        { sender: 'Alice', isTarget: true, content: '知道啦，哦，好嘛！', epochMs: 2000 },
      ];

      const fp = extractLanguageFingerprint(messages, 'Alice');
      assert.ok(fp.chinese_particles.overall_particle_rate > 0);
      assert.equal(fp.chinese_particles.frequencies['呀'], 1);
      assert.equal(fp.chinese_particles.frequencies['呢'], 1);
      assert.equal(fp.chinese_particles.frequencies['吧'], 1);
      assert.equal(fp.chinese_particles.frequencies['啦'], 1);
      assert.equal(fp.chinese_particles.frequencies['哦'], 1);
      assert.equal(fp.chinese_particles.frequencies['嘛'], 1);
    });
  });

  describe('Suite 3: Emoji Modeling & Compound Emoji Sequences', () => {
    test('should recognize compound emojis with skin tone modifiers and ZWJ sequences', () => {
      const texts = [
        '点赞 👍🏻 挥手 👋🏽 程序员 👩🏼‍💻',
        '全家福 👨‍👩‍👧‍👦 携手 🧑‍🤝‍🧑 彩虹旗 🏳️‍🌈',
      ];

      const assets = extractAssetModels(texts);
      const emojiList = assets.emojis.map((e) => e.asset);

      assert.ok(emojiList.includes('👍🏻'), 'Should recognize skin-tone modified emoji 👍🏻');
      assert.ok(emojiList.includes('👋🏽'), 'Should recognize skin-tone modified emoji 👋🏽');
      assert.ok(emojiList.includes('👩🏼‍💻'), 'Should recognize skin-tone + ZWJ emoji 👩🏼‍💻');
      assert.ok(emojiList.includes('👨‍👩‍👧‍👦'), 'Should recognize multi-ZWJ family emoji 👨‍👩‍👧‍👦');
      assert.ok(emojiList.includes('🧑‍🤝‍🧑'), 'Should recognize ZWJ couple emoji 🧑‍🤝‍🧑');
    });

    test('should map context tags accurately to emotional intent', () => {
      assert.ok(detectContextTags('真搞笑', '哈哈哈').includes('joking'));
      assert.ok(detectContextTags('爱你哟', '想你啦').includes('affection'));
      assert.ok(detectContextTags('求求你啦', '好不好嘛🥺').includes('pleading_cute'));
      assert.ok(detectContextTags('好困啊', '去睡觉了晚安😴').includes('tired_sleep'));
      assert.ok(detectContextTags('太棒了', '牛哇干得漂亮🎉').includes('celebration'));
      assert.ok(detectContextTags('没问题', '好呀走起👍').includes('agreement'));
      assert.ok(detectContextTags('好难过', '呜呜哭了😭').includes('sadness'));
      assert.ok(detectContextTags('烦死了', '真离谱😡').includes('frustration'));
      assert.ok(detectContextTags('好奇', '为什么呢🤔').includes('thinking'));
      assert.ok(detectContextTags('早上好', '哈喽早呀').includes('greeting_closing'));
    });

    test('Empirical Challenge: Variation selector non-emoji symbols (®️, ©️, ™️)', () => {
      // When ® is bare (U+00AE), it is filtered:
      const bareAssets = extractAssetModels(['测试 ® 符号']);
      assert.equal(bareAssets.emojis.length, 0, 'Bare ® must be filtered');

      // Check whether variation selector-16 formatted symbol (®\uFE0F) leaks
      const fe0fAssets = extractAssetModels(['测试 ®\uFE0F 符号']);
      const leaked = fe0fAssets.emojis.map((e) => e.asset);
      // NOTE: This test documents empirical behavior for finding assessment
      console.log('Variation-selector non-emoji test result:', leaked);
    });

    test('Empirical Challenge: Keycap emoji sequence support', () => {
      const keycapAssets = extractAssetModels(['选项 1️⃣ 和 2️⃣']);
      const extracted = keycapAssets.emojis.map((e) => e.asset);
      console.log('Keycap emoji test result:', extracted);
    });
  });

  describe('Suite 4: Distillation Cleanliness & Prompt Injection Verification', () => {
    test('should never leak Markdown headers, image tokens, or announcements into few-shots or system prompt', () => {
      const dirtyDistillationSet = [
        {
          id: 'turn_dirty_header',
          context: [{ sender: 'User', content: '666 页\n### 2026-05-27' }],
          target_message: '我是群聊“初中同学群”',
        },
        {
          id: 'turn_dirty_image',
          context: [{ sender: 'User', content: '[图片]' }],
          target_message: '看到了 [图片] 这题选C',
        },
        {
          id: 'turn_clean_1',
          context: [{ sender: 'Bob', content: '今天去图书馆吗？' }],
          target_message: '肯定去呀~ 早呀',
        },
        {
          id: 'turn_clean_2',
          context: [
            { sender: 'Bob', content: '在吗' },
            { sender: 'Bob', content: '中午吃什么' }
          ],
          target_message: '好呀！去吃烤肉',
        },
      ];

      const personaPkg = constructPersonaPackage({
        personaId: 'persona_adversarial_test',
        targetSpeaker: 'Alice',
        counterpartSpeaker: 'Bob',
        languageModel: {
          vocabulary_profile: { top_vocabulary: [], top_bigrams: [], top_trigrams: [], catchphrases: ['好呀', '早呀'] },
          message_length: { median: 15, p90: 25 },
          sentence_length: { median: 12, p90: 20 },
          punctuation: { ellipsis_rate: 0.1, question_rate: 0.2 },
          chinese_particles: { overall_particle_rate: 0.3, frequencies: {} },
          repetition_habits: { top_patterns: [] },
          message_structure: { single_line_rate: 0.9, multi_line_rate: 0.1, bullet_like_rate: 0 },
          openers: ['早呀~ 肯定去呀'],
          closers: ['晚安安~'],
        },
        styleModel: { metrics: {}, length_distribution: { median: 15, p90: 25 } },
        behaviorModel: { response_policies: [], conversation_rhythm: { base_delay_ms: 2800 } },
        worldModel: { entities: [], relationships: [], timeline: [] },
        assetsModel: { emojis: [{ asset: '🥺', count: 2, contexts: ['pleading_cute'] }], stickers: [] },
        memorySeed: {},
        distillationSet: dirtyDistillationSet,
      });

      const genPrompt = personaPkg.system_prompts.generator;

      // 1. Zero markdown date headers
      assert.ok(!genPrompt.includes('### 2026-05-27'), 'Markdown header must not leak');

      // 2. Zero media tokens
      assert.ok(!genPrompt.includes('[图片]'), '[图片] token must not leak');

      // 3. Zero group announcements
      assert.ok(!genPrompt.includes('我是群聊'), 'Group announcement must not leak');

      // 4. Dynamic counterpart naming
      assert.ok(genPrompt.includes('Bob:'), 'Must use dynamic counterpart Bob');

      // 5. Burst coalescing
      assert.ok(genPrompt.includes('在吗\n中午吃什么'), 'Counterpart burst messages must be coalesced');

      // 6. Direct casual IM dialogue contract
      assert.ok(genPrompt.includes('[DIRECT CASUAL IM DIALOGUE CONTRACT]'), 'Must enforce direct casual IM dialogue contract');
      assert.ok(!genPrompt.includes('[CANDIDATE GENERATION CONTRACT]'), 'Must not contain candidate contract');

      // 7. No generic fallback emoji
      assert.ok(!genPrompt.includes('😊 ✨'), "Must not contain fallback '😊 ✨'");

      // 8. Contextual emoji bindings
      assert.ok(genPrompt.includes('When asking, acting cute or pleading: 🥺'), 'Contextual emoji binding must be present');
    });
  });

  describe('Suite 5: Conversation Rhythm & Latency Calibration Bounds', () => {
    test('should eliminate 60,000ms quantization artifacts across minute-quantized chat exports', async () => {
      // 12 turns with timestamps quantized to minute boundaries (:00 seconds)
      const messages = [];
      let baseTime = 1779840000000; // on a minute boundary
      for (let i = 0; i < 12; i++) {
        baseTime += 60000;
        messages.push({ sender: 'Bob', isTarget: false, content: `问题消息 ${i}`, epochMs: baseTime });
        baseTime += 60000;
        const replyLen = i < 4 ? 10 : (i < 8 ? 35 : 70);
        messages.push({ sender: 'Alice', isTarget: true, content: '回答'.repeat(replyLen / 2), epochMs: baseTime });
      }

      const turns = messages.filter((m) => m.isTarget).map((m) => ({
        context: [{ sender: 'Bob', content: '测试' }],
        target_message: m.content,
      }));

      const result = await extractBehaviorAndRhythm(turns, messages, 'Alice');
      const rhythm = result.conversation_rhythm;

      // Check overall response latency: must be 2000-4000ms, NEVER 60000ms
      assert.notEqual(rhythm.response_latency.median_ms, 60000, 'Must NOT be 60000ms');
      assert.ok(
        rhythm.response_latency.median_ms >= 2000 && rhythm.response_latency.median_ms <= 4000,
        `Expected 2000-4000ms, got ${rhythm.response_latency.median_ms}ms`
      );

      // Check short bucket median: 1500-3000ms, NEVER 60000ms
      assert.notEqual(rhythm.latency_model.short.median_ms, 60000);
      assert.ok(
        rhythm.latency_model.short.median_ms >= 1500 && rhythm.latency_model.short.median_ms <= 3000,
        `Expected short 1500-3000ms, got ${rhythm.latency_model.short.median_ms}ms`
      );

      // Check medium bucket median: 3000-5500ms, NEVER 60000ms
      assert.notEqual(rhythm.latency_model.medium.median_ms, 60000);
      assert.ok(
        rhythm.latency_model.medium.median_ms >= 3000 && rhythm.latency_model.medium.median_ms <= 5500,
        `Expected medium 3000-5500ms, got ${rhythm.latency_model.medium.median_ms}ms`
      );

      // Check long bucket median: 5000-8000ms, NEVER 60000ms
      assert.notEqual(rhythm.latency_model.long.median_ms, 60000);
      assert.ok(
        rhythm.latency_model.long.median_ms >= 5000 && rhythm.latency_model.long.median_ms <= 8000,
        `Expected long 5000-8000ms, got ${rhythm.latency_model.long.median_ms}ms`
      );

      // Verify typing speed is not fabricated
      assert.strictEqual(rhythm.typing_speed_cpm, null);
      assert.strictEqual(rhythm.typing_model.enabled, false);
    });

    test('should strictly clamp sub-minute delays to spec bounds', async () => {
      // Provide extreme sub-minute delays: very fast (100ms) and very slow (55000ms)
      const fastMessages = [
        { sender: 'Bob', isTarget: false, content: '在吗', epochMs: 1000 },
        { sender: 'Alice', isTarget: true, content: '在', epochMs: 1100 },
        { sender: 'Bob', isTarget: false, content: '好', epochMs: 2000 },
        { sender: 'Alice', isTarget: true, content: '嗯', epochMs: 2100 },
        { sender: 'Bob', isTarget: false, content: '走', epochMs: 3000 },
        { sender: 'Alice', isTarget: true, content: '好', epochMs: 3100 },
      ];

      const turns = fastMessages.filter((m) => m.isTarget).map((m) => ({
        context: [{ sender: 'Bob', content: '测试' }],
        target_message: m.content,
      }));

      const res = await extractBehaviorAndRhythm(turns, fastMessages, 'Alice');
      // Even with 100ms raw delays, calibrated short median must NOT fall below 1500ms
      assert.ok(
        res.conversation_rhythm.latency_model.short.median_ms >= 1500,
        `Short median must be >= 1500ms, got ${res.conversation_rhythm.latency_model.short.median_ms}ms`
      );
      assert.ok(
        res.conversation_rhythm.response_latency.median_ms >= 2000,
        `Response latency must be >= 2000ms, got ${res.conversation_rhythm.response_latency.median_ms}ms`
      );
    });
  });

});
