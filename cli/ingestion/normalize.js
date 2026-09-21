/**
 * EIDOLON Canonical Chat Normalizer & Turn Builder
 */

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

      const content = cleanContent(m.content || '');
      const timestamp = parseTimestamp(m.timestamp || m.date || m.time);
      const mediaType = detectMediaType(content, m.mediaType);

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
    .filter((m) => m.content.length > 0 || m.mediaType !== 'text');

  // 2. Sort chronologically
  cleaned.sort((a, b) => a.epochMs - b.epochMs);

  // 3. Speaker frequency analysis
  const speakers = {};
  for (const msg of cleaned) {
    speakers[msg.sender] = (speakers[msg.sender] || 0) + 1;
  }

  const sortedSpeakers = Object.entries(speakers).sort((a, b) => b[1] - a[1]);
  let targetSpeaker = options.targetSpeaker;
  let counterpartSpeaker = options.counterpartSpeaker;

  if (!targetSpeaker && sortedSpeakers.length > 0) {
    targetSpeaker = sortedSpeakers[0][0];
  }
  if (!counterpartSpeaker && sortedSpeakers.length > 1) {
    counterpartSpeaker = sortedSpeakers[1][0];
  }

  // 4. Mark isTarget
  const messages = cleaned.map((m) => ({
    ...m,
    isTarget: m.sender.toLowerCase() === targetSpeaker?.toLowerCase(),
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

function cleanContent(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width chars
    .replace(/\r\n/g, '\n')
    .trim();
}

function parseTimestamp(raw) {
  if (!raw) return new Date();
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;

  if (typeof raw === 'number') {
    // If epoch seconds (10 digits) vs ms (13 digits)
    return raw < 10000000000 ? new Date(raw * 1000) : new Date(raw);
  }

  if (typeof raw === 'string') {
    // Try standard ISO/Date parsing
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;

    // Pattern: 2026-05-14 10:22:15 or 2026/05/14 10:22
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
  // If content is purely emoji(s)
  const emojiRegex = /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\s]+$/u;
  if (emojiRegex.test(content.trim())) {
    return 'emoji';
  }

  return 'text';
}
