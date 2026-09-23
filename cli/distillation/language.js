/**
 * EIDOLON Layer 1: Comprehensive Language Fingerprint
 * Implements statistical distribution calculations per Section 10 of the specification.
 */

import {
  isSystemNotice,
  isGroupAnnouncement,
  isPollutedContent,
  cleanMessageContent,
} from '../ingestion/sanitize.js';

export function extractLanguageFingerprint(messages, targetSpeaker) {
  const targetMsgs = messages.filter(
    (m) => (targetSpeaker ? m.sender.toLowerCase() === targetSpeaker.toLowerCase() : m.isTarget)
  );

  if (targetMsgs.length === 0) {
    return getDefaultLanguageFingerprint();
  }

  const texts = targetMsgs
    .map((m) => (m.content || '').trim())
    .map((t) => normalizeChineseSpaces(t))
    .filter((t) => t.length > 0 && !isPollutedContent(t));

  if (texts.length === 0) {
    return getDefaultLanguageFingerprint();
  }

  const totalCount = texts.length;

  // 1. Message Length Statistics (character count)
  const lengths = texts.map((t) => t.length).sort((a, b) => a - b);
  const messageLengthStats = calculateDistribution(lengths);

  // 2. Sentence Segmentation & Length Statistics
  const sentences = [];
  for (const text of texts) {
    const split = text.split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
    sentences.push(...split);
  }
  const sentenceLengths = (sentences.length > 0 ? sentences : texts)
    .map((s) => s.length)
    .sort((a, b) => a - b);
  const sentenceLengthStats = calculateDistribution(sentenceLengths);

  // 3. Punctuation Profile & Rates
  let ellipsisCount = 0;
  let questionCount = 0;
  let exclamationCount = 0;
  let tildeCount = 0;
  let commaCount = 0;
  let periodCount = 0;
  let lineBreakCount = 0;
  let repeatedCharCount = 0;
  let capitalizationCount = 0;
  let englishChineseMixCount = 0;
  let numberUsageCount = 0;
  let dropTerminalPunctuationCount = 0;

  for (const t of texts) {
    if (/\.{2,}|…{1,}|……/.test(t)) ellipsisCount++;
    if (/[?？]/.test(t)) questionCount++;
    if (/[!！]/.test(t)) exclamationCount++;
    if (/[~～]/.test(t)) tildeCount++;
    if (/[,，]/.test(t)) commaCount++;
    if (/[。.]/.test(t)) periodCount++;
    if (/\n/.test(t)) lineBreakCount++;
    if (/(.)\1{2,}/.test(t)) repeatedCharCount++; // e.g. 哈哈哈, ???, !!!
    if (/[A-Z]/.test(t)) capitalizationCount++;
    if (/[\u4e00-\u9fa5]/.test(t) && /[a-zA-Z]/.test(t)) englishChineseMixCount++;
    if (/\d/.test(t)) numberUsageCount++;

    // Terminal punctuation check: does the message end without standard sentence final punctuation?
    if (!/[。！？!?.~～…]$/.test(t)) {
      dropTerminalPunctuationCount++;
    }
  }

  // 4. Vocabulary Frequency & N-Grams
  const vocabulary = {};
  const bigrams = {};
  const trigrams = {};

  // 4. Chinese Modal Particles & Tone Words (Section 25)
  const modalParticles = ['啊', '呀', '呢', '嘛', '吧', '诶', '欸', '啦', '哦', '嗷', '唔'];
  const modalParticleCounts = {};
  let messagesWithModalParticle = 0;
  for (const p of modalParticles) modalParticleCounts[p] = 0;

  // 5. Repetition Patterns (e.g. 哈哈哈, 啊啊啊, 好好好, 不是不是)
  const repetitionPatterns = {};

  // 6. Message Structure Metrics
  let singleLineCount = 0;
  let multiLineCount = 0;
  let bulletCount = 0;

  for (const t of texts) {
    let hasModal = false;
    for (const p of modalParticles) {
      if (t.includes(p)) {
        modalParticleCounts[p]++;
        hasModal = true;
      }
    }
    if (hasModal) messagesWithModalParticle++;

    // Repetition detector
    const repMatches = t.match(/([\u4e00-\u9fa5a-zA-Z])\1{2,}|([\u4e00-\u9fa5]{2})\2+/g);
    if (repMatches) {
      for (const rm of repMatches) {
        repetitionPatterns[rm] = (repetitionPatterns[rm] || 0) + 1;
      }
    }

    // Structure
    if (t.includes('\n')) {
      multiLineCount++;
      if (/^[•\-\*0-9\.]/m.test(t)) bulletCount++;
    } else {
      singleLineCount++;
    }
  }

  const topRepetitions = getTopK(repetitionPatterns, 10);

  // 7. Vocabulary Frequency & N-Grams
  for (const t of texts) {
    const tokens = tokenize(t);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      vocabulary[tok] = (vocabulary[tok] || 0) + 1;

      if (i < tokens.length - 1) {
        const bi = joinNGramTokens(tok, tokens[i + 1]);
        bigrams[bi] = (bigrams[bi] || 0) + 1;
      }
      if (i < tokens.length - 2) {
        const tri = joinTriGramTokens(tok, tokens[i + 1], tokens[i + 2]);
        trigrams[tri] = (trigrams[tri] || 0) + 1;
      }
    }
  }

  // Sort top vocabulary, bigrams, trigrams (filtered to avoid spaces and system/media artifacts)
  const topVocab = Object.entries(vocabulary)
    .filter(([tok]) => isValidVocabToken(tok) && !CHINESE_STOPWORDS.has(tok))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([token, count]) => ({ token, count }));

  const topBigrams = Object.entries(bigrams)
    .filter(([tok]) => isValidVocabToken(tok))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([token, count]) => ({ token, count }));

  const topTrigrams = Object.entries(trigrams)
    .filter(([tok]) => isValidVocabToken(tok))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([token, count]) => ({ token, count }));

  // 8. Catchphrases & Habitual Phrases Extraction
  const catchphrases = extractCatchphrases(texts, vocabulary, bigrams);

  // 9. Conversation Openers and Closers
  const { openers, closers } = extractOpenersAndClosers(messages, targetSpeaker);

  return {
    sample_size: totalCount,
    message_length: messageLengthStats,
    sentence_length: sentenceLengthStats,
    punctuation: {
      ellipsis_rate: round(ellipsisCount / totalCount, 4),
      question_rate: round(questionCount / totalCount, 4),
      exclamation_rate: round(exclamationCount / totalCount, 4),
      tilde_rate: round(tildeCount / totalCount, 4),
      comma_rate: round(commaCount / totalCount, 4),
      period_rate: round(periodCount / totalCount, 4),
      line_break_rate: round(lineBreakCount / totalCount, 4),
      repeated_char_rate: round(repeatedCharCount / totalCount, 4),
      terminal_punctuation_drop_rate: round(dropTerminalPunctuationCount / totalCount, 4),
    },
    linguistic_habits: {
      capitalization_rate: round(capitalizationCount / totalCount, 4),
      bilingual_mix_rate: round(englishChineseMixCount / totalCount, 4),
      number_rate: round(numberUsageCount / totalCount, 4),
    },
    chinese_particles: {
      overall_particle_rate: round(messagesWithModalParticle / totalCount, 4),
      frequencies: modalParticleCounts,
    },
    repetition_habits: {
      top_patterns: topRepetitions,
    },
    message_structure: {
      single_line_rate: round(singleLineCount / totalCount, 4),
      multi_line_rate: round(multiLineCount / totalCount, 4),
      bullet_like_rate: round(bulletCount / totalCount, 4),
    },
    vocabulary_profile: {
      unique_words_count: Object.keys(vocabulary).length,
      top_vocabulary: topVocab,
      top_bigrams: topBigrams,
      top_trigrams: topTrigrams,
      catchphrases,
    },
    openers,
    closers,
  };
}

