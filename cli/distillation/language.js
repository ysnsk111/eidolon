/**
 * EIDOLON Layer 1: Comprehensive Language Fingerprint
 * Implements statistical distribution calculations per Section 10 of the specification.
 */

export function extractLanguageFingerprint(messages, targetSpeaker) {
  const targetMsgs = messages.filter(
    (m) => (targetSpeaker ? m.sender.toLowerCase() === targetSpeaker.toLowerCase() : m.isTarget)
  );

  if (targetMsgs.length === 0) {
    return getDefaultLanguageFingerprint();
  }

  const texts = targetMsgs.map((m) => m.content.trim()).filter((t) => t.length > 0);
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

  for (const t of texts) {
    const tokens = tokenize(t);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      vocabulary[tok] = (vocabulary[tok] || 0) + 1;

      if (i < tokens.length - 1) {
        const bi = `${tok} ${tokens[i + 1]}`;
        bigrams[bi] = (bigrams[bi] || 0) + 1;
      }
      if (i < tokens.length - 2) {
        const tri = `${tok} ${tokens[i + 1]} ${tokens[i + 2]}`;
        trigrams[tri] = (trigrams[tri] || 0) + 1;
      }
    }
  }

  // Sort top vocabulary, bigrams, trigrams
  const topVocab = getTopK(vocabulary, 50);
  const topBigrams = getTopK(bigrams, 30);
  const topTrigrams = getTopK(trigrams, 20);

  // 5. Catchphrases & Habitual Phrases Extraction
  const catchphrases = extractCatchphrases(texts, vocabulary, bigrams);

  // 6. Conversation Openers and Closers
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

function tokenize(text) {
  // Tokenize mixed Chinese and English text
  // Extract Chinese character sequences, English words, emojis, numbers
  const tokens = [];
  const regex = /[\u4e00-\u9fa5]|[a-zA-Z0-9']+|[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]+/gu;
  let match;
  while ((match = regex.exec(text)) !== null) {
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

function extractCatchphrases(texts, vocabMap, biMap) {
  // Detect habitual expressions (phrases that appear disproportionately often)
  const phrases = [];
  const patterns = [
    /^(好(呀|的|吧|呗|嘛))/i,
    /^(知道啦|收到|好嘞)/i,
    /^(哈哈哈+|2333+|hh+|hhh+)/i,
    /^(确实|对呀|没关系|没事)/i,
    /^(拜拜|晚安|明天见|先去忙啦)/i,
  ];

  for (const text of texts) {
    for (const pat of patterns) {
      const match = text.match(pat);
      if (match) {
        phrases.push(match[0]);
      }
    }
  }

  const phraseCounts = {};
  for (const p of phrases) {
    phraseCounts[p] = (phraseCounts[p] || 0) + 1;
  }

  const topPhrases = getTopK(phraseCounts, 10).map((item) => item.token);
  // Also add top 5 bigrams if they are frequent
  const topBi = getTopK(biMap, 5)
    .filter((b) => b.count >= 2)
    .map((b) => b.token);

  return Array.from(new Set([...topPhrases, ...topBi]));
}

function extractOpenersAndClosers(messages, targetSpeaker) {
  const openers = [];
  const closers = [];

  // An opener is the first message in a conversation session sent by the target
  // A closer is the final message in a session sent by the target
  const sessionGapMs = 25 * 60 * 1000;
  let sessionStart = true;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isTarget = targetSpeaker ? m.sender.toLowerCase() === targetSpeaker.toLowerCase() : m.isTarget;

    if (sessionStart && isTarget && m.content.length <= 40) {
      openers.push(m.content);
      sessionStart = false;
    }

    const nextMsg = messages[i + 1];
    if (!nextMsg || nextMsg.epochMs - m.epochMs > sessionGapMs) {
      if (isTarget && m.content.length <= 40) {
        closers.push(m.content);
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
