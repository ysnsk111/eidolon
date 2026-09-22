import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCJKBigrams,
  filterCatchphrases,
  sanitizeIngestionContent,
} from './helpers/e2e_harness.js';
import { extractLanguageFingerprint } from '../../cli/distillation/language.js';

describe('Feature F5 E2E: Distillation Language Fingerprint & Catchphrases', () => {
  // -------------------------------------------------------------------------
  // Tier 1: Primary Feature Coverage (5 tests)
  // -------------------------------------------------------------------------
  test('F5-T1-1: CJK bigrams join adjacent Chinese characters without artificial space injection ("好呀", not "好 呀")', () => {
    const text = '好呀，今天天气真不错哈哈';
    const bigrams = extractCJKBigrams(text);

    assert.ok(bigrams.includes('好呀'), 'Must contain "好呀" without space');
    assert.ok(bigrams.includes('哈哈'), 'Must contain "哈哈" without space');
    assert.strictEqual(bigrams.some((b) => b.includes(' ')), false, 'No bigram may contain an ASCII space');
  });

  test('F5-T1-2: Catchphrase extraction accurately captures authentic multi-character colloquial expressions', () => {
    const candidateList = [
      { phrase: '笑死我了', count: 15 },
      { phrase: '绝了', count: 12 },
      { phrase: '确实是这样', count: 8 },
    ];
    const filtered = filterCatchphrases(candidateList);

    assert.strictEqual(filtered.length, 3);
    assert.strictEqual(filtered[0].phrase, '笑死我了');
    assert.strictEqual(filtered[1].phrase, '绝了');
  });

  test('F5-T1-3: Stopword and noise filtering purges "图片", "图 片", "那个", and group banners from catchphrases', () => {
    const noisyCandidates = [
      { phrase: '笑死我了', count: 20 },
      { phrase: '图 片', count: 432 },
      { phrase: '图片', count: 300 },
      { phrase: '那个', count: 150 },
      { phrase: '我是群聊', count: 50 },
      { phrase: '### 2026', count: 10 },
      { phrase: '[图片]', count: 200 },
    ];
    const clean = filterCatchphrases(noisyCandidates);

    const phrases = clean.map((c) => c.phrase);
    assert.deepStrictEqual(phrases, ['笑死我了'], 'Must filter out all image, stopword, and header noise');
  });

  test('F5-T1-4: Openers profile contains clean conversational greetings without system notices', () => {
    const rawMessages = [
      { sender: 'Alice', isTarget: true, content: '早呀！今天天气不错~' },
      { sender: 'Bob', isTarget: false, content: '早安！' },
      { sender: 'Alice', isTarget: true, content: '哈喽哈喽' },
    ];
    const fp = extractLanguageFingerprint(rawMessages, 'Alice');

    assert.ok(fp.sample_size > 0);
    assert.ok(fp.message_length.median > 0);
    // Verify openers do not contain group announcements
    assert.strictEqual(JSON.stringify(fp).includes('我是群聊'), false);
    assert.strictEqual(JSON.stringify(fp).includes('[图片]'), false);
  });

  test('F5-T1-5: Chinese particle rate and punctuation distributions correctly measured', () => {
    const rawMessages = [
      { sender: 'Alice', isTarget: true, content: '好呀！真的吗？太棒了吧...' },
    ];
    const fp = extractLanguageFingerprint(rawMessages, 'Alice');

    assert.ok(fp.chinese_particles);
    assert.ok(typeof fp.chinese_particles.overall_particle_rate === 'number');
    assert.ok(typeof fp.punctuation.ellipsis_rate === 'number');
    assert.ok(typeof fp.punctuation.question_rate === 'number');
  });

  // -------------------------------------------------------------------------
  // Tier 2: Boundary & Corner Cases (5 tests)
  // -------------------------------------------------------------------------
  test('F5-T2-1: Mixed CJK and English expressions ("OK呀", "早安bro") tokenized without breaking words', () => {
    const text = 'OK呀，收到bro，稍等下';
    const bigrams = extractCJKBigrams(text);

    // CJK bigrams: 稍等, 等下
    assert.ok(bigrams.includes('稍等'));
    assert.ok(bigrams.includes('等下'));
  });

  test('F5-T2-2: Single-character utterances ("好", "嗯", "对") handled without crashing bigram generator', () => {
    assert.deepStrictEqual(extractCJKBigrams('好'), []);
    assert.deepStrictEqual(extractCJKBigrams('嗯'), []);
    assert.deepStrictEqual(extractCJKBigrams(''), []);
  });

  test('F5-T2-3: Highly repetitive utterances ("哈哈哈哈哈哈哈哈") produce clean frequency counts without exploding state', () => {
    const text = '哈哈哈哈哈哈哈哈';
    const bigrams = extractCJKBigrams(text);

    assert.strictEqual(bigrams.length, 7);
    for (const b of bigrams) {
      assert.strictEqual(b, '哈哈');
    }
  });

  test('F5-T2-4: Messages containing Markdown symbols ("###", "**bold**") stripped before catchphrase evaluation', () => {
    const rawWithMarkdown = '### 2026-05-27\n**重要的事情**说三遍';
    const cleaned = sanitizeIngestionContent(rawWithMarkdown);
    const bigrams = extractCJKBigrams(cleaned);

    assert.ok(bigrams.includes('重要'));
    assert.ok(bigrams.includes('事情'));
    assert.strictEqual(bigrams.some((b) => b.includes('#')), false);
  });

  test('F5-T2-5: Empty or whitespace-only messages produce zero bigrams and clean empty arrays', () => {
    assert.deepStrictEqual(extractCJKBigrams('   \n\t  '), []);
    assert.deepStrictEqual(filterCatchphrases([]), []);
    assert.deepStrictEqual(filterCatchphrases(null), []);
  });
});
