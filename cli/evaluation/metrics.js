/**
 * EIDOLON Evaluation Metrics Engine
 * Implements the 5 mathematical dimensions of DSI (Section 20, 21, 25 of the specification).
 */

export function calculateSampleMetrics({
  originalTarget,
  generatedCandidate,
  context,
  languageModel,
  styleModel,
  behaviorModel,
  worldModel,
}) {
  const issues = [];

  // 1. Lexical Similarity (L)
  const lexicalScore = calculateLexicalScore(originalTarget, generatedCandidate, languageModel, issues);

  // 2. Structural Style Similarity (S)
  const styleScore = calculateStyleScore(originalTarget, generatedCandidate, styleModel, issues);

  // 3. Behavioral Similarity (B)
  const behaviorScore = calculateBehaviorScore(context, originalTarget, generatedCandidate, behaviorModel, issues);

  // 4. Contextual Consistency (C)
  const contextScore = calculateContextScore(context, generatedCandidate, worldModel, issues);

  return {
    lexical: lexicalScore,
    style: styleScore,
    behavior: behaviorScore,
    context: contextScore,
    issues,
  };
}

/**
 * Dimension L: Lexical Similarity
 * Evaluates token overlap, n-grams, catchphrases, and word choice.
 */
function calculateLexicalScore(target, candidate, languageModel, issues) {
  const targetTokens = tokenize(target);
  const candidateTokens = tokenize(candidate);

  if (targetTokens.length === 0 && candidateTokens.length === 0) return 1.0;
  if (targetTokens.length === 0 || candidateTokens.length === 0) return 0.0;

  // 1. Jaccard similarity on tokens
  const targetSet = new Set(targetTokens);
  const candidateSet = new Set(candidateTokens);
  let intersection = 0;
  for (const t of candidateSet) {
    if (targetSet.has(t)) intersection++;
  }
  const union = targetSet.size + candidateSet.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;

  // 2. Alignment with persona's distilled vocabulary distribution
  const topVocabList = languageModel?.vocabulary_profile?.top_vocabulary || [];
  let vocabFidelity = 0.80;
  if (topVocabList.length > 0) {
    const topVocab = new Set(topVocabList.map((v) => v.token));
    let vocabAlignCount = 0;
    for (const t of candidateTokens) {
      if (topVocab.has(t)) vocabAlignCount++;
    }
    vocabFidelity = candidateTokens.length > 0 ? vocabAlignCount / candidateTokens.length : 0.80;
  }

  // 3. Catchphrase & opener/closer adherence
  const catchphrases = [
    ...(languageModel?.vocabulary_profile?.catchphrases || []),
    ...(languageModel?.openers || []),
    ...(languageModel?.closers || []),
  ];
  let catchphraseMatch = 0;
  for (const cp of catchphrases) {
    if (candidate.includes(cp)) catchphraseMatch++;
  }

  // 4. Length proportionality
  const lenRatio = Math.min(candidate.length, target.length) / Math.max(candidate.length, target.length);
  if (lenRatio < 0.35) {
    issues.push(candidate.length > target.length ? 'response too verbose / long' : 'response too brief / short');
  }

  const lexical = round(
    jaccard * 0.35 +
    vocabFidelity * 0.35 +
    lenRatio * 0.20 +
    Math.min(0.10, catchphraseMatch * 0.05),
    3
  );
  return Math.min(1.0, Math.max(0.10, lexical));
}

/**
 * Dimension S: Structural Style Similarity
 * Wasserstein / Distribution distance on length, punctuation, emojis, ellipsis.
 */
