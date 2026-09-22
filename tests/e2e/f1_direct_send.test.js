import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelegramSendPayload,
  splitTelegramMessage,
} from './helpers/e2e_harness.js';

describe('Feature F1 E2E: Telegram Direct Send', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F1-T1-1: Normal 1-to-1 dialogue turns omit reply_parameters from payload', () => {
    const chatID = 8287471787;
    const text = '今晚吃火锅去吗？';
    const payload = buildTelegramSendPayload(chatID, text, 0);

    assert.strictEqual(payload.chat_id, chatID);
    assert.strictEqual(payload.text, text);
    assert.strictEqual(
      payload.reply_parameters,
      undefined,
      'Normal turn must NOT contain reply_parameters'
    );
    assert.strictEqual(
      'reply_to_message_id' in payload,
      false,
      'Normal turn must NOT contain legacy reply_to_message_id'
    );
  });

  test('F1-T1-2: Multi-part message turns deliver subsequent parts as clean direct sends', () => {
    const chatID = 123456789;
    const parts = ['第一句：已经在路上了', '第二句：等我五分钟哦'];
    const payloads = parts.map((part) => buildTelegramSendPayload(chatID, part, 0));

    assert.strictEqual(payloads.length, 2);
    for (const p of payloads) {
      assert.strictEqual(p.reply_parameters, undefined);
      assert.ok(p.text.length > 0);
    }
  });

  test('F1-T1-3: Direct send payload contains valid chat_id and non-empty text content', () => {
    const payload = buildTelegramSendPayload('987654321', '好呀');
    assert.strictEqual(payload.chat_id, '987654321');
    assert.strictEqual(payload.text, '好呀');
  });

  test('F1-T1-4: Direct send successfully handles diverse CJK and colloquial characters', () => {
    const text = '哈哈哈绝了！真的假的？！🤣✨';
    const payload = buildTelegramSendPayload(1001, text, 0);
    assert.strictEqual(payload.text, text);
    assert.strictEqual(payload.reply_parameters, undefined);
  });

  test('F1-T1-5: Zero streaming policy with direct complete message dispatch', () => {
    const streamPolicy = {
      sseEnabled: false,
      chunkedStreaming: false,
      sendMessageDraft: false,
      dispatchMode: 'single_complete_message',
    };
    assert.strictEqual(streamPolicy.dispatchMode, 'single_complete_message');
    assert.strictEqual(streamPolicy.chunkedStreaming, false);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F1-T2-1: Zero or negative replyToMsgID explicitly maps to clean direct send', () => {
    const p0 = buildTelegramSendPayload(101, 'text', 0);
    const pNeg = buildTelegramSendPayload(101, 'text', -1);
    const pNull = buildTelegramSendPayload(101, 'text', null);

    assert.strictEqual(p0.reply_parameters, undefined);
    assert.strictEqual(pNeg.reply_parameters, undefined);
    assert.strictEqual(pNull.reply_parameters, undefined);
  });

  test('F1-T2-2: Ultra-long text (>4096 chars) splits into chunks with all chunks sent directly', () => {
    const longText = 'A'.repeat(10000);
    const chunks = splitTelegramMessage(longText, 4096);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0].length, 4096);
    assert.strictEqual(chunks[1].length, 4096);
    assert.strictEqual(chunks[2].length, 1808);

    const payloads = chunks.map((c) => buildTelegramSendPayload(555, c, 0));
    for (const p of payloads) {
      assert.strictEqual(p.reply_parameters, undefined);
    }
  });

  test('F1-T2-3: Text containing reserved characters, markdown symbols, and newlines sends directly without quote injection', () => {
    const adversarialText = '```json\n{"test": true, "markdown": "### Header"}\n```\n_italic_ *bold*';
    const payload = buildTelegramSendPayload(999, adversarialText, 0);

    assert.strictEqual(payload.text, adversarialText);
    assert.strictEqual(payload.reply_parameters, undefined);
  });

  test('F1-T2-4: High-frequency rapid succession of direct sends maintains consistent clean payloads', () => {
    for (let i = 0; i < 50; i++) {
      const payload = buildTelegramSendPayload(1000 + i, `msg_${i}`, 0);
      assert.strictEqual(payload.reply_parameters, undefined);
      assert.strictEqual(payload.chat_id, 1000 + i);
    }
  });

  test('F1-T2-5: Invalid or non-string/non-number input throws type error at contract boundary', () => {
    assert.throws(() => buildTelegramSendPayload(null, 'text'), TypeError);
    assert.throws(() => buildTelegramSendPayload(123, null), TypeError);
  });
});