function calculateDistribution(sortedArray) {
  if (sortedArray.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p90: 0, std_dev: 0 };
  }

  const min = sortedArray[0];
  const max = sortedArray[sortedArray.length - 1];
  const sum = sortedArray.reduce((acc, v) => acc + v, 0);
  const mean = sum / sortedArray.length;

  const median = getPercentile(sortedArray, 0.50);
  const p90 = getPercentile(sortedArray, 0.90);

  const variance =
    sortedArray.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / sortedArray.length;
  const stdDev = Math.sqrt(variance);

  return {
    min,
    max,
    mean: round(mean, 2),
    median: round(median, 2),
    p90: round(p90, 2),
    std_dev: round(stdDev, 2),
  };
}

function getPercentile(sortedArray, p) {
  if (sortedArray.length === 0) return 0;
  const idx = (sortedArray.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  if (lower === upper) return sortedArray[lower];
  return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
}

const isCjk = (str) => typeof str === 'string' && /[\u4e00-\u9fa5]/.test(str);

function normalizeChineseSpaces(str) {
  if (!str || typeof str !== 'string') return '';
  let result = str;
  while (/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/.test(result)) {
    result = result.replace(/([\u4e00-\u9fa5])\s+([\u4e00-\u9fa5])/g, '$1$2');
  }
  return result.trim();
}

function joinNGramTokens(tokA, tokB) {
  const cleanA = normalizeChineseSpaces(tokA);
  const cleanB = normalizeChineseSpaces(tokB);
  if (isCjk(cleanA) && isCjk(cleanB)) {
    return `${cleanA}${cleanB}`;
  }
  return `${cleanA} ${cleanB}`.trim();
}

function joinTriGramTokens(tokA, tokB, tokC) {
  const cleanA = normalizeChineseSpaces(tokA);
  const cleanB = normalizeChineseSpaces(tokB);
  const cleanC = normalizeChineseSpaces(tokC);
  if (isCjk(cleanA) && isCjk(cleanB) && isCjk(cleanC)) {
    return `${cleanA}${cleanB}${cleanC}`;
  }
  if (isCjk(cleanA) && isCjk(cleanB)) {
    return `${cleanA}${cleanB} ${cleanC}`.trim();
  }
  if (isCjk(cleanB) && isCjk(cleanC)) {
    return `${cleanA} ${cleanB}${cleanC}`.trim();
  }
  return `${cleanA} ${cleanB} ${cleanC}`.trim();
}

function isValidVocabToken(token) {
  if (!token || typeof token !== 'string') return false;
  const t = token.trim();
  if (t.length === 0) return false;
  // Strictly eliminate broken tokens with spaces between Chinese characters
  if (/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(t)) return false;
  // Eliminate media tokens
  if (/^(?:图片|照片|语音|视频|表情包|动画表情|动画贴图|贴图|文件|位置|名片|image|photo|video|voice|audio|sticker|file)$/i.test(t)) return false;
  if (/\[(?:图片|image|photo|表情包|动画表情|贴图|sticker|语音|视频)\]/i.test(t)) return false;
  // Eliminate system words
  if (/^(?:我是群聊|群聊|群公告|群规|群主|本群|系统|通知|消息|公告|撤回|打招呼)$/i.test(t)) return false;
  if (/我是群聊/i.test(t)) return false;
  return true;
}

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const normalized = normalizeChineseSpaces(text);
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    const emojiRegex = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]+/u;
    const tokens = [];
    for (const { segment, isWordLike } of segmenter.segment(normalized)) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      const cleanToken = normalizeChineseSpaces(trimmed);
      if (isWordLike) {
        tokens.push(cleanToken.toLowerCase());
      } else if (emojiRegex.test(cleanToken)) {
        tokens.push(cleanToken);
      }
    }
    return tokens;
  }

  // Fallback regex matching words and characters
  const tokens = [];
  const regex = /[\u4e00-\u9fa5]|[a-zA-Z0-9']+|[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]+/gu;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    tokens.push(match[0].toLowerCase());
  }
  return tokens;
}

