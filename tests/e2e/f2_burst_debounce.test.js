import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BurstDebounceQueue } from './helpers/e2e_harness.js';

describe('Feature F2 E2E: Burst Message Debounce Buffer', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F2-T1-1: Coalesces 2 rapid messages sent within 3-4s window into a single turn separated by newline', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 1001;

    queue.enqueue(chatID, { id: 1, text: '在吗' }, 1000);
    queue.enqueue(chatID, { id: 2, text: '有个紧急事情问你' }, 2500); // 1.5s later

    assert.strictEqual(queue.shouldFlush(chatID, 3000), false, 'Should not flush yet before debounce window');
    assert.strictEqual(queue.shouldFlush(chatID, 6100), true, 'Should flush after 3.5s of silence');

    const flushed = queue.flush(chatID);
    assert.ok(flushed);
    assert.strictEqual(flushed.coalescedText, '在吗\n有个紧急事情问你');
    assert.strictEqual(flushed.messageCount, 2);
    assert.strictEqual(flushed.firstMessageId, 1);
    assert.strictEqual(flushed.lastMessageId, 2);
  });

  test('F2-T1-2: Coalesces 3 rapid short messages into one single turn context', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 2002;

    queue.enqueue(chatID, { id: 10, text: '嗨' }, 1000);
    queue.enqueue(chatID, { id: 11, text: '王雅雯' }, 2000);
    queue.enqueue(chatID, { id: 12, text: '周六去爬山吗？' }, 3200);

    const flushed = queue.flush(chatID);
    assert.strictEqual(flushed.coalescedText, '嗨\n王雅雯\n周六去爬山吗？');
    assert.strictEqual(flushed.messageCount, 3);
  });

  test('F2-T1-3: Standalone message after window expiry flushes as independent single turn', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 3003;

    queue.enqueue(chatID, { id: 100, text: '早上好呀' }, 1000);
    assert.strictEqual(queue.shouldFlush(chatID, 5000), true);

    const turn1 = queue.flush(chatID);
    assert.strictEqual(turn1.coalescedText, '早上好呀');
    assert.strictEqual(turn1.messageCount, 1);

    // Later message
    queue.enqueue(chatID, { id: 101, text: '吃早饭了吗' }, 10000);
    const turn2 = queue.flush(chatID);
    assert.strictEqual(turn2.coalescedText, '吃早饭了吗');
    assert.strictEqual(turn2.messageCount, 1);
  });

  test('F2-T1-4: Chat session isolation: rapid messages in chat A do not merge into chat B', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });

    queue.enqueue(100, { id: 1, text: 'chat 100 message 1' }, 1000);
    queue.enqueue(200, { id: 2, text: 'chat 200 message 1' }, 1100);
    queue.enqueue(100, { id: 3, text: 'chat 100 message 2' }, 1500);

    const flush100 = queue.flush(100);
    const flush200 = queue.flush(200);

    assert.strictEqual(flush100.coalescedText, 'chat 100 message 1\nchat 100 message 2');
    assert.strictEqual(flush200.coalescedText, 'chat 200 message 1');
  });

  test('F2-T1-5: Emits turn event upon flush containing full burst metadata', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    let emittedEvent = null;

    queue.on('turn', (evt) => {
      emittedEvent = evt;
    });

    queue.enqueue(999, { id: 50, text: '收到请回复' }, 1000);
    queue.flush(999);

    assert.ok(emittedEvent);
    assert.strictEqual(emittedEvent.chatID, 999);
    assert.strictEqual(emittedEvent.coalescedText, '收到请回复');
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F2-T2-1: Trailing whitespace and empty messages in burst are pruned cleanly', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    queue.enqueue(501, { id: 1, text: '   ' }, 1000);
    queue.enqueue(501, { id: 2, text: '有效消息' }, 1500);
    queue.enqueue(501, { id: 3, text: '' }, 2000);

    const flushed = queue.flush(501);
    assert.strictEqual(flushed.coalescedText, '有效消息');
    assert.strictEqual(flushed.messageCount, 1);
  });

  test('F2-T2-2: New message arriving at 2.5s extends the debounce window and postpones flush', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 502;

    queue.enqueue(chatID, { id: 1, text: '第一条' }, 1000);
    // At 3000ms (idle 2000ms < 3500ms): not flushed
    assert.strictEqual(queue.shouldFlush(chatID, 3000), false);

    // Second message arrives at 3500ms
    queue.enqueue(chatID, { id: 2, text: '第二条' }, 3500);

    // At 5000ms: idle is only 1500ms since last arrival!
    assert.strictEqual(queue.shouldFlush(chatID, 5000), false);

    // At 7100ms: idle is 3600ms >= 3500ms!
    assert.strictEqual(queue.shouldFlush(chatID, 7100), true);
  });

  test('F2-T2-3: Starvation prevention: continuous rapid streaming reaches maxWaitMs ceiling and forces flush', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500, maxWaitMs: 10000 });
    const chatID = 503;

    // Stream a message every 2 seconds for 12 seconds
    for (let t = 0; t <= 10000; t += 2000) {
      queue.enqueue(chatID, { id: t, text: `ping_${t}` }, t);
    }

    // At 10500ms: total wait is 10500ms >= 10000ms ceiling even if idle is only 500ms!
    assert.strictEqual(queue.shouldFlush(chatID, 10500), true);
    const flushed = queue.flush(chatID);
    assert.ok(flushed);
    assert.strictEqual(flushed.messageCount, 6);
  });

  test('F2-T2-4: Single-character bursts ("好", "的", "！") coalesce accurately', () => {
    const queue = new BurstDebounceQueue({ debounceWindowMs: 3500 });
    const chatID = 504;

    queue.enqueue(chatID, { id: 1, text: '好' }, 100);
    queue.enqueue(chatID, { id: 2, text: '的' }, 300);
    queue.enqueue(chatID, { id: 3, text: '！' }, 600);

    const flushed = queue.flush(chatID);
    assert.strictEqual(flushed.coalescedText, '好\n的\n！');
    assert.strictEqual(flushed.messageCount, 3);
  });

  test('F2-T2-5: Flushing an empty or non-existent session returns null without error', () => {
    const queue = new BurstDebounceQueue();
    assert.strictEqual(queue.flush(9999999), null);
    assert.strictEqual(queue.shouldFlush(9999999, 1000), false);
  });
});
