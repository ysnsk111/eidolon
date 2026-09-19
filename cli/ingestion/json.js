import fs from 'node:fs';
import { normalizeMessages } from './normalize.js';

export function parseJsonChat(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseJsonString(content, options);
}

export function parseJsonString(jsonString, options = {}) {
  const parsed = JSON.parse(jsonString);
  const rawMessages = [];

  // Format 1: Official Telegram Desktop export format
  // { name: "...", type: "personal_chat", id: 1234, messages: [ { id, type, date, from, text, reply_to_message_id } ] }
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)) {
    for (const m of parsed.messages) {
      if (m.type !== 'message') continue; // skip service messages

      // In telegram exports, text can be string or array of text/entity objects
      let text = '';
      if (typeof m.text === 'string') {
        text = m.text;
      } else if (Array.isArray(m.text)) {
        text = m.text
          .map((item) => (typeof item === 'string' ? item : item.text || ''))
          .join('');
      }

      if (!text && m.media_type) {
        text = `[${m.media_type}]`;
      }

      rawMessages.push({
        id: `tg_${m.id}`,
        timestamp: m.date,
        sender: m.from || m.actor || (m.from_id ? `User_${m.from_id}` : 'Unknown'),
        content: text,
        replyToId: m.reply_to_message_id ? `tg_${m.reply_to_message_id}` : null,
        mediaType: m.media_type || (m.photo ? 'image' : null),
        raw: JSON.stringify(m),
        metadata: {
          from_id: m.from_id,
          forwarded_from: m.forwarded_from,
        },
      });
    }
    return normalizeMessages(rawMessages, options);
  }

  // Format 2: Array of message objects
  const messageList = Array.isArray(parsed) ? parsed : parsed.data || parsed.history || [];

  if (Array.isArray(messageList)) {
    for (let i = 0; i < messageList.length; i++) {
      const m = messageList[i];
      const sender =
        m.sender || m.from || m.author || m.speaker || m.role || (m.user ? m.user.name : 'Unknown');
      const content = m.content || m.text || m.message || m.body || '';
      const timestamp = m.timestamp || m.date || m.time || m.created_at || new Date().toISOString();
      const replyToId = m.replyToId || m.reply_to || m.reply_to_id || null;

      rawMessages.push({
        id: m.id || `json_msg_${i + 1}`,
        timestamp,
        sender,
        content: typeof content === 'string' ? content : JSON.stringify(content),
        replyToId,
        mediaType: m.media_type || m.mediaType || null,
        raw: JSON.stringify(m),
        metadata: m,
      });
    }
  }

  return normalizeMessages(rawMessages, options);
}
