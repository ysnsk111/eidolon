import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateQuoteReplyTarget,
  buildTelegramSendPayload,
} from './helpers/e2e_harness.js';

describe('Feature F3 E2E: Intelligent Contextual Quote-Replying', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F3-T1-1: Multi-question burst targeting first question sets targetMsgID to first question ID', () => {
    const burst = [
      { id: 101, text: '周六去哪吃烧烤？' },
      { id: 102, text: '下午几点集合？' },
    ];
    // Response specifically answers the restaurant location question
    const response = '吃那家木屋烧烤吧，味道不错！';
    const targetId = evaluateQuoteReplyTarget(burst, response);

    assert.strictEqual(targetId, 101, 'Should quote-reply specifically to the barbecue question');
  });

  test('F3-T1-2: Multi-question burst targeting second question sets targetMsgID to second question ID', () => {
    const burst = [
      { id: 201, text: '周六去哪吃烧烤？' },
      { id: 202, text: '下午几点集合？' },
    ];
    // Response specifically answers the time question
    const response = '大概下午三点集合吧';
    const targetId = evaluateQuoteReplyTarget(burst, response);

    assert.strictEqual(targetId, 202, 'Should quote-reply specifically to the time question');
  });

  test('F3-T1-3: Non-targeted general conversation in burst defaults to direct send (targetMsgID = 0)', () => {
    const burst = [
      { id: 301, text: '哈哈哈哈' },
      { id: 302, text: '太好笑了' },
    ];
    const response = '笑死我了确实';
    const targetId = evaluateQuoteReplyTarget(burst, response);

    assert.strictEqual(targetId, 0, 'General chat without specific target must direct send (0)');
  });

  test('F3-T1-4: Standard single message turn defaults to direct send (targetMsgID = 0)', () => {
    const singleMsgBurst = [{ id: 401, text: '在干嘛呢？' }];
    const response = '在看书呢';
    const targetId = evaluateQuoteReplyTarget(singleMsgBurst, response);

    assert.strictEqual(targetId, 0, '1-to-1 standard turn must be direct send (0)');
  });

  test('F3-T1-5: Targeted quote-reply payload injects reply_parameters with correct message_id', () => {
    const targetId = 502;
    const payload = buildTelegramSendPayload(777, '吃木屋烧烤', targetId);

    assert.ok(payload.reply_parameters);
    assert.strictEqual(payload.reply_parameters.message_id, 502);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F3-T2-1: Burst containing questions where response addresses both questions jointly defaults to direct send (0)', () => {
    const burst = [
      { id: 601, text: '明天几点去？' },
      { id: 602, text: '去西湖还是去灵隐寺？' },
    ];
    // Response answers both questions simultaneously
    const jointResponse = '明天上午九点去西湖散步';
    const targetId = evaluateQuoteReplyTarget(burst, jointResponse);

    assert.strictEqual(targetId, 0, 'Joint answer addressing multiple questions must default to direct send (0)');
  });

  test('F3-T2-2: Burst containing only statements (no questions) defaults to direct send (0)', () => {
    const burst = [
      { id: 701, text: '今天天气真好' },
      { id: 702, text: '阳光特别暖和' },
      { id: 703, text: '适合出去拍照' },
    ];
    const response = '对呀适合拍照';
    const targetId = evaluateQuoteReplyTarget(burst, response);

    assert.strictEqual(targetId, 0);
  });

  test('F3-T2-3: Burst containing mixed media placeholders and multiple questions correctly targets the textual question', () => {
    const burst = [
      { id: 801, text: '[图片] 这件衣服好看吗？' },
      { id: 802, text: '还有下午的电影看哪场？' },
    ];
    const response = '衣服挺好看的！版型不错';
    const targetId = evaluateQuoteReplyTarget(burst, response);

    assert.strictEqual(targetId, 801);
  });

  test('F3-T2-4: Multi-part response to targeted turn applies reply_parameters only to the first part', () => {
    const targetId = 901;
    const parts = ['第一句答案', '第二句补充说明'];

    const payloads = parts.map((part, index) => {
      const replyId = index === 0 ? targetId : 0;
      return buildTelegramSendPayload(1234, part, replyId);
    });

    assert.ok(payloads[0].reply_parameters);
    assert.strictEqual(payloads[0].reply_parameters.message_id, targetId);
    assert.strictEqual(payloads[1].reply_parameters, undefined, 'Subsequent parts must omit reply_parameters');
  });

  test('F3-T2-5: Empty or malformed burst array safely defaults to direct send (0)', () => {
    assert.strictEqual(evaluateQuoteReplyTarget([], 'response'), 0);
    assert.strictEqual(evaluateQuoteReplyTarget(null, 'response'), 0);
    assert.strictEqual(evaluateQuoteReplyTarget(undefined, 'response'), 0);
  });
});
