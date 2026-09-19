import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTxtChat } from '../../cli/ingestion/txt.js';
import { parseJsonChat } from '../../cli/ingestion/json.js';
import { parseHtmlChat } from '../../cli/ingestion/html.js';
import { ingestChatFile } from '../../cli/ingestion/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, '..', 'fixtures');

describe('Ingestion Layer Tests', () => {
  test('should parse plain text chat history with timestamps and speakers', () => {
    const txtFile = path.join(fixturesDir, 'chat_sample.txt');
    const result = parseTxtChat(txtFile);

    assert.ok(result.totalMessages > 10, 'Should parse multiple messages');
    assert.ok(result.speakers['Alice'] > 0, 'Should detect speaker Alice');
    assert.ok(result.speakers['User'] > 0, 'Should detect speaker User');
    assert.equal(result.targetSpeaker, 'Alice', 'Target speaker should be identified');
    assert.ok(result.sessions.length >= 2, 'Should segment into multiple sessions');
  });

  test('should parse Telegram JSON chat export', () => {
    const jsonFile = path.join(fixturesDir, 'chat_sample.json');
    const result = parseJsonChat(jsonFile);

    assert.equal(result.totalMessages, 4, 'Should parse 4 messages');
    assert.equal(result.speakers['Alice'], 2);
    assert.equal(result.speakers['User'], 2);
  });

  test('should parse Telegram HTML chat export', () => {
    const htmlFile = path.join(fixturesDir, 'chat_sample.html');
    const result = parseHtmlChat(htmlFile);

    assert.equal(result.totalMessages, 2);
    assert.ok(result.messages.some((m) => m.content.includes('西湖边人多吗')));
    assert.ok(result.messages.some((m) => m.content.includes('断桥那边全是游客')));
  });

  test('ingestChatFile dispatcher should automatically route by extension', async () => {
    const txtFile = path.join(fixturesDir, 'chat_sample.txt');
    const res = await ingestChatFile(txtFile);
    assert.ok(res.totalMessages > 0);
  });
});
