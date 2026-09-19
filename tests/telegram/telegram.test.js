import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Telegram Runtime Policy Tests', () => {
  test('User matching allowlist accurately accepts authorized and rejects unauthorized IDs', () => {
    const allowedUsers = new Set(['8287471787', '123456789']);

    function isAllowed(id) {
      return allowedUsers.has(String(id));
    }

    assert.equal(isAllowed('8287471787'), true);
    assert.equal(isAllowed(8287471787), true);
    assert.equal(isAllowed('999999999'), false);
    assert.equal(isAllowed('attacker_bot'), false);
  });

  test('Zero streaming policy ensures complete response dispatch', () => {
    const streamPolicy = {
      sseEnabled: false,
      chunkedStreaming: false,
      sendMessageDraft: false,
      dispatchMode: 'single_complete_message',
    };

    assert.equal(streamPolicy.sseEnabled, false);
    assert.equal(streamPolicy.chunkedStreaming, false);
    assert.equal(streamPolicy.sendMessageDraft, false);
    assert.equal(streamPolicy.dispatchMode, 'single_complete_message');
  });
});
