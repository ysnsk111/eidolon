import path from 'node:path';
import fs from 'node:fs';
import { parseTxtChat } from './txt.js';
import { parseMdChat } from './md.js';
import { parseJsonChat } from './json.js';
import { parseHtmlChat } from './html.js';
import { parsePdfChat } from './pdf.js';

export async function ingestChatFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chat history file not found at: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await parsePdfChat(filePath, options);
    case '.json':
    case '.jsonl':
      return parseJsonChat(filePath, options);
    case '.html':
    case '.htm':
      return parseHtmlChat(filePath, options);
    case '.md': {
      try {
        const mdRes = parseMdChat(filePath, options);
        if (mdRes && mdRes.messages && mdRes.messages.length > 0) {
          return mdRes;
        }
      } catch (_) {}
      return parseTxtChat(filePath, options);
    }
    case '.txt':
    case '.csv':
    case '.log':
      return parseTxtChat(filePath, options);
    default:
      // Try JSON first, then markdown, then fallback to text
      try {
        return parseJsonChat(filePath, options);
      } catch (_) {
        try {
          const mdRes = parseMdChat(filePath, options);
          if (mdRes && mdRes.messages && mdRes.messages.length > 0) {
            return mdRes;
          }
        } catch (_) {}
        return parseTxtChat(filePath, options);
      }
  }
}

export * from './normalize.js';
export * from './txt.js';
export * from './md.js';
export * from './json.js';
export * from './html.js';
export * from './pdf.js';

