import fs from 'node:fs';
import { normalizeMessages } from './normalize.js';

export function parseTxtChat(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseTxtString(content, options);
}

export function parseTxtString(rawText, options = {}) {
  const lines = rawText.split(/\r?\n/);
  const rawMessages = [];

  // Common header regex patterns:
  // 1. 2026-05-14 10:22:15 Alice: content or 2026/05/14 10:22 Alice: content
  const p1 = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)\s+([^:\n\r]+?)\s*[:：]\s*(.*)$/;

  // 2. [2026-05-14 10:22:15] Alice: content or [14/05/2026, 10:22:15] Alice: content
  const p2 = /^\[(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}[,\s]+\d{1,2}:\d{1,2}(?::\d{1,2})?)\]\s*([^:\n\r]+?)\s*[:：]\s*(.*)$/;

  // 3. 14/05/2026, 10:22 - Alice: content
  const p3 = /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4},\s*\d{1,2}:\d{1,2}(?::\d{1,2})?)\s*-\s*([^:\n\r]+?)\s*[:：]\s*(.*)$/;

  // 4. Fallback speaker only: Alice: content
  const p4 = /^([a-zA-Z0-9_\u4e00-\u9fa5]{2,15})\s*[:：]\s*(.*)$/;

  let currentMsg = null;
  let simulatedEpoch = Date.now() - 30 * 24 * 3600 * 1000; // default anchor 30 days ago

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line) continue;

    let match = line.match(p1) || line.match(p2) || line.match(p3);

    if (match) {
      if (currentMsg) {
        rawMessages.push(currentMsg);
      }
      const [, timestampRaw, sender, body] = match;
      simulatedEpoch += 60000; // advance timestamp if parsed relative
      currentMsg = {
        timestamp: timestampRaw,
        sender: sender.trim(),
        content: body.trim(),
        raw: line,
      };
      continue;
    }

    // Try fallback speaker pattern
    const match4 = line.match(p4);
    if (match4 && !line.startsWith('http://') && !line.startsWith('https://')) {
      if (currentMsg) {
        rawMessages.push(currentMsg);
      }
      simulatedEpoch += 60000;
      currentMsg = {
        timestamp: new Date(simulatedEpoch).toISOString(),
        sender: match4[1].trim(),
        content: match4[2].trim(),
        raw: line,
      };
      continue;
    }

    // Otherwise, this line is a continuation of the previous message
    if (currentMsg) {
      currentMsg.content += `\n${line.trim()}`;
      currentMsg.raw += `\n${line}`;
    }
  }

  if (currentMsg) {
    rawMessages.push(currentMsg);
  }

  return normalizeMessages(rawMessages, options);
}
