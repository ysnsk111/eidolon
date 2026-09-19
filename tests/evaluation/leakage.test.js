import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chunkAndSplit } from '../../cli/distillation/chunker.js';

describe('Evaluation Dataset Isolation & Contamination Protection Tests', () => {
  test('should detect near-duplicate contamination across train and blind test splits', () => {
    const rawSessions = [
      {
        id: 'session_0001',
        messages: [
          { sender: 'Bob', content: '今天好累啊', timestamp: '2026-03-01T10:00:00Z', isTarget: false },
          { sender: 'Alice', content: '今天真的好累啊……', timestamp: '2026-03-01T10:00:10Z', isTarget: true },
        ],
      },
      {
        id: 'session_0002',
        messages: [
          { sender: 'Bob', content: '今天也累吗', timestamp: '2026-03-02T10:00:00Z', isTarget: false },
          // Highly similar near-duplicate (> 90% 3-gram similarity)
          { sender: 'Alice', content: '今天真的好累啊……', timestamp: '2026-03-02T10:00:10Z', isTarget: true },
        ],
      },
      {
        id: 'session_0003',
        messages: [
          { sender: 'Bob', content: '出去吃饭不', timestamp: '2026-03-03T10:00:00Z', isTarget: false },
          { sender: 'Alice', content: '好呀走起！', timestamp: '2026-03-03T10:00:10Z', isTarget: true },
        ],
      },
    ];

    const split = chunkAndSplit({
      messages: rawSessions.flatMap((s) => s.messages),
      sessions: rawSessions,
      targetSpeaker: 'Alice',
    });

    assert.ok(split.isolationAudit);
    assert.strictEqual(typeof split.isolationAudit.crossSplitDuplicates, 'number');
    assert.strictEqual(typeof split.isolationAudit.nearDuplicates, 'number');
    assert.strictEqual(typeof split.isolationAudit.train_validation_duplicates, 'number');
    assert.strictEqual(typeof split.isolationAudit.train_test_duplicates, 'number');
    assert.strictEqual(typeof split.isolationAudit.validation_test_duplicates, 'number');
    assert.ok(split.distillationSet.length > 0);
  });

  test('should purge 100% contaminated test samples and never retain contaminated data', () => {
    // Both sessions contain identical target messages
    const rawSessions = [
      {
        id: 'session_train',
        messages: [
          { sender: 'Bob', content: 'A', timestamp: '2026-03-01T10:00:00Z', isTarget: false },
          { sender: 'Alice', content: 'Exact Duplicate Message', timestamp: '2026-03-01T10:00:10Z', isTarget: true },
        ],
      },
      {
        id: 'session_val',
        messages: [
          { sender: 'Bob', content: 'B', timestamp: '2026-03-02T10:00:00Z', isTarget: false },
          { sender: 'Alice', content: 'Distinct Validation Message', timestamp: '2026-03-02T10:00:10Z', isTarget: true },
        ],
      },
      {
        id: 'session_test',
        messages: [
          { sender: 'Bob', content: 'C', timestamp: '2026-03-03T10:00:00Z', isTarget: false },
          { sender: 'Alice', content: 'Exact Duplicate Message', timestamp: '2026-03-03T10:00:10Z', isTarget: true },
        ],
      },
    ];

    const split = chunkAndSplit({
      messages: rawSessions.flatMap((s) => s.messages),
      sessions: rawSessions,
      targetSpeaker: 'Alice',
    });

    // Test set had 1 turn, which was 100% duplicate of train set turn.
    // It MUST be purged to 0, not retained!
    assert.strictEqual(split.blindTestSet.length, 0, 'Contaminated test set must be empty when all samples are duplicates');
    assert.strictEqual(split.isolationAudit.train_test_duplicates, 1);
    assert.strictEqual(split.isolationAudit.passed, false);
  });
});
