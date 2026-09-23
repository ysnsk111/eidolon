/**
 * EIDOLON Ingestion Sanitizer
 * Scubs Markdown headers, image/media tokens, group announcements, and system logs
 * per Section R2 of the specification.
 */

// Matches standalone Markdown date or session separator headers
const STANDALONE_DATE_HEADER_REGEX =
  /^#{1,6}\s*\[?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[,\sT]+\d{1,2}:\d{1,2}(?::\d{1,2})?)?)\]?\s*(?:星期[一二三四五六日天]|周[一二三四五六日]|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\s*$/i;

// Matches embedded date headers inside multi-line text
const EMBEDDED_DATE_HEADER_REGEX =
  /(?:^|\n)#{1,6}\s*\[?\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[^\n]*/g;

// Matches general markdown section headers (e.g. ### Chat History)
const GENERAL_MD_HEADER_REGEX = /(?:^|\n)#{1,6}\s+[^\n]+/g;

// Media token patterns in chat exports
const MEDIA_TOKEN_REGEX =
  /\[(?:图片|image|photo|表情包|动画表情|动画贴图|贴图|sticker|语音|voice|audio|视频|video|文件|file|位置|location|名片|contact|通话时长[^\s\]]*|红包|微信红包|转账|群收款)\]/gi;

// Specific media type matching
const MEDIA_TYPE_MAP = [
  { pattern: /\[(?:图片|image|photo)\]/i, type: 'image' },
  { pattern: /\[(?:表情包|动画表情|动画贴图|贴图|sticker)\]/i, type: 'sticker' },
  { pattern: /\[(?:语音|voice|audio)\]/i, type: 'voice' },
  { pattern: /\[(?:视频|video)\]/i, type: 'video' },
  { pattern: /\[(?:文件|file)\]/i, type: 'file' },
  { pattern: /\[(?:位置|location)\]/i, type: 'location' },
];