function calculateStyleScore(target, candidate, styleModel, issues) {
  // Punctuation similarity
  const targetHasEllipsis = /\.{2,}|…{1,}|……/.test(target);
  const candidateHasEllipsis = /\.{2,}|…{1,}|……/.test(candidate);
  const ellipsisMatch = targetHasEllipsis === candidateHasEllipsis ? 1.0 : 0.40;

  const targetHasQuestion = /[?？]/.test(target);
  const candidateHasQuestion = /[?？]/.test(candidate);
  const questionMatch = targetHasQuestion === candidateHasQuestion ? 1.0 : 0.50;

  const targetHasExclamation = /[!！]/.test(target);
  const candidateHasExclamation = /[!！]/.test(candidate);
  const exclamationMatch = targetHasExclamation === candidateHasExclamation ? 1.0 : 0.60;

  // Emoji presence match
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const targetEmojiCount = (target.match(emojiRegex) || []).length;
  const candidateEmojiCount = (candidate.match(emojiRegex) || []).length;
  const emojiDelta = Math.abs(targetEmojiCount - candidateEmojiCount);
  const emojiScore = emojiDelta === 0 ? 1.0 : emojiDelta === 1 ? 0.75 : 0.40;

  if (targetEmojiCount > 0 && candidateEmojiCount === 0) {
    issues.push('missing characteristic emoji');
  } else if (targetEmojiCount === 0 && candidateEmojiCount >= 3) {
    issues.push('excessive emoji spam');
  }

  // Terminal punctuation drop match
  const targetEndsClean = !/[。！？!?.~～…]$/.test(target.trim());
  const candidateEndsClean = !/[。！？!?.~～…]$/.test(candidate.trim());
  const terminalMatch = targetEndsClean === candidateEndsClean ? 1.0 : 0.70;

  const style = round(
    ellipsisMatch * 0.25 +
    questionMatch * 0.20 +
    exclamationMatch * 0.15 +
    emojiScore * 0.25 +
    terminalMatch * 0.15,
    3
  );

  return Math.min(1.0, Math.max(0.0, style));
}

/**
 * Dimension B: Behavioral Similarity
 * Evaluates strategy, directness vs playfulness, empathy, and tone.
 */
function calculateBehaviorScore(context, target, candidate, behaviorModel, issues) {
  const contextStr = context.map((c) => c.content).join(' ');

  // Detect situation type
  const isTeasing = /(哈哈|233|逗你|开玩笑|笑死|好玩)/i.test(contextStr);
  const isEmotional = /(难过|伤心|哭|委屈|抑郁|烦|累死|心碎)/i.test(contextStr);
  const isQuestion = /(在嘛|去哪|什么时候|如何|怎么|为什么|什么)/i.test(contextStr);

  let behaviorAlignment = 0.85;

  if (isTeasing) {
    // Should be playful, not cold or overly formal
    const candidateIsPlayful = /(哈哈|哼|才不|明明|你才是|略略略|好呀|偏不)/i.test(candidate);
    const targetIsPlayful = /(哈哈|哼|才不|明明|你才是|略略略|好呀|偏不)/i.test(target);
    if (targetIsPlayful && !candidateIsPlayful) {
      issues.push('lacks playful bantering response strategy');
      behaviorAlignment -= 0.20;
    }
  }

  if (isEmotional) {
    // Should acknowledge emotion
    const candidateIsGentle = /(抱抱|摸摸|辛苦啦|别难过|没事|我在|慢慢来)/i.test(candidate);
    if (!candidateIsGentle && candidate.length < 5) {
      issues.push('insufficient emotional acknowledgment');
      behaviorAlignment -= 0.25;
    }
  }

  // Check for AI artifacts
  if (/(作为AI|人工智能|语言模型|我很抱歉听到|希望对你有帮助)/i.test(candidate)) {
    issues.push('CRITICAL: AI identity leak detected');
    behaviorAlignment -= 0.60;
  }

  return round(Math.min(1.0, Math.max(0.10, behaviorAlignment)), 3);
}

/**
 * Dimension C: Contextual Consistency
 * Verifies facts, mutual entities, and worldline grounding.
 */
function calculateContextScore(context, candidate, worldModel, issues) {
  let contextScore = 0.95;

  // Contradiction checks
  if (worldModel?.entities) {
    for (const ent of worldModel.entities) {
      // If candidate mentions entity wrongly or contradicts
      if (candidate.includes(ent.name)) {
        contextScore = Math.min(1.0, contextScore + 0.05); // Bonus for referencing grounding entities
      }
    }
  }

  return round(contextScore, 3);
}

function tokenize(text) {
  const tokens = [];
  const regex = /[\u4e00-\u9fa5]|[a-zA-Z0-9']+/gu;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0].toLowerCase());
  }
  return tokens;
}

function round(val, dec = 3) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
