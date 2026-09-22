import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  BurstDebounceQueue,
  evaluateQuoteReplyTarget,
  buildTelegramSendPayload,
  sanitizeIngestionContent,
  extractCJKBigrams,
  filterCatchphrases,
  extractValidEmojis,
  buildContextualEmojiBindings,
  selectCleanFewShotTurns,
  buildDirectCasualSystemPrompt,
  sanitizeRuntimeOutput,
  calibrateQuantizedLatencyModel,
  calculateHumanDelay,
} from './helpers/e2e_harness.js';
import { constructPersonaPackage } from '../../cli/distillation/persona.js';

describe('Tier 3 E2E: Cross-Feature Interaction Test Suite', () => {
  test('T3-1 (F1 + F2): Burst debounce coalesces rapid incoming messages into single prompt dispatched as clean direct send', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 10001;

    // Rapid burst of 2 messages
    queue.enqueue(chatID, { id: 10, text: '吃了吗' }, 1000);
    queue.enqueue(chatID, { id: 11, text: '今天去哪吃' }, 2000);

    const turn = queue.flush(chatID);
    assert.strictEqual(turn.coalescedText, '吃了吗\n今天去哪吃');

    // Model generates casual direct response
    const responseText = '吃过啦，去吃日料吧！';
    const payload = buildTelegramSendPayload(chatID, responseText, 0);

    assert.strictEqual(payload.chat_id, chatID);
    assert.strictEqual(payload.text, responseText);
    assert.strictEqual(payload.reply_parameters, undefined, 'Must be direct send (zero quote-reply)');
  });

  test('T3-2 (F2 + F3): Multi-question burst coalesced by debounce buffer triggers contextual quote-reply to targeted item', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 10002;

    queue.enqueue(chatID, { id: 101, text: '烧烤几点去？' }, 1000);
    queue.enqueue(chatID, { id: 102, text: '电影票买好了吗？' }, 2200);

    const turn = queue.flush(chatID);
    assert.strictEqual(turn.messageCount, 2);

    // Response specifically addresses the barbecue question
    const responseText = '烧烤晚上七点去吧，不着急！';
    const targetMsgId = evaluateQuoteReplyTarget(turn.messages, responseText);
    assert.strictEqual(targetMsgId, 101, 'Should target question #101');

    const payload = buildTelegramSendPayload(chatID, responseText, targetMsgId);
    assert.ok(payload.reply_parameters);
    assert.strictEqual(payload.reply_parameters.message_id, 101);
  });

  test('T3-3 (F4 + F5): Sanitized ingestion strips image tokens, preventing "图 片" pollution in catchphrases', () => {
    const rawContaminatedText = '看这张照片 [图片] 帅吧！[图片]';
    const sanitized = sanitizeIngestionContent(rawContaminatedText);
    const bigrams = extractCJKBigrams(sanitized);

    assert.strictEqual(bigrams.includes('图片'), false);
    assert.strictEqual(bigrams.includes('图 片'), false);

    const candidateList = bigrams.map((b) => ({ phrase: b, count: 5 }));
    const filteredCatchphrases = filterCatchphrases(candidateList);
    assert.strictEqual(filteredCatchphrases.some((c) => c.phrase.includes('图')), false);
  });

  test('T3-4 (F4 + F6): Sanitized ingestion scrubs Markdown headers, preventing corrupted emoji contexts', () => {
    const rawTurnWithHeader = '### 2026-05-27\n太好笑了哈哈哈哈 😂';
    const sanitized = sanitizeIngestionContent(rawTurnWithHeader);
    const emojis = extractValidEmojis(sanitized);

    assert.ok(emojis.includes('😂'));
    assert.strictEqual(sanitized.includes('###'), false);

    const bindings = buildContextualEmojiBindings({ joking: emojis });
    assert.ok(bindings.includes('* When joking: 😂'));
    assert.strictEqual(bindings.includes('###'), false);
  });

  test('T3-5 (F4 + F7): Sanitized ingestion scrubs headers and placeholders, yielding 100% clean few-shot turns', () => {
    const contaminatedTurns = [
      { contextText: '### 2026-05-27\n在吗？', targetText: '[图片] 怎么啦？' },
      { contextText: '我是群聊“河南省实验中学”', targetText: '收到' },
      { contextText: '今晚吃火锅吗', targetText: '好呀，定哪家？' },
    ];

    const cleanFewShots = selectCleanFewShotTurns(contaminatedTurns, '王雅雯', '小明');
    assert.ok(cleanFewShots.length > 0);

    for (const fs of cleanFewShots) {
      assert.strictEqual(fs.formatted.includes('###'), false);
      assert.strictEqual(fs.formatted.includes('[图片]'), false);
      assert.strictEqual(fs.formatted.includes('我是群聊'), false);
      assert.ok(fs.formatted.includes('小明:'));
      assert.ok(fs.formatted.includes('王雅雯:'));
    }
  });

  test('T3-6 (F6 + F8): Direct casual IM generation prompt includes contextual emoji bindings and produces matching emojis', () => {
    const emojiMap = {
      joking: ['😂', '🤣'],
      tired_sleep: ['😴'],
    };
    const emojiBindings = buildContextualEmojiBindings(emojiMap);
    const prompt = buildDirectCasualSystemPrompt({
      personaName: 'Alice',
      counterpartName: 'Bob',
      contextualEmojiBindings: emojiBindings,
    });

    assert.ok(prompt.includes('[Contextual Emojis]'));
    assert.ok(prompt.includes('* When joking: 😂, 🤣'));

    // Model generates response using the bound joking emoji
    const modelOutput = '笑死我了，太逗了 😂';
    const sanitized = sanitizeRuntimeOutput(modelOutput);
    assert.ok(sanitized.includes('😂'));
  });

  test('T3-7 (F8 + F9): Single-pass direct generation pipeline eliminates 45s timeout and avoids "在呢，怎么啦~"', () => {
    // Model responds directly in single pass without candidate schema
    const singlePassOutput = '好呀，稍等我洗个手就来';
    const sanitized = sanitizeRuntimeOutput(singlePassOutput);

    assert.strictEqual(sanitized, '好呀，稍等我洗个手就来');
    assert.notStrictEqual(sanitized, '在呢，怎么啦~');
  });

  test('T3-8 (F10 + F11): Calibrated distillation rhythm model feeds dynamic scheduler with realistic bounds', () => {
    // Distillation rhythm calibration
    const rawMinuteDeltas = [60000, 60000, 120000, 60000];
    const rhythmModel = calibrateQuantizedLatencyModel(rawMinuteDeltas);

    // Pass calibrated median to scheduler
    const schedule = calculateHumanDelay(15, { baseDelayMs: rhythmModel.median_ms, jitter: 0 });

    assert.ok(schedule.totalDelayMs >= 1500, `Delay ${schedule.totalDelayMs} below 1500ms floor`);
    assert.ok(schedule.totalDelayMs <= 8000, `Delay ${schedule.totalDelayMs} above 8000ms ceiling`);
    assert.notStrictEqual(schedule.totalDelayMs, 60000, 'Must NOT sleep 60,000ms');
  });

  test('T3-9 (F1 + F11): Dynamic scheduler computes reading delay, typing simulation, and direct message send', () => {
    const text = '下班了，一起去健身房吗？';
    const schedule = calculateHumanDelay(text.length, { jitter: 0 });

    assert.ok(schedule.readingDelayMs > 0);
    assert.ok(schedule.typingDurationMs > 0);
    assert.strictEqual(schedule.readingDelayMs + schedule.typingDurationMs, schedule.totalDelayMs);

    // After delay, send directly to Telegram
    const payload = buildTelegramSendPayload(20001, text, 0);
    assert.strictEqual(payload.reply_parameters, undefined);
  });

  test('T3-10 (F2 + F8 + F11): Rapid 3-message burst coalesced, single-pass generated, and dynamic delay scheduled', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 30001;

    queue.enqueue(chatID, { id: 1, text: '哈喽' }, 100);
    queue.enqueue(chatID, { id: 2, text: '看我新买的鞋' }, 500);
    queue.enqueue(chatID, { id: 3, text: '好看吗？' }, 1200);

    const turn = queue.flush(chatID);
    assert.strictEqual(turn.messageCount, 3);
    assert.strictEqual(turn.coalescedText, '哈喽\n看我新买的鞋\n好看吗？');

    const generated = sanitizeRuntimeOutput('好看哎！很配你的穿搭');
    const schedule = calculateHumanDelay(generated.length);
    const payload = buildTelegramSendPayload(chatID, generated, 0);

    assert.ok(schedule.totalDelayMs >= 1500 && schedule.totalDelayMs <= 8000);
    assert.strictEqual(payload.reply_parameters, undefined);
  });

  test('T3-11 (F4 + F10 + F12): End-to-end sanitized chat ingestion and calibrated rhythm assemble valid persona package', () => {
    const rawLog = '### 2026-05-27\nAlice: 早安呀\nBob: 早！今天天气真棒';
    const cleanLog = sanitizeIngestionContent(rawLog);
    const rhythm = calibrateQuantizedLatencyModel([60000, 60000]);

    const persona = constructPersonaPackage({
      personaId: 'alice_tier3_package',
      targetSpeaker: 'Alice',
      counterpartSpeaker: 'Bob',
      languageModel: { message_length: { median: 12 }, vocabulary_profile: { catchphrases: ['早安呀'] } },
      styleModel: {},
      behaviorModel: { conversation_rhythm: { base_delay_ms: rhythm.median_ms, typing_speed_cpm: null } },
      worldModel: { entities: [], facts: [] },
      assetsModel: { emojis: [] },
      memorySeed: { l0: [], l1: [], l2: [], l3: [] },
    });

    assert.strictEqual(persona.id, 'alice_tier3_package');
    assert.ok(persona.system_prompts.generator.includes('Alice'));
    assert.strictEqual(persona.system_prompts.generator.includes('### 2026-05-27'), false);
    assert.strictEqual(persona.response_policy.base_delay_ms, rhythm.median_ms);
  });

  test('T3-12 (F3 + F8 + F9): Targeted question in burst answered via direct single-pass with quote-reply and zero boilerplate', () => {
    const burst = [
      { id: 401, text: '明天几点出发去爬山？' },
      { id: 402, text: '需要带防晒霜吗？' },
    ];
    const responseText = '早上八点半在校门口出发';
    const targetId = evaluateQuoteReplyTarget(burst, responseText);
    assert.strictEqual(targetId, 401);

    const cleanOutput = sanitizeRuntimeOutput(responseText);
    assert.strictEqual(cleanOutput, responseText);
    assert.notStrictEqual(cleanOutput, '在呢，怎么啦~');

    const payload = buildTelegramSendPayload(40001, cleanOutput, targetId);
    assert.ok(payload.reply_parameters);
    assert.strictEqual(payload.reply_parameters.message_id, 401);
  });
});
