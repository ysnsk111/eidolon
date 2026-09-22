import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeIngestionContent } from './helpers/e2e_harness.js';

describe('Feature F4 E2E: Ingestion Sanitizer', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F4-T1-1: Strips Markdown date headers (### 2026-05-27) without corrupting message flow', () => {
    const raw = 'User: 666 页\n\n\n### 2026-05-27\n王雅雯: 我就直说了';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized.includes('### 2026-05-27'), false);
    assert.ok(sanitized.includes('User: 666 页'));
    assert.ok(sanitized.includes('王雅雯: 我就直说了'));
  });

  test('F4-T1-2: Strips image placeholders ([图片], [image], [photo]) from raw chat texts', () => {
    const inputs = [
      '发了张照片 [图片]',
      'Check this [image] please',
      '风景照 [photo] 绝了',
    ];

    for (const raw of inputs) {
      const sanitized = sanitizeIngestionContent(raw);
      assert.strictEqual(sanitized.includes('[图片]'), false);
      assert.strictEqual(sanitized.includes('[image]'), false);
      assert.strictEqual(sanitized.includes('[photo]'), false);
    }
  });

  test('F4-T1-3: Strips group announcements (我是群聊..., 欢迎加入本群)', () => {
    const raw = '我是群聊“河南省实验中学初一36”\n欢迎“张三”加入本群\n大家早上好';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized.includes('我是群聊'), false);
    assert.strictEqual(sanitized.includes('欢迎'), false);
    assert.strictEqual(sanitized, '大家早上好');
  });

  test('F4-T1-4: Strips system logs and timestamps ([INFO], [WARN], [ERROR])', () => {
    const raw = '2026-05-27 10:00:00 [INFO] User joined session\n你好呀！\n2026-05-27 10:00:05 [DEBUG] Synced state';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized.includes('[INFO]'), false);
    assert.strictEqual(sanitized.includes('[DEBUG]'), false);
    assert.strictEqual(sanitized, '你好呀！');
  });

  test('F4-T1-5: Preserves legitimate colloquial text and authentic punctuation intact', () => {
    const raw = '哈哈哈哈！真的假的？！今晚必须去吃海底捞~😋';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized, raw);
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F4-T2-1: Markdown header at start of line 1 stripped without creating empty message', () => {
    const raw = '### 2026-05-27\n第一条正常对话';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized, '第一条正常对话');
  });

  test('F4-T2-2: Consecutive Markdown headers stripped without leaving residual blank lines', () => {
    const raw = '### 2026-05-27\n### 2026-05-28\n\n### 2026-05-29\n有效对话内容';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized, '有效对话内容');
  });

  test('F4-T2-3: Legitimate numbered brackets like [1] or [2026] are NOT stripped as image tokens', () => {
    const raw = '参考附录 [1] 和方案 [2026] 详细说明';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized, raw);
  });

  test('F4-T2-4: Message consisting solely of [图片] is pruned completely to avoid ghost turns', () => {
    const raw = '[图片]';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized, '');
  });

  test('F4-T2-5: Mixed text and placeholder like "你看这个 [图片] 帅不帅" preserves textual message content', () => {
    const raw = '你看这个 [图片] 帅不帅';
    const sanitized = sanitizeIngestionContent(raw);

    assert.strictEqual(sanitized, '你看这个  帅不帅');
  });
});
