import fs from 'node:fs';
import { normalizeMessages } from './normalize.js';
import {
  isDateHeader,
  extractDateFromHeader,
  isGroupAnnouncement,
  isSystemNotice,
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line) {
      if (currentMsg && currentMsg.content) {
        // preserve paragraph break inside message
        currentMsg.content += '\n';
      }
      continue;
    }

    // Skip horizontal rules
    if (/^[-*_]{3,}$/.test(line.trim())) continue;

    // Standalone date or session separator header: ### 2026-05-27
    if (isDateHeader(line)) {
      if (currentMsg) {
        rawMessages.push(currentMsg);
        currentMsg = null;
      }
      const extractedDate = extractDateFromHeader(line);
      if (extractedDate) {
        const parsed = new Date(extractedDate);
        if (!isNaN(parsed.getTime())) {
          simulatedEpoch = parsed.getTime();
        }
      }
      continue;
    }

    let match = line.match(pHeaderDateSender);
    if (match && match[2] && match[2].trim()) {
      if (currentMsg) rawMessages.push(currentMsg);
      const [, timestampRaw, sender, body] = match;
      currentMsg = {
        timestamp: timestampRaw?.trim() || new Date(simulatedEpoch).toISOString(),
        sender: sender.trim(),
        content: body ? body.trim() : '',
        raw: line,
      };
      continue;
    }

    match = line.match(pBoldSender);
    if (match && match[1] && match[1].trim()) {
      if (currentMsg) rawMessages.push(currentMsg);
      const [, sender, timestampRaw, body] = match;
      if (timestampRaw) simulatedEpoch = new Date(timestampRaw).getTime() || simulatedEpoch;
      else simulatedEpoch += 60000;
      currentMsg = {
        timestamp: timestampRaw ? timestampRaw.trim() : new Date(simulatedEpoch).toISOString(),
        sender: sender.trim(),
        content: body ? body.trim() : '',
        raw: line,
      };
      continue;
    }

    match = line.match(pTimestampSender);
    if (match && match[2] && match[2].trim()) {
      if (currentMsg) rawMessages.push(currentMsg);
      const [, timestampRaw, sender, body] = match;
      currentMsg = {
        timestamp: timestampRaw.trim(),
        sender: sender.trim(),
        content: body ? body.trim() : '',
        raw: line,
      };
      continue;
    }

    match = line.match(pQuoteSender);
    if (match && match[2] && match[2].trim() && !match[2].startsWith('http')) {
      if (currentMsg) rawMessages.push(currentMsg);
      const [, timestampRaw, sender, body] = match;
      if (timestampRaw) simulatedEpoch = new Date(timestampRaw).getTime() || simulatedEpoch;
      else simulatedEpoch += 60000;
      currentMsg = {
        timestamp: timestampRaw ? timestampRaw.trim() : new Date(simulatedEpoch).toISOString(),
        sender: sender.trim(),
        content: body ? body.trim() : '',
        raw: line,
      };
      continue;
    }

    match = line.match(pBulletSender);
    if (match && match[1] && match[1].trim() && !match[1].startsWith('http')) {
      if (currentMsg) rawMessages.push(currentMsg);
      simulatedEpoch += 60000;
      currentMsg = {
        timestamp: new Date(simulatedEpoch).toISOString(),
        sender: match[1].trim(),
        content: match[2] ? match[2].trim() : '',
        raw: line,
      };
      continue;
    }

    // Header with speaker name: ### Alice
    match = line.match(pHeaderSenderDate);
    if (match && match[1] && match[1].trim() && !match[1].toLowerCase().includes('conversation') && !match[1].toLowerCase().includes('chat')) {
      if (currentMsg) rawMessages.push(currentMsg);
      const [, sender, timestampRaw, body] = match;
      if (timestampRaw) simulatedEpoch = new Date(timestampRaw).getTime() || simulatedEpoch;
      else simulatedEpoch += 60000;
      currentMsg = {
        timestamp: timestampRaw ? timestampRaw.trim() : new Date(simulatedEpoch).toISOString(),
        sender: sender.trim(),
        content: body ? body.trim() : '',
        raw: line,
      };
      continue;
    }

    // Fallback: Alice: content
    const matchSpeaker = line.match(pSpeakerOnly);
    if (matchSpeaker && !line.startsWith('http://') && !line.startsWith('https://') && !line.startsWith('//')) {
      const senderCandidate = matchSpeaker[1].trim();
      // Only treat as speaker if sender candidate is reasonably short and not markdown formatting
      if (senderCandidate.length >= 1 && senderCandidate.length <= 25 && !senderCandidate.includes('[')) {
        if (currentMsg) rawMessages.push(currentMsg);
        simulatedEpoch += 60000;
        currentMsg = {
          timestamp: new Date(simulatedEpoch).toISOString(),
          sender: senderCandidate,
          content: matchSpeaker[2] ? matchSpeaker[2].trim() : '',
          raw: line,
        };
        continue;
      }
    }

    // Non-message Markdown headers (e.g. # Title, ## Section)
    if (/^#{1,6}\s+/.test(line)) {
      if (currentMsg) {
        rawMessages.push(currentMsg);
        currentMsg = null;
      }
      continue;
    }

    // System notices and group announcements
    if (isSystemNotice(line) || isGroupAnnouncement(line)) {
      if (currentMsg) {
        rawMessages.push(currentMsg);
        currentMsg = null;
      }
      continue;
    }

    // Message line continuation
    if (currentMsg) {
      currentMsg.content += currentMsg.content ? `\n${line.trim()}` : line.trim();
      currentMsg.raw += `\n${line}`;
    }
  }

  if (currentMsg && currentMsg.content) {
    rawMessages.push(currentMsg);
  }

  return normalizeMessages(rawMessages, options);
}
