import { sanitizeMessage, isSystemSender } from './sanitize.js';

export function normalizeMessages(rawMessages, options = {}) {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return {
      messages: [],
      speakers: {},
      sessions: [],
      targetSpeaker: null,
      counterpartSpeaker: null,
    };
  }

  // 1. Assign deterministic IDs, parse dates, clean text
  const cleaned = rawMessages
    .map((m, idx) => {
      const id = m.id || `msg_${String(idx + 1).padStart(6, '0')}`;
      let sender = (m.sender || 'Unknown').trim();
      // Strip any accidental leading timestamps from sender name
      sender = sender.replace(/^\[?\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[,\sT]+\d{1,2}:\d{1,2}(?::\d{1,2})?)?\]?\s*/, '').trim();
      sender = sender.replace(/^\[?\d{1,2}:\d{1,2}(?::\d{1,2})?\]?\s*/, '').trim();
      if (!sender) sender = (m.sender || 'Unknown').trim();

      // Filter out messages where sender is a group name or system entity
      if (isSystemSender(sender)) {
        return null;
      }

      const sanitized = sanitizeMessage(m.content || '', m.mediaType);
      if (sanitized.isSystem) {
        return null;
      }

      const content = sanitized.content;
      // Filter out residual group announcements or declarations in content
      if (/我是群聊/i.test(content) || /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(content)) {
        return null;
      }

      const timestamp = parseTimestamp(m.timestamp || m.date || m.time);
      const mediaType = sanitized.mediaType || detectMediaType(content, m.mediaType);

      return {
        id,
        timestamp: timestamp.toISOString(),
        epochMs: timestamp.getTime(),
        sender,
        content,
        replyToId: m.replyToId || null,
        mediaType,
        raw: m.raw || content,
        metadata: m.metadata || {},
      };
    })
    .filter(Boolean)
    .filter((m) => m.content.length > 0 || m.mediaType !== 'text');

  // 2. Sort chronologically
  cleaned.sort((a, b) => a.epochMs - b.epochMs);

  // 3. Speaker frequency analysis
  const speakers = {};
  for (const msg of cleaned) {
    if (!isSystemSender(msg.sender)) {
      speakers[msg.sender] = (speakers[msg.sender] || 0) + 1;
    }
  }

  const sortedSpeakers = Object.entries(speakers).sort((a, b) => b[1] - a[1]);
  let targetSpeaker = options.targetSpeaker;
  let counterpartSpeaker = options.counterpartSpeaker;

  if (!targetSpeaker && sortedSpeakers.length > 0) {
    targetSpeaker = sortedSpeakers[0][0];
  }

  // Ensure counterpartSpeaker is strictly separated from targetSpeaker
  if (!counterpartSpeaker) {
    const counterpartEntry = sortedSpeakers.find(
      ([s]) => s.toLowerCase() !== targetSpeaker?.toLowerCase()
    );
    if (counterpartEntry) {
      counterpartSpeaker = counterpartEntry[0];
    }
  } else if (targetSpeaker && counterpartSpeaker.toLowerCase() === targetSpeaker.toLowerCase()) {
    const counterpartEntry = sortedSpeakers.find(
      ([s]) => s.toLowerCase() !== targetSpeaker.toLowerCase()
    );
    counterpartSpeaker = counterpartEntry ? counterpartEntry[0] : null;
  }

  // 4. Mark isTarget
  const messages = cleaned.map((m) => ({
    ...m,
    isTarget: targetSpeaker ? m.sender.toLowerCase() === targetSpeaker.toLowerCase() : false,
  }));

  // 5. Segment into conversation sessions (idle gap > 25 mins by default)
  const idleGapMs = (options.idleGapMinutes || 25) * 60 * 1000;
  const sessions = [];
  let currentSession = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (i === 0) {
      currentSession.push(msg);
      continue;
    }

    const prevMsg = messages[i - 1];
    const timeDiff = msg.epochMs - prevMsg.epochMs;

    if (timeDiff > idleGapMs) {
      if (currentSession.length > 0) {
        sessions.push(createSessionObj(sessions.length + 1, currentSession));
      }
      currentSession = [msg];
    } else {
      currentSession.push(msg);
    }
  }

  if (currentSession.length > 0) {
    sessions.push(createSessionObj(sessions.length + 1, currentSession));
  }

  return {
    messages,
    speakers,
    sortedSpeakers,
    targetSpeaker,
    counterpartSpeaker,
    sessions,
    totalMessages: messages.length,
    targetMessageCount: messages.filter((m) => m.isTarget).length,
  };
}

function createSessionObj(sessionId, sessionMessages) {
  const startTime = sessionMessages[0].timestamp;
  const endTime = sessionMessages[sessionMessages.length - 1].timestamp;
  return {
    id: `session_${String(sessionId).padStart(4, '0')}`,
    startTime,
    endTime,
    messageCount: sessionMessages.length,
    messages: sessionMessages,
  };
}

function parseTimestamp(raw) {
  if (!raw) return new Date();
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  if (typeof raw === 'number') {
    return raw < 10000000000 ? new Date(raw * 1000) : new Date(raw);
  }

  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;

    const match = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (match) {
      const [, y, m, d, h, min, s] = match;
      return new Date(Date.UTC(+y, +m - 1, +d, +h, +min, s ? +s : 0));
    }
  }

  return new Date();
}

function detectMediaType(content, explicitType) {
  if (explicitType) return explicitType;
  if (!content) return 'text';

  const lower = content.toLowerCase();
  if (lower.includes('[sticker]') || lower.includes('[表情包]') || lower.includes('[动画表情]')) {
    return 'sticker';
  }
  if (lower.includes('[image]') || lower.includes('[图片]') || lower.includes('[photo]')) {
    return 'image';
  }
  if (lower.includes('[voice]') || lower.includes('[语音]') || lower.includes('[audio]')) {
    return 'voice';
  }
  if (/^https?:\/\/[^\s]+$/.test(content.trim())) {
    return 'link';
  }
  const emojiRegex = /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\s]+$/u;
  if (emojiRegex.test(content.trim())) {
    return 'emoji';
  }

  return 'text';
}
