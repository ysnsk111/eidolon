import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

describe('Memory Temporal Versioning & Conflict Resolution Tests', () => {
  test('superseded facts must receive valid_to timestamp when overwritten', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE memory_items (
        id TEXT PRIMARY KEY,
        persona_id TEXT,
        layer TEXT,
        category TEXT,
        key TEXT,
        value TEXT,
        importance_score REAL,
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL
      );
    `);

    // Insert version 1: favorite_food = ramen
    db.exec(`
      INSERT INTO memory_items VALUES (
        'mem_1', 'persona_test', 'L2', 'preference', 'preference:favorite_food', 'ramen',
        0.85, '2026-01-01T00:00:00Z', NULL, 0.95
      );
    `);

    // Simulate update at 2026-08-01: favorite_food = curry
    const updateTime = '2026-08-01T00:00:00Z';
    // 1. Mark superseded version
    db.exec(`
      UPDATE memory_items
      SET valid_to = '${updateTime}'
      WHERE key = 'preference:favorite_food' AND valid_to IS NULL;
    `);

    // 2. Insert new active version
    db.exec(`
      INSERT INTO memory_items VALUES (
        'mem_2', 'persona_test', 'L2', 'preference', 'preference:favorite_food', 'curry',
        0.90, '${updateTime}', NULL, 0.95
      );
    `);

    // Verify
    const all = db.prepare('SELECT * FROM memory_items WHERE key = ? ORDER BY valid_from ASC').all('preference:favorite_food');
    assert.strictEqual(all.length, 2);

    const oldVersion = all[0];
    const newVersion = all[1];

    assert.strictEqual(oldVersion.value, 'ramen');
    assert.strictEqual(oldVersion.valid_to, updateTime, 'Old version must have valid_to set');

    assert.strictEqual(newVersion.value, 'curry');
    assert.strictEqual(newVersion.valid_to, null, 'New version must be active (valid_to is null)');

    db.close();
  });
});
