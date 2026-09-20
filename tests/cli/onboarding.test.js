import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runOnboardingWizard } from '../../cli/commands/onboarding.js';
import { verifyBotToken, sendTelegramMessage, deleteTelegramMessage } from '../../cli/utils/telegram.js';
import { loadConfig, updateConfig, saveConfig } from '../../cli/utils/config.js';
import { runDistillationPipeline } from '../../cli/distillation/index.js';

describe('CLI Onboarding Wizard & Distillation Telegram Integration', () => {
  let mockServer;
  let mockPort;
  let receivedRequests = [];
  let savedConfig;

  beforeEach(async () => {
    savedConfig = JSON.parse(JSON.stringify(loadConfig()));
    receivedRequests = [];
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        receivedRequests.push({
          url: req.url,
          method: req.method,
          body: body ? JSON.parse(body) : null,
        });

        // Mock OpenAI chat/completions endpoint for simple-test
        if (req.url === '/v1/chat/completions') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            choices: [{ message: { content: 'PONG' } }],
          }));
          return;
        }

        // Mock Telegram API getMe
        if (req.url.includes('/getMe')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            result: { id: 8921441705, is_bot: true, first_name: 'Ms.Yawen', username: 'wangyawen_bot' },
          }));
          return;
        }

        // Mock Telegram API sendMessage
        if (req.url.includes('/sendMessage')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            result: { message_id: 888 },
          }));
          return;
        }

        // Mock Telegram API deleteMessage
        if (req.url.includes('/deleteMessage')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: true }));
          return;
        }

        // Mock daemon pairing status
        if (req.url === '/api/bot/pairing-status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ paired: true, user_id: '8287471787', chat_id: 8287471787 }));
          return;
        }

        // Mock daemon distill progress
        if (req.url === '/api/distill/progress') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    await new Promise((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (savedConfig) {
      saveConfig(savedConfig);
    }
    if (mockServer) {
      await new Promise(resolve => mockServer.close(resolve));
    }
  });

  test('Telegram utility functions handle token verification and message delivery', async () => {
    // Intercept fetch calls pointing to api.telegram.org in this test
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('api.telegram.org')) {
        const pathSuffix = url.replace(/^https?:\/\/api\.telegram\.org/, '');
        return origFetch(`http://127.0.0.1:${mockPort}${pathSuffix}`, opts);
      }
      return origFetch(url, opts);
    };

    try {
      const verifyRes = await verifyBotToken('mock_bot_token');
      assert.equal(verifyRes.ok, true);
      assert.equal(verifyRes.username, 'wangyawen_bot');

      const msgId = await sendTelegramMessage('mock_bot_token', 8287471787, 'Test message');
      assert.equal(msgId, 888);

      const delRes = await deleteTelegramMessage('mock_bot_token', 8287471787, 888);
      assert.equal(delRes, true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('runOnboardingWizard non-interactive flow configures API, file path, supplementary context, bot pairing, and saves configuration', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('api.telegram.org')) {
        const pathSuffix = url.replace(/^https?:\/\/api\.telegram\.org/, '');
        return origFetch(`http://127.0.0.1:${mockPort}${pathSuffix}`, opts);
      }
      return origFetch(url, opts);
    };

    try {
      const sampleFile = path.resolve(process.cwd(), 'tests/fixtures/chat_sample.txt');
      const sampleContext = path.resolve(process.cwd(), 'tests/fixtures/world_context.md');

      await runOnboardingWizard({
        nonInteractive: true,
        llmBaseUrl: `http://127.0.0.1:${mockPort}/v1`,
        llmApiKey: 'test-api-key',
        llmModel: 'opencode/nemotron-3.5-lightning-free',
        input: sampleFile,
        context: sampleContext,
        botToken: '8921441705:mock_token',
        userId: '8287471787',
        startDistill: false,
      });

      const config = loadConfig();
      assert.equal(config.onboarded, true);
      assert.equal(config.llm.baseUrl, `http://127.0.0.1:${mockPort}/v1`);
      assert.equal(config.llm.apiKey, 'test-api-key');
      assert.equal(config.bot.telegramToken, '8921441705:mock_token');
      assert.deepEqual(config.bot.allowedUsers, ['8287471787']);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('runDistillationPipeline emits onProgress events across all pipeline stages including start and complete', async () => {
    const progressEvents = [];
    const sampleFile = path.resolve(process.cwd(), 'tests/fixtures/chat_sample.txt');

    await runDistillationPipeline({
      inputFile: sampleFile,
      targetSpeaker: 'Alice',
      onProgress: async (evt) => {
        progressEvents.push(evt);
      },
    });

    assert.ok(progressEvents.length >= 9, `Expected at least 9 progress events, got ${progressEvents.length}`);

    // Verify start event
    assert.equal(progressEvents[0].event, 'start');
    assert.equal(progressEvents[0].stage, 0);

    // Verify step 1 to 8 progress events
    for (let s = 1; s <= 8; s++) {
      const found = progressEvents.find(e => e.stage === s && e.event === 'progress');
      assert.ok(found, `Expected progress event for stage ${s}`);
    }

    // Verify complete event
    const completeEvt = progressEvents.find(e => e.event === 'complete');
    assert.ok(completeEvt, 'Expected complete event');
    assert.ok(completeEvt.personaId, 'Expected personaId in complete event');
  });
});
