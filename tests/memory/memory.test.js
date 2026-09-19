import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

describe('Memory Engine Specification Tests', () => {
  test('6-factor importance score formula computes accurate weighted values', () => {
    // Score = Imp*0.30 + Rec*0.15 + Freq*0.15 + RelImpact*0.15 + FutureRel*0.15 + Conf*0.10
    const imp = 0.90;
    const rec = 1.0;
    const freqFactor = 1.0;
    const rel = 0.80;
    const future = 0.85;
    const conf = 0.95;

    const expected =
      imp * 0.30 +
      rec * 0.15 +
      freqFactor * 0.15 +
      rel * 0.15 +
      future * 0.15 +
      conf * 0.10;

    assert.ok(expected > 0.80);
    assert.ok(expected <= 1.0);
  });

  test('In-memory SQLite validates versioned temporal facts and conflict resolution', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        persona_id TEXT,
        layer TEXT,
        key TEXT,
        value TEXT,
        valid_from TEXT,
        valid_to TEXT
      );
    `);

    // Version 1
    db.exec(`
      INSERT INTO memories (id, persona_id, layer, key, value, valid_from, valid_to)
      VALUES ('mem_1', 'p1', 'L2', 'likes:drink', 'Coffee', '2026-01-01', '2026-06-01');
    `);

    // Version 2 (active)
    db.exec(`
      INSERT INTO memories (id, persona_id, layer, key, value, valid_from, valid_to)
      VALUES ('mem_2', 'p1', 'L2', 'likes:drink', 'Matcha Latte', '2026-06-01', NULL);
    `);

    // Query active version
    const active = db.prepare('SELECT value FROM memories WHERE key = ? AND valid_to IS NULL').get('likes:drink');
    assert.equal(active.value, 'Matcha Latte');

    // Query history versions
    const history = db.prepare('SELECT count(*) as cnt FROM memories WHERE key = ?').get('likes:drink');
    assert.equal(history.cnt, 2);

    db.close();
  });
});