function getTopK(freqMap, k = 20) {
  return Object.entries(freqMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([token, count]) => ({ token, count }));
}

const CHINESE_STOPWORDS = new Set([
  '这个', '那个', '什么', '怎么', '不是', '因为', '所以', '但是', '我们', '你们', '他们',
  '自己', '一个', '一下', '还是', '觉得', '可以', '没有', '现在', '知道', '这样', '那样',
  '如果', '为了', '而且', '或者', '可能', '应该', '已经', '图片', '照片', '文字', '消息',
  '群聊', '公告', '的话', '然后', '不过', '只是', '其实', '特别', '非常', '比较',
  '图 片', '这 个', '那 个', '什 么', '怎 么', '不 是', '一 个', '一 下', '还 是', '觉 得',
  '可 以', '没 有', '现 在', '知 道', '这 样', '那 样', '如 果', '为 了', '而 且', '或 者',
  '是 我', '我 是', '你 是', '他 是', '在 吗', '在 呢',
]);

function extractCatchphrases(texts, vocabMap, biMap) {
  // Detect habitual expressions across sentences
  const phrases = [];
  const patterns = [
    /好(呀|的|吧|呗|嘛|嘞|哇|滴)|好吧|好的|收到|好嘞/i,
    /没事(儿|呀|啦)?|没关系|不客气(啦)?|懂了就好/i,
    /晚安(安)?|早(呀|安|上好)?|明天见|先去忙啦|拜拜(啦)?|去睡啦/i,
    /确实|真(的|滴)|对(呀|的|滴|啊)|没问题|行(呀|的|啊|嘞)|妥妥|ok/i,
    /哈哈哈+|哈哈|2333+|笑死|笑出声|太逗了|太搞笑了|hh+|hhh+/i,
    /救命|绝了|神了|我天|离谱|尊嘟假嘟|我的妈|真的假的|天哪|好家伙/i,
    /可以(呀|啊|可以)|行行行|好好好|也是/i,
    /怎么啦|怎么了|在哪呢|在干嘛|干嘛呢/i,
  ];

  for (const text of texts) {
    for (const pat of patterns) {
      const match = text.match(pat);
      if (match) {
        const p = normalizeChineseSpaces(match[0]);
        if (
          isValidVocabToken(p) &&
          !CHINESE_STOPWORDS.has(p) &&
          !isPollutedContent(p) &&
          !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(p)
        ) {
          phrases.push(p);
        }
      }
    }
  }

  // Detect repeated whole short sentences (length 2-12)
  const sentenceCounts = {};
  for (const text of texts) {
    const rawSentences = text.split(/[。！？!?；;\n]+/).map((s) => normalizeChineseSpaces(s.trim())).filter(Boolean);
    for (const s of rawSentences) {
      if (
        s.length >= 2 &&
        s.length <= 12 &&
        !CHINESE_STOPWORDS.has(s) &&
        !isSystemNotice(s) &&
        !isGroupAnnouncement(s) &&
        !isPollutedContent(s) &&
        isValidVocabToken(s) &&
        !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(s)
      ) {
        sentenceCounts[s] = (sentenceCounts[s] || 0) + 1;
      }
    }
  }
  const repeatedSentences = Object.entries(sentenceCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sentence]) => sentence);

  const phraseCounts = {};
  for (const p of phrases) {
    phraseCounts[p] = (phraseCounts[p] || 0) + 1;
  }

  const topPhrases = Object.entries(phraseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p]) => p);

  // Add top bigrams only if clean, frequent, and not stopwords
  const topBi = Object.entries(biMap)
    .filter(([tok, count]) => {
      if (count < 2) return false;
      const b = normalizeChineseSpaces(tok.trim());
      if (CHINESE_STOPWORDS.has(b)) return false;
      if (!isValidVocabToken(b)) return false;
      if (isSystemNotice(b) || isGroupAnnouncement(b) || isPollutedContent(b)) return false;
      if (/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(b)) return false;
      return b.length >= 2 && b.length <= 15;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([b]) => b);

  const merged = Array.from(new Set([...topPhrases, ...repeatedSentences, ...topBi]));
  return merged.filter((item) =>
    isValidVocabToken(item) &&
    !CHINESE_STOPWORDS.has(item) &&
    !/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/.test(item) &&
    !isPollutedContent(item) &&
    item.length >= 2 &&
    item.length <= 15
  );
}

