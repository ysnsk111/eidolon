import fs from 'node:fs';
import { normalizeMessages } from './normalize.js';
import {
  isDateHeader,
  extractDateFromHeader,
  isGroupAnnouncement,
  isSystemNotice,
  isPollutedContent,
  cleanMessageContent,
  isSystemSender,
} from './sanitize.js';

export function parseMdChat(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseMdString(content, options);
}

export function parseMdString(rawText, options = {}) {
  const lines = rawText.split(/\r?\n/);
  const rawMessages = [];

  // Patterns for Markdown and structured chat logs:
  // 1. Header with Date + Sender: ### 2026-05-14 10:22:15 Alice or ### 2026-05-14 10:22:15 Alice: content
  const pHeaderDateSender = /^#{1,4}\s*\[?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[,\sT]+\d{1,2}:\d{1,2}(?::\d{1,2})?)?)\]?\s+([^\n\r:]{1,25})(?:\s*[:：]\s*(.*))?$/;

  // 2. ### Alice (2026-05-14 10:22:15) or ### Alice: content
  const pHeaderSenderDate = /^#{1,4}\s*([^:\n\r()\[\]]{1,25})\s*(?:[\(\[](\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[,\sT]+\d{1,2}:\d{1,2}(?::\d{1,2})?)[\)\]]\s*[:：]?|[:：])\s*(.*)$/;

  // 3. **Alice** (2026-05-14 10:22:15): content or **Alice**: content
  const pBoldSender = /^\*{2}(.+?)\*{2}(?:\s*[\(\[](\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[,\sT]+\d{1,2}:\d{1,2}(?::\d{1,2})?)[\)\]])?\s*[:：]\s*(.*)$/;

  // 4. Standard timestamp + sender: 2026-05-14 10:22:15 Alice: content or [2026-05-14 10:22:15] Alice: content
  const pTimestampSender = /^(?:\[?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[,\sT]+\d{1,2}:\d{1,2}(?::\d{1,2})?)\]?)\s*[-:]?\s*([^:\n\r]+?)\s*[:：]\s*(.*)$/;

  // 5. Bullet item: - Alice: content or * Alice: content
  const pBulletSender = /^[-*]\s+(?:\*{2})?([^:\n\r]+?)(?:\*{2})?\s*[:：]\s*(.*)$/;

  // 6. Blockquote: > Alice: content or > 2026-05-14 10:22:15 Alice: content
  const pQuoteSender = /^>\s*(?:\[?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[,\sT]+\d{1,2}:\d{1,2}(?::\d{1,2})?)\]?)?\s*([^:\n\r]+?)\s*[:：]\s*(.*)$/;

  // 7. Fallback speaker pattern: Alice: content
  const pSpeakerOnly = /^([a-zA-Z0-9_\u4e00-\u9fa5\s]{1,20})\s*[:：]\s*(.*)$/;

  let currentMsg = null;
  let simulatedEpoch = Date.now() - 30 * 24 * 3600 * 1000;

  function pushCurrentMsg() {
    if (currentMsg && currentMsg.content) {
      if (
        !isSystemSender(currentMsg.sender) &&
        !isGroupAnnouncement(currentMsg.content) &&
        !isSystemNotice(currentMsg.content) &&
        !/我是群聊/i.test(currentMsg.content)
      ) {
        rawMessages.push(currentMsg);
      }
    }
    currentMsg = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line) {
      if (currentMsg && currentMsg.content) {
        currentMsg.content += '\n';
      }
      continue;
    }

    // Skip horizontal rules
    if (/^[-*_]{3,}$/.test(line.trim())) continue;

    // Standalone date or session separator header: ### 2026-05-27
    if (isDateHeader(line)) {
      pushCurrentMsg();
      const extractedDate = extractDateFromHeader(line);
      if (extractedDate) {
        const parsed = new Date(extractedDate);
        if (!isNaN(parsed.getTime())) {
          simulatedEpoch = parsed.getTime();
        }
      }
      continue;
    }

    // Drop any standalone system notice or group announcement
    if (
      isSystemNotice(line) ||
      isGroupAnnouncement(line) ||
      /我是群聊/i.test(line) ||
      /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(line.trim())
    ) {
      pushCurrentMsg();
      continue;
    }

    // 1. Header with Date + Sender
    let match = line.match(pHeaderDateSender);
    if (match && match[2] && match[2].trim()) {
      const sender = match[2].trim();
      const body = match[3] ? match[3].trim() : '';
      if (isSystemSender(sender)) {
        pushCurrentMsg();
        continue;
      }
      if (
        isGroupAnnouncement(body) ||
        isSystemNotice(body) ||
        /我是群聊/i.test(body) ||
        /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(body)
      ) {
        pushCurrentMsg();
        continue;
      }
      pushCurrentMsg();
      currentMsg = {
        timestamp: match[1]?.trim() || new Date(simulatedEpoch).toISOString(),
        sender,
        content: body,
        raw: line,
      };
      continue;
    }

    // 2. Bold Sender
    match = line.match(pBoldSender);
    if (match && match[1] && match[1].trim()) {
      const sender = match[1].trim();
      const body = match[3] ? match[3].trim() : '';
      if (isSystemSender(sender)) {
        pushCurrentMsg();
        continue;
      }
      if (
        isGroupAnnouncement(body) ||
        isSystemNotice(body) ||
        /我是群聊/i.test(body) ||
        /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(body)
      ) {
        pushCurrentMsg();
        continue;
      }
      pushCurrentMsg();
      const timestampRaw = match[2];
      if (timestampRaw) simulatedEpoch = new Date(timestampRaw).getTime() || simulatedEpoch;
      else simulatedEpoch += 60000;
      currentMsg = {
        timestamp: timestampRaw ? timestampRaw.trim() : new Date(simulatedEpoch).toISOString(),
        sender,
        content: body,
        raw: line,
      };
      continue;
    }

    // 3. Timestamp + Sender
    match = line.match(pTimestampSender);
    if (match && match[2] && match[2].trim()) {
      const sender = match[2].trim();
      const body = match[3] ? match[3].trim() : '';
      if (isSystemSender(sender)) {
        pushCurrentMsg();
        continue;
      }
      if (
        isGroupAnnouncement(body) ||
        isSystemNotice(body) ||
        /我是群聊/i.test(body) ||
        /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(body)
      ) {
        pushCurrentMsg();
        continue;
      }
      pushCurrentMsg();
      currentMsg = {
        timestamp: match[1].trim(),
        sender,
        content: body,
        raw: line,
      };
      continue;
    }

    // 4. Blockquote Sender
    match = line.match(pQuoteSender);
    if (match && match[2] && match[2].trim() && !match[2].startsWith('http')) {
      const sender = match[2].trim();
      const body = match[3] ? match[3].trim() : '';
      if (isSystemSender(sender)) {
        pushCurrentMsg();
        continue;
      }
      if (
        isGroupAnnouncement(body) ||
        isSystemNotice(body) ||
        /我是群聊/i.test(body) ||
        /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(body)
      ) {
        pushCurrentMsg();
        continue;
      }
      pushCurrentMsg();
      const timestampRaw = match[1];
      if (timestampRaw) simulatedEpoch = new Date(timestampRaw).getTime() || simulatedEpoch;
      else simulatedEpoch += 60000;
      currentMsg = {
        timestamp: timestampRaw ? timestampRaw.trim() : new Date(simulatedEpoch).toISOString(),
        sender,
        content: body,
        raw: line,
      };
      continue;
    }

    // 5. Bullet Sender
    match = line.match(pBulletSender);
    if (match && match[1] && match[1].trim() && !match[1].startsWith('http')) {
      const sender = match[1].trim();
      const body = match[2] ? match[2].trim() : '';
      if (isSystemSender(sender)) {
        pushCurrentMsg();
        continue;
      }
      if (
        isGroupAnnouncement(body) ||
        isSystemNotice(body) ||
        /我是群聊/i.test(body) ||
        /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(body)
      ) {
        pushCurrentMsg();
        continue;
      }
      pushCurrentMsg();
      simulatedEpoch += 60000;
      currentMsg = {
        timestamp: new Date(simulatedEpoch).toISOString(),
        sender,
        content: body,
        raw: line,
      };
      continue;
    }

    // 6. Header with speaker name: ### Alice
    match = line.match(pHeaderSenderDate);
    if (
      match &&
      match[1] &&
      match[1].trim() &&
      !match[1].toLowerCase().includes('conversation') &&
      !match[1].toLowerCase().includes('chat') &&
      !match[1].toLowerCase().includes('section') &&
      !match[1].toLowerCase().includes('notice') &&
      !isSystemSender(match[1])
    ) {
      const sender = match[1].trim();
      const body = match[3] ? match[3].trim() : '';
      if (
        isGroupAnnouncement(body) ||
        isSystemNotice(body) ||
        /我是群聊/i.test(body) ||
        /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(body)
      ) {
        pushCurrentMsg();
        continue;
      }
      pushCurrentMsg();
      const timestampRaw = match[2];
      if (timestampRaw) simulatedEpoch = new Date(timestampRaw).getTime() || simulatedEpoch;
      else simulatedEpoch += 60000;
      currentMsg = {
        timestamp: timestampRaw ? timestampRaw.trim() : new Date(simulatedEpoch).toISOString(),
        sender,
        content: body,
        raw: line,
      };
      continue;
    }

    // 7. Fallback: Alice: content
    const matchSpeaker = line.match(pSpeakerOnly);
    if (matchSpeaker && !line.startsWith('http://') && !line.startsWith('https://') && !line.startsWith('//')) {
      const senderCandidate = matchSpeaker[1].trim();
      if (
        senderCandidate.length >= 1 &&
        senderCandidate.length <= 25 &&
        !senderCandidate.includes('[') &&
        !isSystemSender(senderCandidate)
      ) {
        const body = matchSpeaker[2] ? matchSpeaker[2].trim() : '';
        if (
          isGroupAnnouncement(body) ||
          isSystemNotice(body) ||
          /我是群聊/i.test(body) ||
          /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(body)
        ) {
          pushCurrentMsg();
          continue;
        }
        pushCurrentMsg();
        simulatedEpoch += 60000;
        currentMsg = {
          timestamp: new Date(simulatedEpoch).toISOString(),
          sender: senderCandidate,
          content: body,
          raw: line,
        };
        continue;
      }
    }

    // Non-message Markdown headers (e.g. # Title, ## Section)
    if (/^#{1,6}\s+/.test(line)) {
      pushCurrentMsg();
      continue;
    }

    // System notices and group announcements
    if (
      isSystemNotice(line) ||
      isGroupAnnouncement(line) ||
      /我是群聊/i.test(line) ||
      /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(line.trim())
    ) {
      pushCurrentMsg();
      continue;
    }

    // Message line continuation
    if (currentMsg) {
      currentMsg.content += currentMsg.content ? `\n${line.trim()}` : line.trim();
      currentMsg.raw += `\n${line}`;
    }
  }

  pushCurrentMsg();

  return normalizeMessages(rawMessages, options);
}