// Group announcements and bot greeting patterns
const GROUP_ANNOUNCEMENT_PATTERNS = [
  /^(我是群聊|群公告|群规|群主提醒|群主|系统通知|系统消息|欢迎加入群聊|本群须知|公告)[:：\s]/i,
  /^我是群聊\s*[“"''『「\[【(（<《].*/i,
  /^我是群聊(?![的得地有人为])/i,
  /^(群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i,
  /(?:^|\n)\s*(?:我是群聊|群公告|群规|群主提醒|本群须知|系统通知|系统消息)[:：]/i,
];

// System notices and service message patterns
const SYSTEM_NOTICE_PATTERNS = [
  /(?:撤回了一条消息|你撤回了一条消息)/,
  /(?:加入了群聊|移出了群聊|移出群聊|退出群聊|退出群|邀请.*加入了群聊|扫描.*二维码加入群聊)/,
  /(?:拍了拍|对方正在输入)/,
  /(?:你已添加了.*现在可以开始聊天了|以上是打招呼内容|开启了朋友验证)/,
  /\[(?:通话时长\s*\d{1,2}:\d{1,2}|语音通话|视频通话)\]/,
  /\[(?:微信红包|红包|转账|群收款)\]/,
  /(?:收到红包|发出红包|领取了红包)/,
  /(?:joined the group|left the group|pinned a message|changed the group name)/i,
];

/**
 * Checks if a sender name represents a group entity or system notice entity.
 */
export function isSystemSender(sender) {
  if (typeof sender !== 'string') return true;
  const s = sender.trim();
  if (!s) return true;
  if (/我是群聊/i.test(s)) return true;
  if (/^(?:群聊|群公告|群规|群主|系统通知|系统消息|本群|公告|管理员|系统|机器人|提醒助手)/i.test(s)) return true;
  if (/^(?:system|admin|bot|notice|notification|service|wechat|telegram)$/i.test(s)) return true;
  if (isGroupAnnouncement(s) || isSystemNotice(s)) return true;
  return false;
}

/**
 * Checks if a single line is a standalone Markdown date header.
 */
export function isDateHeader(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  return STANDALONE_DATE_HEADER_REGEX.test(trimmed);
}

/**
 * Extracts date string from a standalone date header line, if present.
 */
export function extractDateFromHeader(line) {
  if (typeof line !== 'string') return null;
  const match = line.trim().match(STANDALONE_DATE_HEADER_REGEX);
  return match && match[1] ? match[1].trim() : null;
}

/**
 * Strips all Markdown headers (date headers, section titles) from text.
 */
export function stripMarkdownHeaders(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(EMBEDDED_DATE_HEADER_REGEX, '')
    .replace(GENERAL_MD_HEADER_REGEX, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Checks if a text is a group announcement or bot intro.
 */
export function isGroupAnnouncement(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return GROUP_ANNOUNCEMENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Checks if a text is a system notice or service message.
 */
export function isSystemNotice(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return SYSTEM_NOTICE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Detects whether a string is contaminated by system notices, group announcements,
 * group chat declarations, bot intros, markdown headers, or media tokens.
 * Returns true if polluted, false if clean natural content.
 */
export function isPollutedContent(text) {
  if (typeof text !== 'string') return true;
  const trimmed = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (trimmed.length === 0) return true;

  // 1. Group announcements, bot greetings, and group chat declarations
  if (/我是群聊/i.test(trimmed)) return true;
  if (/^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(trimmed)) return true;
  if (/(?:群公告|群规|群主提醒|本群须知|系统通知|系统消息)[:：]/i.test(trimmed)) return true;
  if (isGroupAnnouncement(trimmed)) return true;

  // 2. System notices and service message artifacts
  if (isSystemNotice(trimmed)) return true;

  // 3. Markdown headers (e.g. ### 2026-05-27, ## Session, # Title)
  if (isDateHeader(trimmed) || /(?:^|\n)#{1,6}\s+/i.test(trimmed) || /###\s*\[?\d{4}/i.test(trimmed)) {
    return true;
  }

  // 4. Media placeholders/tokens: [图片], [语音], [视频], [表情包], etc.
  MEDIA_TOKEN_REGEX.lastIndex = 0;
  if (MEDIA_TOKEN_REGEX.test(trimmed)) {
    MEDIA_TOKEN_REGEX.lastIndex = 0;
    return true;
  }

  // 5. System words / bot tokens
  if (/^(?:系统通知|系统消息|群主提醒|本群须知|公告)[:：\s]/i.test(trimmed)) return true;

  return false;
}

/**
 * Guaranteed deep cleaning for message text:
 * - Purges group chat declarations (我是群聊...), group announcements, system notices.
 * - Strips all markdown headers (### Date, # Titles).
 * - Strips all media tokens ([图片], [语音], [表情包], etc.).
 * - Guarantees zero system artifacts leak through.
 */
export function cleanMessageContent(text) {
  if (typeof text !== 'string') return '';

  // 1. Remove zero-width characters and normalize line endings
  let cleaned = text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (!cleaned) return '';

  // 2. If entire string is a group announcement, declaration, or system notice, purge completely
  if (
    /我是群聊/i.test(cleaned) ||
    /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(cleaned) ||
    isGroupAnnouncement(cleaned) ||
    isSystemNotice(cleaned)
  ) {
    return '';
  }

  // 3. Strip all markdown headers
  cleaned = stripMarkdownHeaders(cleaned);

  // 4. Strip media tokens
  const mediaResult = stripMediaTokens(cleaned);
  cleaned = mediaResult.text;

  // 5. Line-by-line inspection to eliminate embedded system/group pollution lines
  const lines = cleaned.split('\n');
  const validLines = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    if (
      /我是群聊/i.test(trimmedLine) ||
      /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(trimmedLine) ||
      isGroupAnnouncement(trimmedLine) ||
      isSystemNotice(trimmedLine) ||
      isDateHeader(trimmedLine) ||
      /^#{1,6}\s+/.test(trimmedLine)
    ) {
      continue;
    }
    validLines.push(trimmedLine);
  }

  cleaned = validLines.join('\n').trim();

  // 6. Check again if remaining text is empty or polluted
  if (!cleaned || /我是群聊/i.test(cleaned) || isGroupAnnouncement(cleaned) || isSystemNotice(cleaned)) {
    return '';
  }

  return cleaned;
}

/**
 * Strips media tokens (e.g. [图片], [image]) from text.
 * Returns cleaned text, detected media type, and whether text was only media tokens.
 */
export function stripMediaTokens(text) {
  if (typeof text !== 'string') {
    return { text: '', mediaType: null, isMediaOnly: false };
  }

  let detectedType = null;
  for (const { pattern, type } of MEDIA_TYPE_MAP) {
    if (pattern.test(text)) {
      detectedType = type;
      break;
    }
  }

  // Check if string contains only media tokens and whitespace
  const withoutMedia = text.replace(MEDIA_TOKEN_REGEX, '').trim();
  const isMediaOnly = withoutMedia.length === 0 && text.trim().length > 0;

  // Clean out media tokens and normalize spacing
  const cleaned = text
    .replace(MEDIA_TOKEN_REGEX, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    text: cleaned,
    mediaType: detectedType,
    isMediaOnly,
  };
}

/**
 * Comprehensive sanitizer for a raw chat message.
 * Normalizes zero-width characters, removes markdown headers, media tokens,
 * and identifies system notices / group announcements.
 */
export function sanitizeMessage(rawText, explicitMediaType = null) {
  if (typeof rawText !== 'string') {
    return {
      content: '',
      mediaType: explicitMediaType || 'text',
      isSystem: false,
      isMediaOnly: false,
    };
  }

  // 1. Remove zero-width characters and standard line breaks
  let text = rawText
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  // 2. Identify system notices and announcements
  if (
    /我是群聊/i.test(text) ||
    /^(?:群公告|群规|群主|本群|欢迎加入|欢迎新成员)/i.test(text) ||
    isGroupAnnouncement(text) ||
    isSystemNotice(text)
  ) {
    return {
      content: '',
      mediaType: 'system',
      isSystem: true,
      isMediaOnly: false,
    };
  }

  // 3. Strip embedded markdown headers
  text = stripMarkdownHeaders(text);

  // 4. Strip media tokens
  const mediaResult = stripMediaTokens(text);
  const resolvedMediaType = explicitMediaType || mediaResult.mediaType || 'text';

  // 5. Clean text if not media-only
  let finalContent = mediaResult.text;
  if (!mediaResult.isMediaOnly && finalContent) {
    finalContent = cleanMessageContent(finalContent);
  }

  return {
    content: finalContent,
    mediaType: mediaResult.isMediaOnly ? (mediaResult.mediaType || 'image') : resolvedMediaType,
    isSystem: false,
    isMediaOnly: mediaResult.isMediaOnly,
  };
}