function extractOpenersAndClosers(messages, targetSpeaker) {
  const openers = [];
  const closers = [];

  const sessionGapMs = 25 * 60 * 1000;
  let sessionStart = true;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isTarget = targetSpeaker ? m.sender.toLowerCase() === targetSpeaker.toLowerCase() : m.isTarget;

    const cleaned = cleanMessageContent(m.content || '');

    const isValidCandidate =
      cleaned.length >= 2 &&
      cleaned.length <= 30 &&
      !isSystemNotice(cleaned) &&
      !isGroupAnnouncement(cleaned) &&
      !isPollutedContent(cleaned) &&
      !cleaned.startsWith('#');

    if (sessionStart && isTarget && isValidCandidate) {
      openers.push(cleaned);
      sessionStart = false;
    }

    const nextMsg = messages[i + 1];
    if (!nextMsg || nextMsg.epochMs - m.epochMs > sessionGapMs) {
      if (isTarget && isValidCandidate) {
        closers.push(cleaned);
      }
      sessionStart = true;
    }
  }

  return {
    openers: getTopKFreqList(openers, 8),
    closers: getTopKFreqList(closers, 8),
  };
}

function getTopKFreqList(arr, k = 5) {
  const counts = {};
  for (const item of arr) {
    const trimmed = item.trim();
    if (trimmed) counts[trimmed] = (counts[trimmed] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([val]) => val);
}

function round(val, dec = 2) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}

function getDefaultLanguageFingerprint() {
  return {
    sample_size: 0,
    message_length: { min: 0, max: 0, mean: 0, median: 0, p90: 0, std_dev: 0 },
    sentence_length: { min: 0, max: 0, mean: 0, median: 0, p90: 0, std_dev: 0 },
    punctuation: {
      ellipsis_rate: 0,
      question_rate: 0,
      exclamation_rate: 0,
      tilde_rate: 0,
      comma_rate: 0,
      period_rate: 0,
      line_break_rate: 0,
      repeated_char_rate: 0,
      terminal_punctuation_drop_rate: 0,
    },
    linguistic_habits: { capitalization_rate: 0, bilingual_mix_rate: 0, number_rate: 0 },
    vocabulary_profile: {
      unique_words_count: 0,
      top_vocabulary: [],
      top_bigrams: [],
      top_trigrams: [],
      catchphrases: [],
    },
    openers: [],
    closers: [],
  };
}
