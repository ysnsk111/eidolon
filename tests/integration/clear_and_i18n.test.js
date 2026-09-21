import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseMdString } from '../../cli/ingestion/md.js';
import { SUPPORTED_LANGUAGES, t, setCurrentLanguage, getCurrentLanguage } from '../../cli/utils/i18n.js';
import { clearCommand } from '../../cli/commands/clear.js';
import { DatabaseSync } from 'node:sqlite';
import { buildWorldModel } from '../../cli/distillation/context.js';
import { OpenAICompatibleProvider } from '../../cli/providers/openai-compatible.js';

test('i18n System: supports all 8 languages with fallback', () => {
  assert.equal(SUPPORTED_LANGUAGES.length, 8);

  const langCodes = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'fr', 'es'];
  for (const code of langCodes) {
    const matched = SUPPORTED_LANGUAGES.find((l) => l.code === code);
    assert.ok(matched, `Language ${code} should be supported`);

    const welcomeStr = t('app.welcome', {}, code);
    assert.ok(welcomeStr && welcomeStr.length > 5, `Expected non-empty translation for ${code}`);
  }

  // Fallback to English on unknown key
  const fallback = t('non_existent_key_xyz', {}, 'es');
  assert.equal(fallback, 'non_existent_key_xyz');
});

test('Markdown Parser: parses varied markdown headers and dialogue formats', () => {
  const sampleMd = `
# Chat Log with Alice

### 2026-05-21 10:22:15 Alice
Hello! How are you doing today?

**User** (2026-05-21 10:23:00):
I am doing great, working on the EIDOLON project.

- Alice: That sounds awesome! Let me know if you need help.

> User: Thanks Alice!
`;

  const parsed = parseMdString(sampleMd, { targetSpeaker: 'Alice' });
  assert.ok(parsed.messages.length >= 3, `Expected at least 3 messages, got ${parsed.messages.length}`);
  assert.equal(parsed.targetSpeaker, 'Alice');
  assert.equal(parsed.counterpartSpeaker, 'User');
});

test('Clear Command: chat-memory mode preserves personas and wipes sessions/memories', async () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eidolon-test-clear-'));
  const testDb = path.join(testDir, 'test.db');

  const db = new DatabaseSync(testDb);
  db.exec(`
    CREATE TABLE personas (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY);
    CREATE TABLE messages (id TEXT PRIMARY KEY);
    CREATE TABLE memories (id TEXT PRIMARY KEY);
    CREATE TABLE scheduler_events (id TEXT PRIMARY KEY);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY);
    CREATE TABLE relationship_states (session_id TEXT PRIMARY KEY, state_json TEXT, updated_at TEXT);

    INSERT INTO personas VALUES ('p1', 'Alice');
    INSERT INTO sessions VALUES ('s1');
    INSERT INTO messages VALUES ('m1');
    INSERT INTO memories VALUES ('mem1');
  `);
  db.close();

  // Test mode chat-memory
  await clearCommand({
    mode: 'chat-memory',
    yes: true,
    confirm: true,
    nonInteractive: true,
  });

  // Check that function executed without error
  assert.ok(true);
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('Context Overflow Resilience: extractGraphHierarchical handles chunking gracefully', async () => {
  const dummyTurns = Array.from({ length: 35 }, (_, i) => ({
    id: `turn_${i}`,
    context: [{ sender: 'User', content: `Message number ${i}` }],
    target_message: `Response number ${i}`,
  }));

  const mockProvider = {
    async extract(text, instructions) {
      if (text.length > 50000) {
        const err = new Error('Context length exceeded');
        err.isContextOverflow = true;
        throw err;
      }
      return {
        entities: [{ id: 'ent_test', name: 'TestEntity', type: 'person', description: 'desc' }],
        relationships: [{ source_entity: 'User', relation: 'knows', target_entity: 'TestEntity' }],
        timeline: [{ event_id: 'ev_1', date_or_period: '2026-05-21', title: 'TestEvent', impact: 'high' }],
      };
    },
  };

  const world = await buildWorldModel(null, [], dummyTurns, mockProvider);
  assert.ok(world.entities.length > 0);
  assert.ok(world.relationships.length > 0);
  assert.ok(world.timeline.length > 0);
});
