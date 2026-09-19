import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMessages } from '../../cli/ingestion/normalize.js';

describe('Ingestion Session Segmentation Tests', () => {
  test('should segment messages into sessions by idle gap threshold', () => {
    const raw = [
      { sender: 'Alice', content: '早安！', timestamp: '2026-03-01T08:00:00Z' },
      { sender: 'Bob', content: '早呀，今天天气真好', timestamp: '2026-03-01T08:02:00Z' },
      // 2 hours gap -> should trigger new session
      { sender: 'Alice', content: '中午吃什么？', timestamp: '2026-03-01T11:30:00Z' },
      { sender: 'Bob', content: '吃火锅吧！', timestamp: '2026-03-01T11:31:00Z' },
    ];

    const result = normalizeMessages(raw, { idleGapMinutes: 25 });
    assert.strictEqual(result.sessions.length, 2, 'Should detect 2 distinct sessions');
    assert.strictEqual(result.sessions[0].messageCount, 2);
    assert.strictEqual(result.sessions[1].messageCount, 2);
  });
});
