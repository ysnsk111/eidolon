import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateHeader,
  extractDateFromHeader,
  stripMarkdownHeaders,
  stripMediaTokens,
  isGroupAnnouncement,
  isSystemNotice,
  sanitizeMessage,
} from '../../cli/ingestion/sanitize.js';

describe('Ingestion Sanitizer Unit Tests', () => {
  test('isDateHeader should accurately identify standalone Markdown date headers', () => {
    assert.equal(isDateHeader('### 2026-05-27'), true);
    assert.equal(isDateHeader('## 2026/05/27'), true);
    assert.equal(isDateHeader('# [2026-05-27 10:20:00]'), true);
    assert.equal(isDateHeader('### 2026-05-27 星期三'), true);
    assert.equal(isDateHeader('### 2026-05-27 Alice: hello'), false);
    assert.equal(isDateHeader('今天天气不错'), false);
  });

  test('extractDateFromHeader should extract clean date strings', () => {
    assert.equal(extractDateFromHeader('### 2026-05-27'), '2026-05-27');
    assert.equal(extractDateFromHeader('### [2026-05-27 10:20]'), '2026-05-27 10:20');
  });

  test('stripMarkdownHeaders should remove embedded headers and section titles', () => {
    const text = 'User: 666 页\n\n### 2026-05-27\n王雅雯: 好的收到';
    const cleaned = stripMarkdownHeaders(text);
    assert.ok(!cleaned.includes('### 2026-05-27'));
    assert.ok(cleaned.includes('666 页'));
    assert.ok(cleaned.includes('好的收到'));
  });

  test('stripMediaTokens should handle media-only and mixed messages', () => {
    // Media only
    const resOnly = stripMediaTokens('[图片]');
    assert.equal(resOnly.text, '');
    assert.equal(resOnly.mediaType, 'image');
    assert.equal(resOnly.isMediaOnly, true);

    const resSticker = stripMediaTokens('[表情包]');
    assert.equal(resSticker.text, '');
    assert.equal(resSticker.mediaType, 'sticker');
    assert.equal(resSticker.isMediaOnly, true);

    // Mixed text and media
    const resMixed = stripMediaTokens('看这个 [图片] 好搞笑');
    assert.equal(resMixed.text, '看这个 好搞笑');
    assert.equal(resMixed.isMediaOnly, false);
  });

  test('isGroupAnnouncement should detect group announcements and bot intros', () => {
    assert.equal(isGroupAnnouncement('我是群聊“河南省实验中学初一36”'), true);
    assert.equal(isGroupAnnouncement('群公告：明天下午两点开会'), true);
    assert.equal(isGroupAnnouncement('欢迎加入群聊！请大家改备注'), true);
    assert.equal(isGroupAnnouncement('明天去哪里吃饭呀'), false);
  });

  test('isSystemNotice should detect WeChat and Telegram service messages', () => {
    assert.equal(isSystemNotice('王雅雯 撤回了一条消息'), true);
    assert.equal(isSystemNotice('你撤回了一条消息'), true);
    assert.equal(isSystemNotice('张三 加入了群聊'), true);
    assert.equal(isSystemNotice('对方正在输入...'), true);
    assert.equal(isSystemNotice('[通话时长 05:23]'), true);
    assert.equal(isSystemNotice('[微信红包] 恭喜发财'), true);
    assert.equal(isSystemNotice('你已添加了李四，现在可以开始聊天了。'), true);
    assert.equal(isSystemNotice('好的没问题，晚点聊'), false);
  });

  test('sanitizeMessage should return clean text and proper metadata', () => {
    const systemRes = sanitizeMessage('张三 撤回了一条消息');
    assert.equal(systemRes.isSystem, true);
    assert.equal(systemRes.content, '');

    const mixedRes = sanitizeMessage('看这个 [图片] 太逗了\n### 2026-05-27');
    assert.equal(mixedRes.isSystem, false);
    assert.equal(mixedRes.content, '看这个 太逗了');

    const imageOnlyRes = sanitizeMessage('[图片]');
    assert.equal(imageOnlyRes.isSystem, false);
    assert.equal(imageOnlyRes.isMediaOnly, true);
    assert.equal(imageOnlyRes.mediaType, 'image');
    assert.equal(imageOnlyRes.content, '');
  });

  test('parseMdString should not append ### date headers to previous messages and should filter group announcements', async () => {
    const { parseMdString } = await import('../../cli/ingestion/md.js');
    const mdContent = `
User: 666 页

### 2026-05-27
王雅雯: 我是群聊“河南省实验中学初一36”
王雅雯: 我就直说了，直接问了
User: [图片]
王雅雯: 看到了 [图片] 这道题选C
`;
    const res = parseMdString(mdContent, { targetSpeaker: '王雅雯' });

    // 1. Previous message '666 页' must NOT have '### 2026-05-27' appended
    const userMsg = res.messages.find((m) => m.content.includes('666 页'));
    assert.ok(userMsg, 'User message should exist');
    assert.ok(!userMsg.content.includes('2026-05-27'), 'Date header must not append to previous message');
    assert.equal(userMsg.content.trim(), '666 页');

    // 2. Group announcement '我是群聊...' must be filtered out
    const announcementMsg = res.messages.find((m) => m.content.includes('我是群聊'));
    assert.equal(announcementMsg, undefined, 'Group announcement must be filtered out');

    // 3. Target message '我就直说了，直接问了' must exist
    const directMsg = res.messages.find((m) => m.content.includes('我就直说了'));
    assert.ok(directMsg, 'Target direct message should exist');

    // 4. Standalone [图片] must have empty content
    const imgOnlyMsg = res.messages.find((m) => m.sender === 'User' && m.mediaType === 'image');
    if (imgOnlyMsg) {
      assert.equal(imgOnlyMsg.content, '', 'Image-only message must have empty content');
    }

    // 5. Mixed message '看到了 [图片] 这道题选C' must have [图片] stripped
    const mixedMsg = res.messages.find((m) => m.content.includes('看到了'));
    assert.ok(mixedMsg, 'Mixed message should exist');
    assert.ok(!mixedMsg.content.includes('[图片]'), 'Media placeholder must be stripped from mixed message');
    assert.equal(mixedMsg.content, '看到了 这道题选C');
  });
});
