/**
 * EIDOLON E2E Test Suite Shared Harness & Specification Oracle
 *
 * Implements requirement-driven reference models, protocol validators,
 * and test fixtures per ORIGINAL_REQUEST.md, PROJECT.md, and TEST_INFRA.md.
 */

import EventEmitter from 'node:events';

// ---------------------------------------------------------------------------
// F1 & Telegram Protocol Contract Reference
// ---------------------------------------------------------------------------

/**
 * Builds the Telegram sendMessage request payload per PROJECT.md § Interface Contracts #3.
 * Normal turns MUST NOT include reply_parameters.
 * Targeted turns MUST include reply_parameters: { message_id: targetMsgID }.
 */
export function buildTelegramSendPayload(chatID, text, replyToMsgID = 0) {
  if (typeof chatID !== 'number' && typeof chatID !== 'string') {
    throw new TypeError('chatID must be number or string');
  }
  if (typeof text !== 'string') {
    throw new TypeError('text must be string');
  }

  const payload = {
    chat_id: chatID,
    text: text,
  };

  const replyIdNum = Number(replyToMsgID);
  if (Number.isInteger(replyIdNum) && replyIdNum > 0) {
    payload.reply_parameters = {
      message_id: replyIdNum,
    };
  }
  return payload;
}

/**
 * Splits ultra-long messages (>4096 chars limit in Telegram) preserving direct send semantics.
 */
