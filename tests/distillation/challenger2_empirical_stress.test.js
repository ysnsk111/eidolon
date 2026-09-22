import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chunkAndSplit } from '../../cli/distillation/chunker.js';
import { extractAssetModels, detectContextTags } from '../../cli/distillation/assets.js';
import { extractBehaviorAndRhythm } from '../../cli/distillation/behavior.js';
import { extractLanguageFingerprint } from '../../cli/distillation/language.js';
import { constructPersonaPackage } from '../../cli/distillation/persona.js';
import { calculateSampleMetrics } from '../../cli/evaluation/metrics.js';
import { aggregateEvaluationResults } from '../../cli/evaluation/aggregate.js';
import { runEvaluation } from '../../cli/evaluation/runner.js';
import { runDistillationPipeline } from '../../cli/distillation/index.js';
import { parseTxtChat } from '../../cli/ingestion/txt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');

describe('Challenger 2 Empirical Stress Testing: Milestone 1', () => {
  // =========================================================================
  // 1. DATASET ISOLATION & CONTAMINATION STRESS TESTS
  // =========================================================================
  describe('Dataset Isolation & Contamination Stress', () => {
    test('Near-duplicate detection strictly respects 3-gram Jaccard threshold (> 0.90)', () => {
      // Create train, val, and test turns with controlled string similarities
      const trainTurn = {
        id: 'train_1',
        context: [{ sender: 'Bob', content: '今天去哪玩' }],
        target_message: '今天我们一起去图书馆自习刷数学题好不好呀',
      };

      // Near-duplicate: > 90% character 3-gram similarity
      const nearDupTurn = {
        id: 'test_near_dup',
        context: [{ sender: 'Bob', content: '今天去哪玩呢' }],
        target_message: '今天我们一起去图书馆自习刷数学题好不好呀！', // only trailing punctuation added
      };

      // Dissimilar turn: well below 90%
      const distinctTurn = {
        id: 'test_distinct',
        context: [{ sender: 'Bob', content: '中午吃什么' }],
        target_message: '我想吃二食堂的黑椒牛肉盖浇饭',
      };

      const rawSessions = [
        {
          id: 'session_train',
          messages: [
            { sender: 'Bob', content: '今天去哪玩', timestamp: '2026-03-01T10:00:00Z', isTarget: false },
            { sender: 'Alice', content: trainTurn.target_message, timestamp: '2026-03-01T10:00:10Z', isTarget: true },
          ],
        },
        {
          id: 'session_val',
          messages: [
            { sender: 'Bob', content: '走走走', timestamp: '2026-03-02T10:00:00Z', isTarget: false },
            { sender: 'Alice', content: '马上收拾好下来啦', timestamp: '2026-03-02T10:00:10Z', isTarget: true },
          ],
        },
        {
          id: 'session_test',
          messages: [
            { sender: 'Bob', content: '今天去哪玩呢', timestamp: '2026-03-03T10:00:00Z', isTarget: false },
            { sender: 'Alice', content: nearDupTurn.target_message, timestamp: '2026-03-03T10:00:10Z', isTarget: true },
            { sender: 'Bob', content: '中午吃什么', timestamp: '2026-03-03T12:00:00Z', isTarget: false },
            { sender: 'Alice', content: distinctTurn.target_message, timestamp: '2026-03-03T12:00:10Z', isTarget: true },
          ],
        },
      ];

      const split = chunkAndSplit({
        messages: rawSessions.flatMap((s) => s.messages),
        sessions: rawSessions,
        targetSpeaker: 'Alice',
      });

      // The near-duplicate must be purged from blind test set, but the distinct turn must remain!
      assert.strictEqual(split.blindTestSet.length, 1, 'Blind test set should retain exactly 1 uncontaminated turn');
      assert.strictEqual(split.blindTestSet[0].target_message, distinctTurn.target_message);
      assert.strictEqual(split.isolationAudit.train_test_duplicates, 1, 'Must record 1 near-duplicate detected and purged');
      assert.strictEqual(split.isolationAudit.passed, false, 'Audit must flag contamination event');
    });

    test('100% duplicate test set is completely purged with zero contaminated leak', () => {
      const rawSessions = [
        {
          id: 's1',
          messages: [
            { sender: 'Bob', content: 'A', timestamp: '2026-03-01T10:00:00Z', isTarget: false },
            { sender: 'Alice', content: 'Identical Turn', timestamp: '2026-03-01T10:00:10Z', isTarget: true },
          ],
        },
        {
          id: 's2',
          messages: [
            { sender: 'Bob', content: 'B', timestamp: '2026-03-02T10:00:00Z', isTarget: false },
            { sender: 'Alice', content: 'Val Turn', timestamp: '2026-03-02T10:00:10Z', isTarget: true },
          ],
        },
        {
          id: 's3',
          messages: [
            { sender: 'Bob', content: 'C', timestamp: '2026-03-03T10:00:00Z', isTarget: false },
            { sender: 'Alice', content: 'Identical Turn', timestamp: '2026-03-03T10:00:10Z', isTarget: true },
          ],
        },
      ];

      const split = chunkAndSplit({
        messages: rawSessions.flatMap((s) => s.messages),
        sessions: rawSessions,
        targetSpeaker: 'Alice',
      });

      assert.strictEqual(split.blindTestSet.length, 0, '100% duplicate test set must be reduced to 0 length');
      assert.strictEqual(split.isolationAudit.train_test_duplicates, 1);
    });

    test('Session boundary integrity: turns within the same session never cross splits', () => {
      const sessions = Array.from({ length: 10 }, (_, i) => ({
        id: `sess_${i + 1}`,
        messages: [
          { sender: 'User', content: `Hello ${i}`, timestamp: `2026-03-0${(i % 9) + 1}T10:00:00Z`, isTarget: false },
          { sender: 'Target', content: `Reply ${i}`, timestamp: `2026-03-0${(i % 9) + 1}T10:00:05Z`, isTarget: true },
        ],
      }));

      const split = chunkAndSplit({
        messages: sessions.flatMap((s) => s.messages),
        sessions,
        targetSpeaker: 'Target',
      });

      const trainSessionIds = new Set(split.distillationSet.map((t) => t.sessionId));
      const valSessionIds = new Set(split.validationSet.map((t) => t.sessionId));
      const testSessionIds = new Set(split.blindTestSet.map((t) => t.sessionId));

      // Assert complete pairwise disjointness of sessions
      for (const sId of trainSessionIds) {
        assert.ok(!valSessionIds.has(sId), `Train session ${sId} leaked into val`);
        assert.ok(!testSessionIds.has(sId), `Train session ${sId} leaked into test`);
      }
      for (const sId of valSessionIds) {
        assert.ok(!testSessionIds.has(sId), `Val session ${sId} leaked into test`);
      }
    });

    test('Fallback to sequential time block splitting when fewer than 3 sessions', () => {
      const messages = [
        { sender: 'Bob', content: '1', timestamp: '2026-03-01T10:00:00Z', isTarget: false },
        { sender: 'Alice', content: 'R1', timestamp: '2026-03-01T10:00:05Z', isTarget: true },
        { sender: 'Bob', content: '2', timestamp: '2026-03-01T10:01:00Z', isTarget: false },
        { sender: 'Alice', content: 'R2', timestamp: '2026-03-01T10:01:05Z', isTarget: true },
        { sender: 'Bob', content: '3', timestamp: '2026-03-01T10:02:00Z', isTarget: false },
        { sender: 'Alice', content: 'R3', timestamp: '2026-03-01T10:02:05Z', isTarget: true },
        { sender: 'Bob', content: '4', timestamp: '2026-03-01T10:03:00Z', isTarget: false },
        { sender: 'Alice', content: 'R4', timestamp: '2026-03-01T10:03:05Z', isTarget: true },
      ];

      // Only 1 session provided
      const split = chunkAndSplit({
        messages,
        sessions: [{ id: 'sess_single', messages }],
        targetSpeaker: 'Alice',
      });

      assert.ok(split.distillationSet.length > 0);
      assert.strictEqual(split.isolationAudit.speakerLeakage, 0);
      // Sequential check: distillation set comes before blind test set chronologically
      if (split.blindTestSet.length > 0) {
        const lastTrainTime = new Date(split.distillationSet[split.distillationSet.length - 1].timestamp).getTime();
        const firstTestTime = new Date(split.blindTestSet[0].timestamp).getTime();
        assert.ok(lastTrainTime <= firstTestTime, 'Sequential split must be chronologically ordered without interleaving');
      }
    });

    test('Gracefully handles edge case of zero target turns or single participant', () => {
      const messages = [
        { sender: 'Bob', content: 'Solitary msg 1', timestamp: '2026-03-01T10:00:00Z', isTarget: false },
        { sender: 'Bob', content: 'Solitary msg 2', timestamp: '2026-03-01T10:01:00Z', isTarget: false },
      ];

      const split = chunkAndSplit({
        messages,
        sessions: [{ id: 'sess_none', messages }],
        targetSpeaker: 'Alice',
      });

      assert.strictEqual(split.totalTurns, 0);
      assert.strictEqual(split.distillationSet.length, 0);
      assert.strictEqual(split.blindTestSet.length, 0);
      assert.ok(split.isolationAudit.passed);
    });
  });

  // =========================================================================
  // 2. DISTILLATION REPRODUCIBILITY (DETERMINISM)
  // =========================================================================
  describe('Distillation Reproducibility (Determinism)', () => {
    test('All extraction layers produce 100% deterministic outputs across identical runs', async () => {
      const sampleTxt = path.join(fixturesDir, 'chat_sample.txt');
      const normalized1 = parseTxtChat(sampleTxt);
      const normalized2 = parseTxtChat(sampleTxt);

      // Layer 1: Language Fingerprint
      const lang1 = extractLanguageFingerprint(normalized1.messages, 'Alice');
      const lang2 = extractLanguageFingerprint(normalized2.messages, 'Alice');
      assert.deepStrictEqual(lang1, lang2, 'extractLanguageFingerprint must be 100% deterministic');

      // Chunker & Split
      const split1 = chunkAndSplit(normalized1);
      const split2 = chunkAndSplit(normalized2);
      assert.deepStrictEqual(split1, split2, 'chunkAndSplit must be 100% deterministic');

      // Layer 5: Assets Model
      const targetTexts1 = normalized1.messages.filter((m) => m.isTarget).map((m) => m.content);
      const targetTexts2 = normalized2.messages.filter((m) => m.isTarget).map((m) => m.content);
      const assets1 = extractAssetModels(targetTexts1, split1.distillationSet);
      const assets2 = extractAssetModels(targetTexts2, split2.distillationSet);
      assert.deepStrictEqual(assets1, assets2, 'extractAssetModels must be 100% deterministic');

      // Layers 2, 3, 4: Behavior and Rhythm
      const behav1 = await extractBehaviorAndRhythm(split1.distillationSet, normalized1.messages, 'Alice');
      const behav2 = await extractBehaviorAndRhythm(split2.distillationSet, normalized2.messages, 'Alice');
      assert.deepStrictEqual(behav1, behav2, 'extractBehaviorAndRhythm must be 100% deterministic');

      // Persona Packaging
      const pkg1 = constructPersonaPackage({
        personaId: 'persona_repro_test',
        targetSpeaker: 'Alice',
        counterpartSpeaker: 'Bob',
        languageModel: lang1,
        styleModel: { favored_punctuations: ['~'], metrics: lang1.punctuation, length_distribution: lang1.message_length },
        behaviorModel: { response_policies: behav1.response_policies, conversation_rhythm: behav1.conversation_rhythm },
        worldModel: { entities: [], relationships: [], timeline: [] },
        assetsModel: assets1,
        memorySeed: {},
        distillationSet: split1.distillationSet,
      });

      const pkg2 = constructPersonaPackage({
        personaId: 'persona_repro_test',
        targetSpeaker: 'Alice',
        counterpartSpeaker: 'Bob',
        languageModel: lang2,
        styleModel: { favored_punctuations: ['~'], metrics: lang2.punctuation, length_distribution: lang2.message_length },
        behaviorModel: { response_policies: behav2.response_policies, conversation_rhythm: behav2.conversation_rhythm },
        worldModel: { entities: [], relationships: [], timeline: [] },
        assetsModel: assets2,
        memorySeed: {},
        distillationSet: split2.distillationSet,
      });

      // Verify system prompts are identical
      assert.strictEqual(pkg1.system_prompts.generator, pkg2.system_prompts.generator);
      assert.strictEqual(pkg1.system_prompts.critic, pkg2.system_prompts.critic);
      assert.strictEqual(pkg1.system_prompts.rewriter, pkg2.system_prompts.rewriter);
      assert.strictEqual(pkg1.system_prompts.judge, pkg2.system_prompts.judge);
    });
  });

  // =========================================================================
  // 3. ARRAY INDEX DESYNCHRONIZATION RESOLUTION IN ASSETS.JS
  // =========================================================================
  describe('Array Index Desync Resolution in assets.js', () => {
    test('Correct context binding when targetTexts.length >> turns.length', () => {
      // 100 target texts, but only 2 dialogue turns with context
      const targetTexts = Array.from({ length: 100 }, (_, i) => `闲聊消息 ${i}`);
      // Insert specific emotional messages
      targetTexts[0] = '帮帮我好不好嘛 🥺';
      targetTexts[95] = '好困啊先去睡了 😴';

      const turns = [
        {
          context: [{ content: '你能帮我一下吗求求了' }],
          target_message: '帮帮我好不好嘛 🥺',
        },
      ];

      const assets = extractAssetModels(targetTexts, turns);
      assert.ok(Array.isArray(assets.emojis));

      const pleading = assets.emojis.find((e) => e.asset === '🥺');
      assert.ok(pleading, 'Emoji 🥺 must be extracted');
      assert.ok(
        pleading.contexts.includes('pleading_cute'),
        `🥺 must include 'pleading_cute', got: ${JSON.stringify(pleading.contexts)}`
      );

      // Emoji at index 95 (beyond turns length) must still extract context from its text
      const sleep = assets.emojis.find((e) => e.asset === '😴');
      assert.ok(sleep, 'Emoji 😴 must be extracted');
      assert.ok(
        sleep.contexts.includes('tired_sleep'),
        `😴 must include 'tired_sleep' inferred from text, got: ${JSON.stringify(sleep.contexts)}`
      );
    });

    test('Correct context binding when turns.length >> targetTexts.length', () => {
      const targetTexts = ['笑死我了 😂'];

      const turns = Array.from({ length: 50 }, (_, i) => ({
        context: [{ content: `你看了那个视频吗 ${i}` }],
        target_message: i === 0 ? '笑死我了 😂' : `普通回复 ${i}`,
      }));

      const assets = extractAssetModels(targetTexts, turns);
      const laughing = assets.emojis.find((e) => e.asset === '😂');
      assert.ok(laughing, 'Emoji 😂 must be extracted');
      assert.ok(laughing.contexts.includes('joking'), `😂 must include 'joking', got: ${JSON.stringify(laughing.contexts)}`);
    });

    test('Calling extractAssetModels with turns array as first argument', () => {
      const turns = [
        {
          context: [{ content: '今晚通宵吗' }],
          target_message: '不行啦好困要睡了 😴',
        },
        {
          context: [{ content: '明天去吃大餐' }],
          target_message: '太棒了庆祝一下 🎉',
        },
      ];

      const assets = extractAssetModels(turns);
      assert.strictEqual(assets.emojis.length, 2);

      const sleep = assets.emojis.find((e) => e.asset === '😴');
      assert.ok(sleep.contexts.includes('tired_sleep'));

      const party = assets.emojis.find((e) => e.asset === '🎉');
      assert.ok(party.contexts.includes('celebration'));
    });

    test('Order mismatch / shuffled turns vs targetTexts does NOT misalign contexts', () => {
      const turns = [
        { context: [{ content: '真搞笑 233' }], target_message: '哈哈哈笑死 🤣' },
        { context: [{ content: '好难过想哭' }], target_message: '抱抱你别哭了 😭' },
      ];

      // Inverted order in targetTexts
      const targetTexts = [
        '抱抱你别哭了 😭',
        '哈哈哈笑死 🤣',
      ];

      const assets = extractAssetModels(targetTexts, turns);
      const laugh = assets.emojis.find((e) => e.asset === '🤣');
      const cry = assets.emojis.find((e) => e.asset === '😭');

      assert.ok(laugh.contexts.includes('joking'), `🤣 should have 'joking', got ${JSON.stringify(laugh.contexts)}`);
      assert.ok(cry.contexts.includes('sadness'), `😭 should have 'sadness', got ${JSON.stringify(cry.contexts)}`);
    });

    test('Compound emojis with ZWJ and skin tones are captured without fragmentation', () => {
      const texts = [
        '这是家庭 👨‍👩‍👧‍👦',
        '点赞 👍🏽',
        '彩虹旗 🏳️‍🌈',
      ];

      const assets = extractAssetModels(texts);
      const emojiList = assets.emojis.map((e) => e.asset);

      assert.ok(emojiList.includes('👨‍👩‍👧‍👦'), 'Family ZWJ sequence must be captured intact');
      assert.ok(emojiList.includes('👍🏽'), 'Skin tone modifier must be captured intact');
      assert.ok(emojiList.includes('🏳️‍🌈'), 'Rainbow flag ZWJ sequence must be captured intact');
    });

    test('Non-emoji symbols are strictly filtered and never extracted', () => {
      const texts = ['商标 ® 版权 © 商标 ™ 圈M Ⓜ 圈P 🅿 浪线 〰'];
      const assets = extractAssetModels(texts);
      assert.strictEqual(assets.emojis.length, 0, 'Non-emoji symbols must be 100% filtered out');
    });
  });

  // =========================================================================
  // 4. 60-SECOND RHYTHM QUANTIZATION ELIMINATION
  // =========================================================================
  describe('60-Second Rhythm Quantization Elimination', () => {
    test('Pure minute-quantized timestamps never produce 60,000ms latency artifacts', async () => {
      // Synthesize chat log where all timestamps are truncated to minute (:00 seconds)
      const baseEpoch = new Date('2026-03-01T10:00:00Z').getTime();
      const messages = [];

      for (let i = 0; i < 20; i++) {
        // Counterpart message at minute i
        messages.push({
          sender: 'Bob',
          content: `问你个问题 ${i}`,
          timestamp: new Date(baseEpoch + i * 2 * 60000).toISOString(),
          epochMs: baseEpoch + i * 2 * 60000,
          isTarget: false,
        });
        // Target replies at minute i + 1 (exactly 60,000ms later)
        messages.push({
          sender: 'Alice',
          content: i % 2 === 0 ? '短回复' : '这是一个长度比较长的中等回复内容呀',
          timestamp: new Date(baseEpoch + (i * 2 + 1) * 60000).toISOString(),
          epochMs: baseEpoch + (i * 2 + 1) * 60000,
          isTarget: true,
        });
      }

      const turns = [
        {
          context: [{ sender: 'Bob', content: '你好' }],
          target_message: '在呢',
        },
      ];

      const behavior = await extractBehaviorAndRhythm(turns, messages, 'Alice');
      const rhythm = behavior.conversation_rhythm;

      // SPECIFICATION CONTRACT ASSERTIONS:
      // 1. base_delay_ms must be strictly calibrated (2000 - 4000ms), NOT 60,000ms
      assert.ok(
        rhythm.base_delay_ms >= 2000 && rhythm.base_delay_ms <= 4000,
        `Expected base_delay_ms between 2000 and 4000, got ${rhythm.base_delay_ms}`
      );
      assert.notStrictEqual(rhythm.base_delay_ms, 60000, 'base_delay_ms must NEVER be 60,000ms');

      // 2. response_latency median must be 2000 - 4000ms
      assert.ok(
        rhythm.response_latency.median_ms >= 2000 && rhythm.response_latency.median_ms <= 4000,
        `Expected response_latency.median_ms between 2000 and 4000, got ${rhythm.response_latency.median_ms}`
      );

      // 3. latency_model bucket medians must follow calibrated IM bounds
      const latModel = rhythm.latency_model;
      if (latModel.short.median_ms !== null) {
        assert.ok(
          latModel.short.median_ms >= 1500 && latModel.short.median_ms <= 3000,
          `Expected short median between 1500 and 3000, got ${latModel.short.median_ms}`
        );
        assert.notStrictEqual(latModel.short.median_ms, 60000, 'short median must not be 60000');
      }

      if (latModel.medium.median_ms !== null) {
        assert.ok(
          latModel.medium.median_ms >= 3000 && latModel.medium.median_ms <= 5500,
          `Expected medium median between 3000 and 5500, got ${latModel.medium.median_ms}`
        );
        assert.notStrictEqual(latModel.medium.median_ms, 60000, 'medium median must not be 60000');
      }

      // 4. typing_speed_cpm must be null
      assert.strictEqual(rhythm.typing_speed_cpm, null);
      assert.strictEqual(rhythm.typing_model.enabled, false);
    });

    test('Mixed dataset filters 60,000ms quantization spikes while honoring authentic sub-minute delays', async () => {
      const baseEpoch = new Date('2026-03-01T10:00:00Z').getTime();
      const messages = [];

      // 10 authentic sub-minute turns (delay ~2500ms)
      for (let i = 0; i < 10; i++) {
        const t0 = baseEpoch + i * 20000;
        messages.push({
          sender: 'Bob',
          content: `短问题 ${i}`,
          timestamp: new Date(t0).toISOString(),
          epochMs: t0,
          isTarget: false,
        });
        messages.push({
          sender: 'Alice',
          content: '快速回复！',
          timestamp: new Date(t0 + 2500).toISOString(),
          epochMs: t0 + 2500,
          isTarget: true,
        });
      }

      // 3 artifact minute-quantized messages (60,000ms)
      for (let i = 0; i < 3; i++) {
        const t0 = baseEpoch + 300000 + i * 120000;
        messages.push({
          sender: 'Bob',
          content: `分钟问题 ${i}`,
          timestamp: new Date(t0).toISOString(),
          epochMs: t0,
          isTarget: false,
        });
        messages.push({
          sender: 'Alice',
          content: '分钟回复',
          timestamp: new Date(t0 + 60000).toISOString(),
          epochMs: t0 + 60000,
          isTarget: true,
        });
      }

      const turns = [{ context: [{ sender: 'Bob', content: '测试' }], target_message: '回复' }];
      const behavior = await extractBehaviorAndRhythm(turns, messages, 'Alice');
      const rhythm = behavior.conversation_rhythm;

      // Median should reflect the 2500ms authentic data, NOT 60,000ms
      assert.ok(
        rhythm.response_latency.median_ms >= 2000 && rhythm.response_latency.median_ms <= 3000,
        `Expected median ~2500ms, got ${rhythm.response_latency.median_ms}`
      );
    });
  });

  // =========================================================================
  // 5. DSI EVALUATION ENGINE AGAINST SYNTHETIC EDGE CASES
  // =========================================================================
  describe('DSI Evaluation Engine Against Synthetic Edge Cases', () => {
    test('Empty blind test set returns INSUFFICIENT_DATA with null DSI', async () => {
      const persona = {
        id: 'test_persona',
        target_speaker: 'Alice',
        system_prompts: { generator: 'Direct dialogue prompt' },
      };

      const result = await runEvaluation({
        persona,
        testDataset: [], // empty test set
        languageModel: {},
        styleModel: {},
        behaviorModel: {},
      });

      assert.strictEqual(result.status, 'INSUFFICIENT_DATA');
      assert.strictEqual(result.dsi, null);
      assert.strictEqual(result.dataset_size, 0);
      assert.strictEqual(result.gate_results.dsi_pass, false);
      assert.ok(result.error.includes('Blind test dataset is empty'));
    });

    test('Identity candidate produces top DSI scores and passes acceptance gate', () => {
      const sample = {
        id: 'sample_id_1',
        context: [{ sender: 'Bob', content: '今天去图书馆吗？' }],
        target_message: '早呀~ 肯定去呀，今天要在二楼自习室刷题呢',
      };

      const metrics = calculateSampleMetrics({
        originalTarget: sample.target_message,
        generatedCandidate: sample.target_message, // identical
        context: sample.context,
        languageModel: { vocabulary_profile: { top_vocabulary: [{ token: '早呀' }, { token: '自习室' }] } },
        styleModel: {},
        behaviorModel: {},
        worldModel: {},
      });

      assert.strictEqual(metrics.lexical, 1.0);
      assert.strictEqual(metrics.style, 1.0);
      assert.strictEqual(metrics.behavior, 1.0);
      assert.strictEqual(metrics.context, 1.0);
      assert.strictEqual(metrics.issues.length, 0);

      const report = aggregateEvaluationResults({
        sampleResults: [
          {
            sample_id: sample.id,
            context: sample.context,
            original_target: sample.target_message,
            generated_candidate: sample.target_message,
            metrics,
            judge: { score: 0.95 },
          },
        ],
        personaId: 'test_persona',
      });

      assert.ok(report.dsi >= 0.95, `Expected DSI >= 0.95, got ${report.dsi}`);
      assert.strictEqual(report.status, 'PASS');
      assert.strictEqual(report.gate_results.dsi_pass, true);
    });

    test('AI identity leak triggers catastrophic failure and drops behavior score to 0.05', () => {
      const sample = {
        id: 'sample_ai_leak',
        context: [{ sender: 'Bob', content: '你觉得这道题怎么样？' }],
        target_message: '哈哈笨蛋这题要先换元呀',
      };

      const aiLeakCandidate = '作为AI语言模型，我很抱歉听到这个问题，我无法替你做决定。';

      const metrics = calculateSampleMetrics({
        originalTarget: sample.target_message,
        generatedCandidate: aiLeakCandidate,
        context: sample.context,
        languageModel: {},
        styleModel: {},
        behaviorModel: {},
        worldModel: {},
      });

      assert.strictEqual(metrics.behavior, 0.05, 'AI identity leak must collapse behavior score to 0.05');
      assert.ok(metrics.issues.includes('CRITICAL: AI identity leak detected'));

      const report = aggregateEvaluationResults({
        sampleResults: [
          {
            sample_id: sample.id,
            context: sample.context,
            original_target: sample.target_message,
            generated_candidate: aiLeakCandidate,
            metrics,
            judge: { score: 0.10 },
          },
        ],
        personaId: 'test_persona',
      });

      assert.strictEqual(report.status, 'FAIL');
      assert.strictEqual(report.gate_results.behavior_pass, false);
      assert.strictEqual(report.gate_results.dsi_pass, false);
      assert.ok(report.dsi < 0.50);
    });

    test('Extreme input lengths and boundary conditions are numerically stable (no NaN)', () => {
      // 1. Empty strings
      const mEmpty = calculateSampleMetrics({
        originalTarget: '',
        generatedCandidate: '',
        context: [],
      });
      assert.ok(!Number.isNaN(mEmpty.lexical));
      assert.ok(!Number.isNaN(mEmpty.style));
      assert.ok(!Number.isNaN(mEmpty.behavior));

      // 2. Ultra-long candidate (10,000 characters)
      const longCand = '哈'.repeat(10000);
      const mLong = calculateSampleMetrics({
        originalTarget: '哈哈',
        generatedCandidate: longCand,
        context: [{ sender: 'Bob', content: '哈哈' }],
      });
      assert.ok(!Number.isNaN(mLong.lexical));
      assert.ok(!Number.isNaN(mLong.style));
      assert.ok(mLong.issues.some((i) => i.includes('too verbose')));

      // 3. Pure emoji comparison
      const mEmoji = calculateSampleMetrics({
        originalTarget: '🥺🥺🥺',
        generatedCandidate: '🥺🥺🥺',
        context: [],
      });
      assert.strictEqual(mEmoji.lexical, 1.0);
      assert.strictEqual(mEmoji.style, 1.0);

      // 4. Missing models (all null or undefined)
      const mNullModels = calculateSampleMetrics({
        originalTarget: '你好呀',
        generatedCandidate: '早呀',
        context: [{ sender: 'Bob', content: '在吗' }],
        languageModel: null,
        styleModel: null,
        behaviorModel: null,
        worldModel: null,
      });
      assert.ok(!Number.isNaN(mNullModels.lexical));
      assert.ok(!Number.isNaN(mNullModels.style));
      assert.ok(!Number.isNaN(mNullModels.behavior));
    });
  });

  // =========================================================================
  // 6. ZERO SYNTHETIC DEFAULTS & CLEAN DISTILLATION END-TO-END
  // =========================================================================
  describe('Zero Synthetic Defaults & Persona Cleanliness', () => {
    test('Constructed persona package has ZERO synthetic default emoji placeholders', () => {
      const fp = {
        sample_size: 10,
        vocabulary_profile: { catchphrases: ['好呀', '早呀'] },
        punctuation: { ellipsis_rate: 0.1, question_rate: 0.2 },
        message_length: { median: 15, p90: 25 },
        openers: ['早呀~'],
        closers: ['明天见！'],
      };

      // Case A: Persona with authentic emojis
      const pkgWithEmoji = constructPersonaPackage({
        personaId: 'pkg_emoji',
        targetSpeaker: 'Alice',
        counterpartSpeaker: 'Bob',
        languageModel: fp,
        styleModel: {},
        behaviorModel: { response_policies: [], conversation_rhythm: { base_delay_ms: 2800 } },
        worldModel: { entities: [], relationships: [], timeline: [] },
        assetsModel: { emojis: [{ asset: '🥺', count: 5, contexts: ['pleading_cute'] }], stickers: [] },
        memorySeed: {},
      });

      assert.ok(
        !pkgWithEmoji.system_prompts.generator.includes('😊 ✨'),
        "Generator prompt must NEVER contain '😊 ✨'"
      );
      assert.ok(
        pkgWithEmoji.system_prompts.generator.includes('When asking, acting cute or pleading: 🥺'),
        'Contextual binding must be formatted'
      );

      // Case B: Persona with ZERO emojis in training data
      const pkgZeroEmoji = constructPersonaPackage({
        personaId: 'pkg_zero_emoji',
        targetSpeaker: 'Alice',
        counterpartSpeaker: 'Bob',
        languageModel: fp,
        styleModel: {},
        behaviorModel: { response_policies: [], conversation_rhythm: { base_delay_ms: 2800 } },
        worldModel: { entities: [], relationships: [], timeline: [] },
        assetsModel: { emojis: [], stickers: [] }, // no emojis
        memorySeed: {},
      });

      assert.ok(
        !pkgZeroEmoji.system_prompts.generator.includes('😊 ✨'),
        "Generator prompt must NEVER fall back to '😊 ✨' even when zero emojis exist"
      );
      assert.ok(
        pkgZeroEmoji.system_prompts.generator.includes('Rarely or never uses emojis in casual text'),
        'Must explicitly instruct to rely on colloquial syntax instead of injecting fake emojis'
      );
    });

    test('End-to-end distillation on real chat export produces clean artifacts and validated DSI', async () => {
      const sampleTxt = path.join(fixturesDir, 'chat_sample.txt');
      const worldContext = path.join(fixturesDir, 'world_context.md');
      const testOutputDir = path.join(process.cwd(), 'completed_result');

      const result = await runDistillationPipeline({
        inputFile: sampleTxt,
        contextFile: worldContext,
        outputDir: testOutputDir,
        targetSpeaker: 'Alice',
      });

      assert.ok(result.personaId);
      assert.ok(result.exportResult);
      assert.ok(result.evaluationReport);

      const pkgDir = result.exportResult.packageDir;
      assert.ok(fs.existsSync(path.join(pkgDir, 'persona.json')));
      assert.ok(fs.existsSync(path.join(pkgDir, 'behavior.json')));
      assert.ok(fs.existsSync(path.join(pkgDir, 'manifest.json')));

      const personaJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'persona.json'), 'utf-8'));
      const behaviorJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'behavior.json'), 'utf-8'));

      // 1. Zero synthetic defaults in generator prompt
      const genPrompt = personaJson.system_prompts.generator;
      assert.ok(!genPrompt.includes('😊 ✨'), "Exported generator prompt must not contain '😊 ✨'");
      assert.ok(!genPrompt.includes('[CANDIDATE GENERATION CONTRACT]'), 'Must not have candidate JSON contract');
      assert.ok(genPrompt.includes('[DIRECT CASUAL IM DIALOGUE CONTRACT]'), 'Must have direct IM contract');

      // 2. Zero dirty artifacts in few-shot turns
      assert.ok(!genPrompt.includes('### 2026-'), 'Few-shot turns must not contain date headers');
      assert.ok(!genPrompt.includes('[图片]'), 'Few-shot turns must not contain image tokens');
      assert.ok(!genPrompt.includes('我是群聊'), 'Few-shot turns must not contain group announcements');

      // 3. Calibrated rhythm bounds
      const rhythm = behaviorJson.conversation_rhythm;
      assert.ok(
        rhythm.response_latency.median_ms >= 2000 && rhythm.response_latency.median_ms <= 4000,
        `Expected median delay 2000-4000ms, got ${rhythm.response_latency.median_ms}`
      );
      assert.notStrictEqual(rhythm.response_latency.median_ms, 60000, 'Median latency must not be 60000ms');

      // 4. Valid DSI score
      assert.ok(typeof result.evaluationReport.dsi === 'number');
      assert.ok(result.evaluationReport.dsi >= 0.70, `Expected DSI >= 0.70, got ${result.evaluationReport.dsi}`);
    });
  });
});
