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

describe('Tier 4 E2E: Real-World Application Workload Scenarios', () => {
  // -------------------------------------------------------------------------
  // Scenario 1: Rapid 3-Message Burst Greeting (F1, F2, F8, F11)
  // -------------------------------------------------------------------------
  test('Scenario 1: Rapid 3-Message Burst Greeting coalesced, single-pass generated, and direct sent', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 9001;

    // User sends 3 rapid short messages within 2 seconds
    queue.enqueue(chatID, { id: 101, text: '在吗' }, 1000);
    queue.enqueue(chatID, { id: 102, text: '问你个事' }, 1800);
    queue.enqueue(chatID, { id: 103, text: '周日去不去西湖散步？' }, 2600);

    // After debounce window (3500ms after last arrival at 2600ms = 6100ms)
    assert.strictEqual(queue.shouldFlush(chatID, 5000), false);
    assert.strictEqual(queue.shouldFlush(chatID, 6200), true);

    const turn = queue.flush(chatID);
    assert.strictEqual(turn.messageCount, 3);
    assert.strictEqual(turn.coalescedText, '在吗\n问你个事\n周日去不去西湖散步？');

    // Single-pass direct casual generation
    const rawGenerated = '在的！可以呀，这周日天气正合适';
    const finalResponse = sanitizeRuntimeOutput(rawGenerated);
    assert.notStrictEqual(finalResponse, '在呢，怎么啦~');

    // Calibrated dynamic response scheduler
    const schedule = calculateHumanDelay(finalResponse.length, { jitter: 0 });
    assert.ok(schedule.totalDelayMs >= 1500 && schedule.totalDelayMs <= 8000);
    assert.ok(schedule.readingDelayMs > 0);
    assert.ok(schedule.typingDurationMs > 0);

    // Direct Telegram dispatch
    const payload = buildTelegramSendPayload(chatID, finalResponse, 0);
    assert.strictEqual(payload.chat_id, chatID);
    assert.strictEqual(payload.text, finalResponse);
    assert.strictEqual(payload.reply_parameters, undefined, 'Must be direct send');
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Multi-Question Burst with Contextual Quote-Reply (F1, F2, F3, F8)
  // -------------------------------------------------------------------------
  test('Scenario 2: Multi-Question Burst with Contextual Quote-Reply targeting specific item', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 9002;

    // User sends two questions in rapid succession
    queue.enqueue(chatID, { id: 201, text: '明天几点去羽毛球馆？' }, 100);
    queue.enqueue(chatID, { id: 202, text: '还有谁一起去打球？' }, 900);

    const turn = queue.flush(chatID);
    assert.strictEqual(turn.messageCount, 2);

    // Model specifically addresses the time question
    const responseText = '羽毛球馆下午两点见，记得带拍子！';
    const targetMsgId = evaluateQuoteReplyTarget(turn.messages, responseText);
    assert.strictEqual(targetMsgId, 201, 'Must specifically quote-reply to question #201');

    // Build quote-reply payload
    const payload = buildTelegramSendPayload(chatID, responseText, targetMsgId);
    assert.ok(payload.reply_parameters);
    assert.strictEqual(payload.reply_parameters.message_id, 201);
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Contaminated Raw Chat Log Ingestion to Distilled Persona (F4, F5, F6, F7, F10)
  // -------------------------------------------------------------------------
  test('Scenario 3: Contaminated Raw Chat Log Ingestion purges noise and creates clean persona', () => {
    const rawContaminatedLog = `
### 2026-05-27
我是群聊“河南省实验中学初一36”
Alice: 666 页
Bob: [图片] 看看这个
Alice: 我就直说了，直接问了 😂
2026-05-27 10:05:00 [INFO] System heartbeat
### 2026-05-28
Bob: 晚上早点睡呀
Alice: 好滴，晚安 😴
`;

    // 1. Ingestion Sanitization (F4)
    const sanitizedLog = sanitizeIngestionContent(rawContaminatedLog);
    assert.strictEqual(sanitizedLog.includes('### 2026-05-27'), false);
    assert.strictEqual(sanitizedLog.includes('[图片]'), false);
    assert.strictEqual(sanitizedLog.includes('我是群聊'), false);
    assert.strictEqual(sanitizedLog.includes('[INFO]'), false);

    // 2. Language & Catchphrase Extraction (F5)
    const bigrams = extractCJKBigrams(sanitizedLog);
    assert.strictEqual(bigrams.includes('图片'), false);
    assert.strictEqual(bigrams.includes('图 片'), false);

    // 3. Emoji Contextual Modeling (F6)
    const emojis = extractValidEmojis(sanitizedLog);
    assert.ok(emojis.includes('😂'));
    assert.ok(emojis.includes('😴'));
    const emojiBindings = buildContextualEmojiBindings({ joking: ['😂'], tired_sleep: ['😴'] });
    assert.strictEqual(emojiBindings.includes('😊 ✨'), false);

    // 4. Few-Shot Turn Selection (F7)
    const rawTurns = [
      { contextText: '666 页\n### 2026-05-27', targetText: '[图片] 我就直说了 😂' },
      { contextText: '晚上早点睡呀', targetText: '好滴，晚安 😴' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'Alice', 'Bob');
    for (const fs of fewShots) {
      assert.strictEqual(fs.formatted.includes('###'), false);
      assert.strictEqual(fs.formatted.includes('[图片]'), false);
    }

    // 5. Rhythm Latency Calibration (F10)
    const quantizedDeltas = [60000, 60000, 120000];
    const calibratedRhythm = calibrateQuantizedLatencyModel(quantizedDeltas);
    assert.ok(calibratedRhythm.median_ms >= 1500 && calibratedRhythm.median_ms <= 8000);

    // 6. Persona Assembly
    const persona = constructPersonaPackage({
      personaId: 'alice_scenario3',
      targetSpeaker: 'Alice',
      counterpartSpeaker: 'Bob',
      languageModel: { message_length: { median: 15 }, vocabulary_profile: { catchphrases: ['我就直说了'] } },
      styleModel: {},
      behaviorModel: { conversation_rhythm: { base_delay_ms: calibratedRhythm.median_ms, typing_speed_cpm: null } },
      worldModel: { entities: [], facts: [] },
      assetsModel: { emojis: [{ asset: '😂' }, { asset: '😴' }] },
      memorySeed: { l0: [], l1: [], l2: [], l3: [] },
    });

    assert.strictEqual(persona.id, 'alice_scenario3');
    assert.strictEqual(persona.system_prompts.generator.includes('我是群聊'), false);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Direct Single-Pass Dialogue with Emotional Contextual Emoji (F6, F8, F9, F11)
  // -------------------------------------------------------------------------
  test('Scenario 4: Direct Single-Pass Dialogue with Emotional Contextual Emoji and Calibrated Delay', () => {
    const emojiMap = {
      joking: ['😂', '🤣'],
      pleading_cute: ['🥺'],
    };
    const emojiBindings = buildContextualEmojiBindings(emojiMap);
    const systemPrompt = buildDirectCasualSystemPrompt({
      personaName: '王雅雯',
      counterpartName: '李雷',
      contextualEmojiBindings: emojiBindings,
    });

    assert.ok(systemPrompt.includes('[DIRECT CASUAL IM DIALOGUE CONTRACT]'));
    assert.ok(systemPrompt.includes('* When joking: 😂, 🤣'));

    // Emulate single-pass direct generation
    const rawGenerated = '笑死我了，你怎么这么损啊 😂';
    const finalClean = sanitizeRuntimeOutput(rawGenerated);

    assert.strictEqual(finalClean, '笑死我了，你怎么这么损啊 😂');
    assert.notStrictEqual(finalClean, '在呢，怎么啦~');

    // Dynamic latency
    const schedule = calculateHumanDelay(finalClean.length);
    assert.ok(schedule.totalDelayMs >= 1500 && schedule.totalDelayMs <= 8000);
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Minute-Quantized Timestamp Rhythm to Calibrated Telegram Delay (F10, F11)
  // -------------------------------------------------------------------------
  test('Scenario 5: Minute-Quantized Timestamp Rhythm to Calibrated Telegram Delay', () => {
    // Minute-quantized chat history (e.g. all seconds :00)
    const exportDeltas = [60000, 60000, 60000, 120000, 60000];
    const calibratedModel = calibrateQuantizedLatencyModel(exportDeltas);

    assert.strictEqual(calibratedModel.quantization_detected, true);
    assert.ok(calibratedModel.median_ms >= 1500 && calibratedModel.median_ms <= 5000);

    // Pass calibrated median to scheduler for a 20-char message
    const schedule = calculateHumanDelay(20, { baseDelayMs: calibratedModel.median_ms, jitter: 0 });

    assert.ok(schedule.totalDelayMs < 8000, 'Must never sleep 60,000ms');
    assert.ok(schedule.totalDelayMs >= 1500, 'Must satisfy minimum human IM floor');
    assert.ok(schedule.readingDelayMs > 0);
    assert.ok(schedule.typingDurationMs > 0);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: End-to-End Persona Distillation & Live Chat Turn Simulation (F1, F2, F4, F6, F8, F10, F11)
  // -------------------------------------------------------------------------
  test('Scenario 6: End-to-End Persona Distillation & Live Chat Turn Simulation', () => {
    // 1. Raw Ingestion with Noise
    const rawHistory = '### 2026-05-27\nBob: 晚饭吃什么？\nAlice: 去吃日料吧[图片]\nBob: 行，几点？\nAlice: 七点！';
    const cleanedHistory = sanitizeIngestionContent(rawHistory);
    assert.strictEqual(cleanedHistory.includes('###'), false);
    assert.strictEqual(cleanedHistory.includes('[图片]'), false);

    // 2. Rhythm Calibration
    const rhythm = calibrateQuantizedLatencyModel([60000, 60000]);

    // 3. Assemble Persona Package
    const persona = constructPersonaPackage({
      personaId: 'alice_live_simulation',
      targetSpeaker: 'Alice',
      counterpartSpeaker: 'Bob',
      languageModel: { message_length: { median: 10 } },
      styleModel: {},
      behaviorModel: { conversation_rhythm: { base_delay_ms: rhythm.median_ms, typing_speed_cpm: null } },
      worldModel: { entities: [], facts: [] },
      assetsModel: { emojis: [] },
      memorySeed: { l0: [], l1: [], l2: [], l3: [] },
    });
    assert.ok(persona.system_prompts.generator);

    // 4. Live Incoming Burst in Telegram Bot
    const botQueue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 88888;
    botQueue.enqueue(chatID, { id: 501, text: '我到店门口了' }, 100);
    botQueue.enqueue(chatID, { id: 502, text: '你到了吗？' }, 800);

    const burstTurn = botQueue.flush(chatID);
    assert.strictEqual(burstTurn.coalescedText, '我到店门口了\n你到了吗？');

    // 5. Single-Pass Direct Generation
    const directResponse = sanitizeRuntimeOutput('刚停好车，马上进门！');
    assert.notStrictEqual(directResponse, '在呢，怎么啦~');

    // 6. Dynamic Scheduler
    const schedule = calculateHumanDelay(directResponse.length, { baseDelayMs: rhythm.median_ms });
    assert.ok(schedule.totalDelayMs >= 1500 && schedule.totalDelayMs <= 8000);

    // 7. Telegram Direct Send Dispatch
    const payload = buildTelegramSendPayload(chatID, directResponse, 0);
    assert.strictEqual(payload.chat_id, chatID);
    assert.strictEqual(payload.text, directResponse);
    assert.strictEqual(payload.reply_parameters, undefined);
  });
});