export function splitTelegramMessage(text, maxLength = 4096) {
  if (!text) return [];
  if (text.length <= maxLength) return [text];
  const parts = [];
  for (let i = 0; i < text.length; i += maxLength) {
    parts.push(text.slice(i, i + maxLength));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// F2: Burst Message Debounce Buffer Reference
// ---------------------------------------------------------------------------

/**
 * Session-level burst message debounce buffer per chat.
 * Coalesces rapid messages (< windowMs) into a single turn separated by newline.
 */
export class BurstDebounceQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    this.debounceWindowMs = options.debounceWindowMs || 3500;
    this.maxWaitMs = options.maxWaitMs || 10000;
    this.sessions = new Map(); // chatID -> { messages: [], timer: null, firstArrivalMs: 0 }
  }

  enqueue(chatID, message, nowMs = Date.now()) {
    const key = String(chatID);
    let session = this.sessions.get(key);

    if (!session) {
      session = {
        messages: [],
        timer: null,
        firstArrivalMs: nowMs,
        lastArrivalMs: nowMs,
      };
      this.sessions.set(key, session);
    }

    session.messages.push({
      id: message.id || message.message_id || Date.now(),
      text: (message.text || message.content || '').trim(),
      raw: message,
      receivedAt: nowMs,
    });
    session.lastArrivalMs = nowMs;

    return session;
  }

  /**
   * Evaluates whether the buffer should flush given the current timestamp.
   */
  shouldFlush(chatID, nowMs) {
    const key = String(chatID);
    const session = this.sessions.get(key);
    if (!session || session.messages.length === 0) return false;

    const idleMs = nowMs - session.lastArrivalMs;
    const totalWaitMs = nowMs - session.firstArrivalMs;

    return idleMs >= this.debounceWindowMs || totalWaitMs >= this.maxWaitMs;
  }

  /**
   * Flushes the buffer and produces the coalesced turn context.
   */
  flush(chatID) {
    const key = String(chatID);
    const session = this.sessions.get(key);
    if (!session || session.messages.length === 0) return null;

    // Filter out blank messages
    const validMessages = session.messages.filter((m) => m.text.length > 0);
    this.sessions.delete(key);

    if (validMessages.length === 0) return null;

    const coalescedText = validMessages.map((m) => m.text).join('\n');
    const result = {
      chatID,
      coalescedText,
      messageCount: validMessages.length,
      messages: validMessages,
      firstMessageId: validMessages[0].id,
      lastMessageId: validMessages[validMessages.length - 1].id,
    };

    this.emit('turn', result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// F3: Contextual Quote-Reply Analyzer Reference
// ---------------------------------------------------------------------------

/**
 * Determines whether contextual quote-reply should target a specific message ID.
 * Triggered ONLY when:
 * 1. An explicit reply reference is present, OR
 * 2. In a multi-question burst, the response specifically addresses one specific question.
 */
export function evaluateQuoteReplyTarget(burstMessages, responseText) {
  if (!Array.isArray(burstMessages) || burstMessages.length <= 1) {
    return 0; // Standard 1-to-1 dialogue turn defaults to direct send (0)
  }

  const questionMessages = burstMessages.filter((m) => {
    const text = m.text || m.content || '';
    return text.includes('?') || text.includes('？') || text.includes('吗') || text.includes('哪') || text.includes('什么') || text.includes('怎么');
  });

  // If there's only 0 or 1 question, or if response addresses all jointly, default to direct send
  if (questionMessages.length <= 1) {
    return 0;
  }

  // Check if response specifically mentions distinctive keywords/bigrams from only one of the questions
  let matchedTargetId = 0;
  let matchCount = 0;

  for (const q of questionMessages) {
    const qText = q.text || q.content || '';
    // Extract 2-character bigrams excluding generic question particles
    const cjk = qText.replace(/[^\u4e00-\u9fa5]/g, '');
    const bigrams = new Set();
    for (let i = 0; i < cjk.length - 1; i++) {
      const bg = cjk.slice(i, i + 2);
      if (!['什么', '怎么', '如何', '哪个', '是否', '去哪', '几点', '吗呢', '了吗'].includes(bg)) {
        bigrams.add(bg);
      }
    }

    let isTargeted = false;
    for (const bg of bigrams) {
      if (responseText.includes(bg)) {
        isTargeted = true;
        break;
      }
    }

    if (isTargeted) {
      matchCount++;
      matchedTargetId = q.id || q.message_id || 0;
    }
  }

  // Only quote if targeting ONE specific question, not all
  if (matchCount === 1) {
    return matchedTargetId;
  }

  return 0; // Default to direct send
}

// ---------------------------------------------------------------------------
// F4: Ingestion Sanitizer Reference
// ---------------------------------------------------------------------------

/**
 * Strictly scrubs Markdown date headers, image placeholders, group announcements, and system logs.
 */
export function sanitizeIngestionContent(text) {
  if (typeof text !== 'string') return '';

  let sanitized = text;

  // 1. Strip Markdown date headers (### YYYY-MM-DD or ## YYYY-MM-DD)
  sanitized = sanitized.replace(/^#{1,6}\s+\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{1,2})?.*$/gm, '');

  // 2. Strip image placeholders
  sanitized = sanitized.replace(/\[(?:图片|image|photo|img|sticker|表情)\]/gi, '');

  // 3. Strip group announcements & robot banners
  sanitized = sanitized.replace(/我是群聊[“"][^”"]+[”"]/g, '');
  sanitized = sanitized.replace(/群公告[:：][^\n]+/g, '');
  sanitized = sanitized.replace(/欢迎[“"][^”"]+[”"]加入本群/g, '');
  sanitized = sanitized.replace(/本群已开启全员禁言[^\n]*/g, '');

  // 4. Strip system logs and timestamps
  sanitized = sanitized.replace(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?\s+\[(INFO|WARN|ERROR|DEBUG)\][^\n]*/gm, '');

  // 5. Clean up redundant blank lines and zero-width characters
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');
  sanitized = sanitized.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return sanitized.trim();
}

// ---------------------------------------------------------------------------
// F5: Distillation Language Fingerprint & Bigram Reference
// ---------------------------------------------------------------------------

/**
 * CJK bigram generation joining tokens WITHOUT whitespace.
 */
export function extractCJKBigrams(text) {
  if (!text || typeof text !== 'string') return [];
  const cjkChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  const bigrams = [];
  for (let i = 0; i < cjkChars.length - 1; i++) {
    bigrams.push(`${cjkChars[i]}${cjkChars[i + 1]}`); // No space!
  }
  return bigrams;
}

const DEFAULT_STOPWORDS = new Set([
  '那个', '这个', '我们', '你们', '他们', '什么', '怎么', '图片', '图 片', '我是群聊',
]);

export function filterCatchphrases(candidates, customStopwords = DEFAULT_STOPWORDS) {
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((item) => {
    const phrase = (typeof item === 'string' ? item : item.phrase || '').trim();
    if (!phrase) return false;
    if (phrase.includes('#') || phrase.includes('[') || phrase.includes(']')) return false;
    if (customStopwords.has(phrase)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// F6: Emoji Contextual Modeling & Compound Emoji Reference
// ---------------------------------------------------------------------------

// Unicode regex capturing full compound emojis (ZWJ, variation selector 16, skin tone modifiers)
// while strictly excluding ASCII/non-emoji symbols like (R), (C), TM.
export const COMPOUND_EMOJI_REGEX = /(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

const NON_EMOJI_SYMBOLS = new Set(['®', '©', '™', '〽️', 'ℹ️']);

export function extractValidEmojis(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(COMPOUND_EMOJI_REGEX) || [];
  return matches.filter((e) => !NON_EMOJI_SYMBOLS.has(e) && e.trim().length > 0);
}

export function buildContextualEmojiBindings(emojiMap = {}) {
  const bindings = [];
  if (emojiMap.joking && emojiMap.joking.length > 0) {
    bindings.push(`* When joking: ${emojiMap.joking.join(', ')}`);
  }
  if (emojiMap.tired_sleep && emojiMap.tired_sleep.length > 0) {
    bindings.push(`* When tired/goodnight: ${emojiMap.tired_sleep.join(', ')}`);
  }
  if (emojiMap.pleading_cute && emojiMap.pleading_cute.length > 0) {
    bindings.push(`* When cute/pleading: ${emojiMap.pleading_cute.join(', ')}`);
  }
  if (emojiMap.teasing && emojiMap.teasing.length > 0) {
    bindings.push(`* When teasing: ${emojiMap.teasing.join(', ')}`);
  }

  // Never fall back to generic assistant placeholder '😊 ✨'
  if (bindings.length === 0) {
    return '* Contextual Emojis: (none observed in authentic distribution; omit emojis rather than use synthetic placeholders)';
  }
  return bindings.join('\n');
}

// ---------------------------------------------------------------------------
// F7: Few-Shot Selection & Injection Reference
// ---------------------------------------------------------------------------

export function selectCleanFewShotTurns(turns, targetSpeaker = 'Target', counterpartSpeaker = 'Friend') {
  if (!Array.isArray(turns)) return [];

  const cleanTurns = [];

  for (const turn of turns) {
    const contextText = sanitizeIngestionContent(turn.contextText || '');
    const targetText = sanitizeIngestionContent(turn.targetText || '');

    if (!contextText || !targetText) continue;
    if (contextText.includes('###') || targetText.includes('###')) continue;
    if (contextText.includes('[图片]') || targetText.includes('[图片]')) continue;
    if (contextText.includes('我是群聊') || targetText.includes('我是群聊')) continue;

    cleanTurns.push({
      formatted: `${counterpartSpeaker}: ${contextText}\n${targetSpeaker}: ${targetText}`,
      context: contextText,
      target: targetText,
    });
  }

  return cleanTurns;
}

// ---------------------------------------------------------------------------
// F8: Single-Pass Direct Runtime Generation Contract Reference
// ---------------------------------------------------------------------------

export function buildDirectCasualSystemPrompt({ personaName, counterpartName, styleDirectives = [], contextualEmojiBindings = '' }) {
  return `[DIRECT CASUAL IM DIALOGUE CONTRACT]
You are ${personaName} in a direct 1-to-1 casual instant messaging dialogue with your close friend ${counterpartName}.
Instructions:
1. Respond directly as ${personaName} in 1-2 short colloquial phrases or broken sentences (10-25 characters typical).
2. Omit trailing full-stops / periods typical of formal text.
3. Express genuine emotional temperature and authentic voice.
4. Do NOT generate JSON candidate structures or explain your reasoning.
${contextualEmojiBindings ? `\n[Contextual Emojis]\n${contextualEmojiBindings}` : ''}
${styleDirectives.length > 0 ? `\n[Style Directives]\n${styleDirectives.join('\n')}` : ''}
`;
}

// ---------------------------------------------------------------------------
// F9: Runtime Timeout & Fallback Elimination Reference
// ---------------------------------------------------------------------------

const GENUINE_AI_MARKERS = [
  /作为人工智能助手/i,
  /作为一个AI语言模型/i,
  /作为AI助手/i,
  /我是由OpenAI训练的大型语言模型/i,
  /作为一个虚拟助手/i,
];

export function sanitizeRuntimeOutput(rawOutput, fallbackVoice = '') {
  if (!rawOutput || typeof rawOutput !== 'string') {
    return fallbackVoice || '在忙呢';
  }

  let text = rawOutput.trim();

  // Strip code fences if model accidentally wrapped output
  if (text.startsWith('```') && text.endsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  }

  // Strip outer quotation marks
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
    text = text.slice(1, -1).trim();
  }

  // Strip trailing periods for casual IM fidelity
  text = text.replace(/[。.]+$/, '');

  // Check for genuine AI self-identification markers
  for (const marker of GENUINE_AI_MARKERS) {
    if (marker.test(text)) {
      // Must NEVER fall back to '在呢，怎么啦~'
      return fallbackVoice || '好呀，稍等下哦';
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// F10: Distillation Latency Calibration Reference
// ---------------------------------------------------------------------------

export function calibrateQuantizedLatencyModel(rawTurnDeltasMs) {
  if (!Array.isArray(rawTurnDeltasMs) || rawTurnDeltasMs.length === 0) {
    return {
      median_ms: 2800,
      short: { median_ms: 2000, p90_ms: 3500 },
      medium: { median_ms: 4000, p90_ms: 5500 },
      long: { median_ms: 6500, p90_ms: 8000 },
      quantization_detected: false,
    };
  }

  // Detect minute quantization (e.g. multiples of 60,000ms or all ending in 00s)
  const quantizedCount = rawTurnDeltasMs.filter((d) => d > 0 && d % 60000 === 0).length;
  const quantizationDetected = (quantizedCount / rawTurnDeltasMs.length) >= 0.3;

  // Filter out 60,000ms quantization artifacts and async gaps (>300s)
  const validDeltas = rawTurnDeltasMs
    .filter((d) => d > 0 && d < 300000)
    .map((d) => (d % 60000 === 0 ? Math.min(8000, Math.max(1500, Math.round(d / 20))) : d))
    .map((d) => Math.max(1500, Math.min(8000, d)));

  const sorted = (validDeltas.length > 0 ? validDeltas : [2500, 3500, 5000]).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  return {
    median_ms: Math.max(1500, Math.min(8000, median)),
    short: { median_ms: Math.max(1500, Math.min(3000, Math.round(median * 0.7))), p90_ms: 3500 },
    medium: { median_ms: Math.max(3000, Math.min(5500, median)), p90_ms: 5500 },
    long: { median_ms: Math.max(5000, Math.min(8000, Math.round(median * 1.4))), p90_ms: 8000 },
    quantization_detected: quantizationDetected,
  };
}

// ---------------------------------------------------------------------------
// F11: Dynamic Scheduler & Typing Simulation Reference
// ---------------------------------------------------------------------------

export function calculateHumanDelay(charCount, options = {}) {
  const baseDelayMs = options.baseDelayMs || 2000;
  const cpm = options.cpm || 200; // characters per minute
  const msPerChar = 60000 / cpm;
  const rawTyping = Math.round(charCount * msPerChar);

  // Apply jitter
  const jitter = options.jitter !== undefined ? options.jitter : Math.round((Math.random() * 600) - 300);
  let totalDelay = baseDelayMs + Math.round(rawTyping * 0.5) + jitter;

  // Strictly clamp within human IM bounds: 1.5s to 8.0s
  totalDelay = Math.max(1500, Math.min(8000, totalDelay));

  // Allocation: 25-35% reading delay, 65-75% typing delay
  const readingDelay = Math.round(totalDelay * 0.3);
  const typingDuration = totalDelay - readingDelay;

  // Typing status refresh intervals (every 4000ms)
  const typingRefreshSteps = [];
  let remaining = typingDuration;
  while (remaining > 0) {
    const step = Math.min(4000, remaining);
    typingRefreshSteps.push(step);
    remaining -= step;
  }

  return {
    totalDelayMs: totalDelay,
    readingDelayMs: readingDelay,
    typingDurationMs: typingDuration,
    typingRefreshSteps,
  };
}
