import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectCleanFewShotTurns } from './helpers/e2e_harness.js';

describe('Feature F7 E2E: Few-Shot Selection & Injection', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F7-T1-1: Few-shot turns dynamically label counterpart speaker instead of hardcoding "User:"', () => {
    const rawTurns = [
      { contextText: '周末有空吗？', targetText: '有呀，怎么啦？' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'Alice', 'Bob');

    assert.strictEqual(fewShots.length, 1);
    assert.ok(fewShots[0].formatted.startsWith('Bob: 周末有空吗？'));
    assert.ok(fewShots[0].formatted.includes('Alice: 有呀，怎么啦？'));
    assert.strictEqual(fewShots[0].formatted.includes('User:'), false, 'Must NOT hardcode User:');
  });

  test('F7-T1-2: Few-shot turns strictly filter out Markdown date headers (### 2026-05-27)', () => {
    const rawTurns = [
      { contextText: '666 页\n### 2026-05-27', targetText: '我就直说了' },
      { contextText: '明天见', targetText: '好呀明天见' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'Alice', 'Bob');

    assert.ok(fewShots.length > 0);
    for (const fs of fewShots) {
      assert.strictEqual(fs.formatted.includes('###'), false, 'Few-shot turns must not contain ### headers');
      assert.strictEqual(fs.context.includes('###'), false);
    }
  });

  test('F7-T1-3: Few-shot turns strictly filter out image placeholders ([图片])', () => {
    const rawTurns = [
      { contextText: '[图片]', targetText: '好看吧' },
      { contextText: '吃了没', targetText: '刚吃完火锅[图片]' },
      { contextText: '西湖人多吗', targetText: '断桥全是人' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'Alice', 'Bob');

    assert.ok(fewShots.length > 0);
    for (const fs of fewShots) {
      assert.strictEqual(fs.formatted.includes('[图片]'), false, 'Few-shot turns must not contain [图片]');
      assert.strictEqual(fs.target.includes('[图片]'), false);
    }
  });

  test('F7-T1-4: Few-shot turns strictly filter out group announcements (我是群聊...)', () => {
    const rawTurns = [
      { contextText: '我是群聊“河南省实验中学初一36”', targetText: '收到' },
      { contextText: '晚上开黑吗', targetText: '来！上号' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'Alice', 'Bob');

    assert.strictEqual(fewShots.length, 1);
    assert.strictEqual(fewShots[0].context, '晚上开黑吗');
    assert.strictEqual(fewShots[0].target, '来！上号');
  });

  test('F7-T1-5: Few-shot turns format dialogue cleanly with target and counterpart turns preserved', () => {
    const rawTurns = [
      { contextText: '今天累瘫了', targetText: '抱抱~快去休息' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, '王雅雯', '李雷');

    assert.strictEqual(fewShots[0].formatted, '李雷: 今天累瘫了\n王雅雯: 抱抱~快去休息');
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F7-T2-1: Empty or heavily contaminated chat history drops corrupted turns without crashing', () => {
    const contaminatedTurns = [
      { contextText: '### 2026-05-27', targetText: '[图片]' },
      { contextText: '[图片]', targetText: '我是群聊' },
    ];
    const fewShots = selectCleanFewShotTurns(contaminatedTurns, 'Alice', 'Bob');

    assert.strictEqual(fewShots.length, 0);
  });

  test('F7-T2-2: Turns containing genuine multi-line dialogue preserve line breaks within dialogue turns', () => {
    const rawTurns = [
      { contextText: '第一句\n第二句', targetText: '好的收到' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'Alice', 'Bob');

    assert.strictEqual(fewShots.length, 1);
    assert.ok(fewShots[0].context.includes('\n'));
  });

  test('F7-T2-3: Few-shot turns maintain target speaker identity across turns', () => {
    const rawTurns = [
      { contextText: '问1', targetText: '答1' },
      { contextText: '问2', targetText: '答2' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'TargetSpeaker', 'Counterpart');

    for (const fs of fewShots) {
      assert.ok(fs.formatted.includes('TargetSpeaker:'));
      assert.ok(fs.formatted.includes('Counterpart:'));
    }
  });

  test('F7-T2-4: Asymmetric conversations (one speaker dominates) still select valid candidate pairs', () => {
    const rawTurns = [
      { contextText: '在？', targetText: '在呢' },
    ];
    const fewShots = selectCleanFewShotTurns(rawTurns, 'A', 'B');
    assert.strictEqual(fewShots.length, 1);
  });

  test('F7-T2-5: Input turns with null or missing fields handled gracefully without throwing', () => {
    assert.deepStrictEqual(selectCleanFewShotTurns([]), []);
    assert.deepStrictEqual(selectCleanFewShotTurns(null), []);
    assert.deepStrictEqual(selectCleanFewShotTurns([{ contextText: null, targetText: null }]), []);
  });
});
