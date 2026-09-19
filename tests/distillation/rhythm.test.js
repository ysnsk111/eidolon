import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractBehaviorAndRhythm } from '../../cli/distillation/behavior.js';

describe('Conversation Rhythm & Latency Model Tests', () => {
  test('should compute observed response latency without fabricating typing speed', async () => {
    const messages = [
      { sender: 'Bob', isTarget: false, content: '你好', epochMs: 1000 },
      { sender: 'Alice', isTarget: true, content: '你好呀~', epochMs: 4000 },
      { sender: 'Bob', isTarget: false, content: '在干嘛呢', epochMs: 10000 },
      { sender: 'Alice', isTarget: true, content: '在看书呢', epochMs: 13500 },
    ];

    const turns = [
      { context: [{ sender: 'Bob', content: '你好' }], target_message: '你好呀~' },
      { context: [{ sender: 'Bob', content: '在干嘛呢' }], target_message: '在看书呢' },
    ];

    const result = await extractBehaviorAndRhythm(turns, messages, 'Alice');

    // Section 13 & 31 DoD: Never fabricate 180 CPM
    assert.strictEqual(result.conversation_rhythm.typing_speed_cpm, null);
    assert.strictEqual(result.conversation_rhythm.typing_model.enabled, false);
    assert.ok(result.conversation_rhythm.response_latency);
    assert.ok(result.conversation_rhythm.latency_model);
    assert.ok(result.conversation_rhythm.double_message_probability > 0);
  });
});
