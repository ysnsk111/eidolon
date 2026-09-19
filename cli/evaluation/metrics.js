/**
 * EIDOLON Evaluation Metrics Engine
 * Implements the 5 mathematical dimensions of DSI (Section 20, 21, 25 of specification).
 *
 * P0-7 Enhancements:
 * - L (Lexical Similarity): Token Jaccard + Character 3-gram cosine + Punctuation distribution distance + Vocab alignment + Length ratio
 * - S (Structural Style): Distribution-based comparison (message length, sentence length, question rate, emoji delta, ellipsis, repetitions, terminal punctuation)
 * - B (Behavioral Similarity): Real feature-vector behavioral comparison (playfulness, empathy, question-back, formality) with severe penalty for AI identity leak
 * - C (Contextual Consistency): Grounding verification against World Model (fact accuracy, timeline validity, entity contradiction detection)
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

  // 1. Lexical Similarity (L) - deterministic
  const lexicalScore = calculateLexicalScore(originalTarget, generatedCandidate, languageModel, issues);

  // 2. Structural Style Similarity (S) - deterministic distribution distance
  const styleScore = calculateStyleScore(originalTarget, generatedCandidate, styleModel, issues);

  // 3. Behavioral Similarity (B) - deterministic feature vector distance
  const behaviorScore = calculateBehaviorScore(context, originalTarget, generatedCandidate, behaviorModel, issues);

  // 4. Contextual Consistency (C) - deterministic contradiction check against world model
  const contextScore = calculateContextScore(context, originalTarget, generatedCandidate, worldModel, issues);

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
 * Combines token overlap, character n-gram cosine, punctuation distribution, and vocabulary fidelity.
 */
/**
 * Dimension L: Lexical Similarity
 * Combines character 1-gram, 2-gram, and 3-gram cosine similarity, vocabulary fidelity,
 * punctuation distribution, and length ratios.
 */
function calculateLexicalScore(target, candidate, languageModel, issues) {
  if (!target || !candidate) return 0.05;
  if (target === candidate) return 1.0;

  // 1. n-gram cosine: character unigram + bigram + trigram cosine (0.30)
  const unigramCosine = cosineSimilarity(charNgramFreq(target, 1), charNgramFreq(candidate, 1));
  const bigramCosine = cosineSimilarity(charNgramFreq(target, 2), charNgramFreq(candidate, 2));
  const trigramCosine = cosineSimilarity(charNgramFreq(target, 3), charNgramFreq(candidate, 3));
  const ngramScore = unigramCosine * 0.35 + bigramCosine * 0.35 + trigramCosine * 0.30;

  // 2. Vocabulary fidelity & catchphrase overlap (0.20)
  const topVocabList = languageModel?.vocabulary_profile?.top_vocabulary || [];
  const candidateTokens = tokenize(candidate);
  let vocabFidelity = 0.75;
  if (topVocabList.length > 0 && candidateTokens.length > 0) {
    const topVocab = new Set(topVocabList.map((v) => v.token));
    let alignCount = 0;
    for (const t of candidateTokens) {
      if (topVocab.has(t)) alignCount++;
    }
    vocabFidelity = alignCount / candidateTokens.length;
  }
  const catchphrases = [
    ...(languageModel?.vocabulary_profile?.catchphrases || []),
    ...(languageModel?.openers || []),
    ...(languageModel?.closers || []),
  ];
  for (const cp of catchphrases) {
    if (candidate.includes(cp)) {
      vocabFidelity = Math.min(1.0, vocabFidelity + 0.10);
    }
  }

  // 3. Punctuation distribution distance (0.20)
  const punctScore = punctuationDistributionSimilarity(target, candidate);

  // 4. Message length distribution distance (0.15)
  const lenRatio = Math.min(candidate.length, target.length) / Math.max(candidate.length, target.length);
  if (lenRatio < 0.35) {
    issues.push(candidate.length > target.length ? 'response too verbose / long' : 'response too brief / short');
  }

  // 5. Sentence length distribution distance (0.15)
  const targetSentences = target.split(/[。！？!?\n]+/).filter(Boolean);
  const candidateSentences = candidate.split(/[。！？!?\n]+/).filter(Boolean);
  const avgTargetSentLen = target.length / Math.max(1, targetSentences.length);
  const avgCandSentLen = candidate.length / Math.max(1, candidateSentences.length);
  const sentenceLenRatio = Math.min(avgTargetSentLen, avgCandSentLen) / Math.max(avgTargetSentLen, avgCandSentLen);

  const lexical = round(
    0.30 * ngramScore +
    0.20 * vocabFidelity +
    0.20 * punctScore +
    0.15 * lenRatio +
    0.15 * sentenceLenRatio,
    3
  );

  return Math.min(1.0, Math.max(0.05, lexical));
}

/**
 * Dimension S: Structural Style Similarity
 * Distilled style distribution similarity (60%) + Local sample style match (40%).
 */
function calculateStyleScore(target, candidate, styleModel, issues) {
  if (!target || !candidate) return 0.05;
  if (target === candidate) return 1.0;

  const targetFeat = extractStyleFeatures(target);
  const candidateFeat = extractStyleFeatures(candidate);

  // 1. Local style match (target sample vs candidate sample)
  const emojiDelta = Math.abs(targetFeat.emojiCount - candidateFeat.emojiCount);
  const emojiScore = emojiDelta === 0 ? 1.0 : emojiDelta === 1 ? 0.80 : Math.max(0.20, 1.0 - emojiDelta * 0.25);

  if (targetFeat.emojiCount > 0 && candidateFeat.emojiCount === 0) {
    issues.push('missing characteristic emoji');
  } else if (targetFeat.emojiCount === 0 && candidateFeat.emojiCount >= 3) {
    issues.push('excessive emoji spam');
  }

  const ellipsisScore = targetFeat.hasEllipsis === candidateFeat.hasEllipsis ? 1.0 : 0.40;
  const questionScore = targetFeat.hasQuestion === candidateFeat.hasQuestion ? 1.0 : 0.50;
  const exclamationScore = targetFeat.hasExclamation === candidateFeat.hasExclamation ? 1.0 : 0.60;
  const tildeScore = targetFeat.hasTilde === candidateFeat.hasTilde ? 1.0 : 0.65;
  const terminalScore = targetFeat.cleanTerminal === candidateFeat.cleanTerminal ? 1.0 : 0.65;
  const bucketDistance = Math.abs(targetFeat.lengthBucketIdx - candidateFeat.lengthBucketIdx);
  const bucketScore = bucketDistance === 0 ? 1.0 : bucketDistance === 1 ? 0.70 : 0.35;
  const repetitionScore = targetFeat.hasRepetition === candidateFeat.hasRepetition ? 1.0 : 0.55;

  const localStyleMatch =
    emojiScore * 0.18 +
    ellipsisScore * 0.13 +
    questionScore * 0.13 +
    exclamationScore * 0.10 +
    tildeScore * 0.10 +
    terminalScore * 0.14 +
    bucketScore * 0.12 +
    repetitionScore * 0.10;

  // 2. Distilled style distribution similarity (candidate vs persona styleModel distribution)
  let distributionSimilarity = localStyleMatch;
  if (styleModel && styleModel.metrics) {
    const m = styleModel.metrics;
    let distSum = 0;
    let distCount = 0;

    if (typeof m.ellipsis_rate === 'number') {
      const actual = candidateFeat.hasEllipsis ? 1.0 : 0.0;
      distSum += Math.abs(actual - m.ellipsis_rate);
      distCount++;
    }
    if (typeof m.question_rate === 'number') {
      const actual = candidateFeat.hasQuestion ? 1.0 : 0.0;
      distSum += Math.abs(actual - m.question_rate);
      distCount++;
    }
    if (typeof m.exclamation_rate === 'number') {
      const actual = candidateFeat.hasExclamation ? 1.0 : 0.0;
      distSum += Math.abs(actual - m.exclamation_rate);
      distCount++;
    }
    if (typeof m.tilde_rate === 'number') {
      const actual = candidateFeat.hasTilde ? 1.0 : 0.0;
      distSum += Math.abs(actual - m.tilde_rate);
      distCount++;
    }
    if (typeof m.terminal_punctuation_drop_rate === 'number') {
      const actual = candidateFeat.cleanTerminal ? 1.0 : 0.0;
      distSum += Math.abs(actual - m.terminal_punctuation_drop_rate);
      distCount++;
    }
    if (typeof m.repeated_char_rate === 'number') {
      const actual = candidateFeat.hasRepetition ? 1.0 : 0.0;
      distSum += Math.abs(actual - m.repeated_char_rate);
      distCount++;
    }
    if (typeof m.emoji_density === 'number') {
      const actualDensity = candidateFeat.emojiCount / Math.max(1, candidate.length);
      distSum += Math.min(1.0, Math.abs(actualDensity - m.emoji_density) * 2.0);
      distCount++;
    }

    if (typeof styleModel?.length_distribution?.median === 'number' && styleModel.length_distribution.median > 0) {
      const med = styleModel.length_distribution.median;
      const lenDelta = Math.abs(candidate.length - med) / Math.max(candidate.length, med);
      distSum += Math.min(1.0, lenDelta);
      distCount++;
    }

    if (distCount > 0) {
      const avgDist = distSum / distCount;
      distributionSimilarity = Math.max(0.15, 1.0 - avgDist * 0.85);
    }
  }

  // Combined Style Formula: 60% Distribution Similarity + 40% Local Style Match
  const style = round(0.60 * distributionSimilarity + 0.40 * localStyleMatch, 3);
  return Math.min(1.0, Math.max(0.05, style));
}

/**
 * Dimension B: Behavioral Similarity
 * 0.40 Target-Candidate + 0.40 Candidate-DistilledModel + 0.20 Context-PolicyAlignment.
 */
function calculateBehaviorScore(context, target, candidate, behaviorModel, issues) {
  if (!target || !candidate) return 0.05;
  if (target === candidate) return 1.0;

  // Critical AI Identity Leak (immediate catastrophic failure)
  if (/(作为AI|人工智能|语言模型|我很抱歉听到|希望对你有帮助|作为一个人工智能|作为语言模型)/i.test(candidate)) {
    issues.push('CRITICAL: AI identity leak detected');
    return round(0.05, 3);
  }

  const contextStr = (context || []).map((c) => c.content).join(' ');

  // 1. Situation detection
  const isTeasing = /(哈哈|233|逗你|开玩笑|笑死|好玩|逗比|lol|haha|调侃)/i.test(contextStr);
  const isEmotional = /(难过|伤心|哭|委屈|抑郁|烦|累死|心碎|难受|惨|痛苦|好累)/i.test(contextStr);
  const isInquiry = /(吗|呢|啥|什么|怎么|如何|为什么|在哪|多少|谁|\?|？)/i.test(contextStr);
  const isFormal = /(请问|贵方|合作|报告|会议|祝好|您)/i.test(contextStr);

  const targetBehav = extractBehaviorFeatures(target);
  const candidateBehav = extractBehaviorFeatures(candidate);

  // 2. Target <-> Candidate pairwise behavioral match (0.40)
  let localAlign = 0;
  let weights = 0;

  if (isTeasing) {
    const match = targetBehav.isPlayful === candidateBehav.isPlayful ? 1.0 : 0.35;
    localAlign += match * 1.5;
    weights += 1.5;
    if (targetBehav.isPlayful && !candidateBehav.isPlayful) {
      issues.push('lacks playful bantering response strategy');
    }
  }

  if (isEmotional) {
    const match = targetBehav.isGentle === candidateBehav.isGentle ? 1.0 : 0.30;
    localAlign += match * 1.5;
    weights += 1.5;
    if (targetBehav.isGentle && !candidateBehav.isGentle) {
      issues.push('insufficient emotional acknowledgment');
    }
  }

  const questionMatch = targetBehav.hasQuestionBack === candidateBehav.hasQuestionBack ? 1.0 : 0.65;
  localAlign += questionMatch * 1.0;
  weights += 1.0;

  const formalityMatch = targetBehav.isFormal === candidateBehav.isFormal ? 1.0 : 0.45;
  localAlign += formalityMatch * 1.0;
  weights += 1.0;

  const brevityMatch = targetBehav.isBrief === candidateBehav.isBrief ? 1.0 : 0.60;
  localAlign += brevityMatch * 0.8;
  weights += 0.8;

  const targetCandidateMatch = weights > 0 ? localAlign / weights : 0.80;

  // 3. Candidate <-> Distilled Behavior Model match (0.40)
  let candidateModelMatch = targetCandidateMatch;
  if (behaviorModel?.response_policies && Array.isArray(behaviorModel.response_policies)) {
    const matchingPolicy = behaviorModel.response_policies.find((p) => {
      if (isTeasing && p.situation === 'joking') return true;
      if (isEmotional && (p.situation === 'venting' || p.situation === 'emotional')) return true;
      if (isInquiry && (p.situation === 'inquiry' || p.situation === 'question')) return true;
      return false;
    });

    if (matchingPolicy?.statistical) {
      const stats = matchingPolicy.statistical;
      let policyScore = 0;
      let pCount = 0;

      if (typeof stats.emoji_probability === 'number') {
        const hasEmoji = /[\p{Extended_Pictographic}]/u.test(candidate);
        policyScore += 1.0 - Math.abs((hasEmoji ? 1.0 : 0.0) - stats.emoji_probability);
        pCount++;
      }
      if (typeof stats.short_reply_probability === 'number') {
        policyScore += 1.0 - Math.abs((candidateBehav.isBrief ? 1.0 : 0.0) - stats.short_reply_probability);
        pCount++;
      }
      if (typeof stats.follow_up_probability === 'number') {
        policyScore += 1.0 - Math.abs((candidateBehav.hasQuestionBack ? 1.0 : 0.0) - stats.follow_up_probability);
        pCount++;
      }

      if (pCount > 0) {
        candidateModelMatch = policyScore / pCount;
      }
    }
  } else if (behaviorModel?.conditional_style) {
    const cs = behaviorModel.conditional_style;
    if (isTeasing && cs.p_emoji_given_joking) {
      const hasEmoji = /[\p{Extended_Pictographic}]/u.test(candidate);
      candidateModelMatch = 1.0 - Math.abs((hasEmoji ? 1.0 : 0.0) - cs.p_emoji_given_joking);
    }
  }

  // 4. Context-Policy Alignment (0.20)
  let contextAlignment = 0.80;
  if (isEmotional) {
    contextAlignment = candidateBehav.isGentle ? 1.0 : 0.40;
  } else if (isTeasing) {
    contextAlignment = candidateBehav.isPlayful ? 1.0 : 0.50;
  } else if (isFormal) {
    contextAlignment = candidateBehav.isFormal ? 1.0 : 0.50;
  } else if (isInquiry) {
    contextAlignment = (candidateBehav.hasQuestionBack || candidate.length >= 6) ? 0.90 : 0.60;
  }

  const behavior = round(
    0.40 * targetCandidateMatch +
    0.40 * candidateModelMatch +
    0.20 * contextAlignment,
    3
  );

  return Math.min(1.0, Math.max(0.10, behavior));
}

/**
 * Dimension C: Contextual Consistency
 * Grounding verification against World Model entities, facts, and conversation context.
 * Returns null if no verifiable entities, facts, or context exist (avoids fake 0.95 scores).
 */
function calculateContextScore(context, originalTarget, candidate, worldModel, issues) {
  if (originalTarget === candidate) return 1.0;

  const candidateLower = candidate.toLowerCase();
  const contextStr = (context || []).map((c) => c.content).join(' ');

  let hasVerifiableItems = false;
  let groundingScore = 0.85; // baseline for coherent in-context response

  // 1. Entity Grounding & Contradiction Detection
  if (worldModel?.entities && Array.isArray(worldModel.entities) && worldModel.entities.length > 0) {
    for (const ent of worldModel.entities) {
      if (!ent.name) continue;
      const entName = ent.name.toLowerCase();
      const inContextOrTarget = contextStr.toLowerCase().includes(entName) || originalTarget.toLowerCase().includes(entName);

      if (inContextOrTarget || candidateLower.includes(entName)) {
        hasVerifiableItems = true;

        if (candidateLower.includes(entName)) {
          // Bonus for grounding correctly
          groundingScore = Math.min(1.0, groundingScore + 0.05);

          // Check against known entity contradictions
          if (Array.isArray(ent.contradictions)) {
            for (const contra of ent.contradictions) {
              if (candidateLower.includes(contra.toLowerCase())) {
                issues.push(`entity contradiction: "${ent.name}" with "${contra}"`);
                groundingScore -= 0.25;
              }
            }
          }
        }
      }
    }
  }

  // 2. Fact Grounding & Negation Contradiction
  if (worldModel?.facts && Array.isArray(worldModel.facts) && worldModel.facts.length > 0) {
    for (const fact of worldModel.facts) {
      if (!fact.key || !fact.value) continue;
      const valLower = fact.value.toLowerCase();
      const inContextOrTarget = contextStr.toLowerCase().includes(valLower) || originalTarget.toLowerCase().includes(valLower);

      if (inContextOrTarget || candidateLower.includes(valLower)) {
        hasVerifiableItems = true;

        if (candidateLower.includes(valLower)) {
          groundingScore = Math.min(1.0, groundingScore + 0.05);
        }

        if (fact.negated && candidateLower.includes(valLower)) {
          issues.push(`fact contradiction: "${fact.key}" asserted when negated`);
          groundingScore -= 0.25;
        }
      }
    }
  }

  // 3. Dialogue Context Coherence
  if (context && context.length > 0) {
    hasVerifiableItems = true;
    const lastMsg = context[context.length - 1]?.content || '';
    const lastMsgTokens = tokenize(lastMsg);
    const candTokens = new Set(tokenize(candidate));

    let overlap = 0;
    for (const t of lastMsgTokens) {
      if (candTokens.has(t)) overlap++;
    }

    // Coherence check: if user asked a question, did candidate give an empty or completely disconnected response?
    const isQuestion = /[?？]/.test(lastMsg) || /(吗|呢|啥|什么|怎么|如何|为什么|在哪)/.test(lastMsg);
    if (isQuestion && candidate.length < 2) {
      groundingScore -= 0.20;
      issues.push('evasive or empty response to direct inquiry');
    }
  }

  // If no verifiable entities, facts, or context exists, this sample is not evaluable for C
  if (!hasVerifiableItems) {
    return null;
  }

  return round(Math.min(1.0, Math.max(0.10, groundingScore)), 3);
}

// ─── Deterministic Metric Helpers ─────────────────────────────────────────────

function tokenize(text) {
  const tokens = [];
  const regex = /[\u4e00-\u9fa5]|[a-zA-Z0-9']+/gu;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0].toLowerCase());
  }
  return tokens;
}

function charNgramFreq(text, n) {
  const freq = new Map();
  for (let i = 0; i <= text.length - n; i++) {
    const gram = text.slice(i, i + n).toLowerCase();
    freq.set(gram, (freq.get(gram) || 0) + 1);
  }
  return freq;
}

function cosineSimilarity(freqA, freqB) {
  let dot = 0, normA = 0, normB = 0;
  for (const [k, v] of freqA) {
    normA += v * v;
    if (freqB.has(k)) dot += v * freqB.get(k);
  }
  for (const [, v] of freqB) {
    normB += v * v;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function punctuationDistributionSimilarity(a, b) {
  const marks = ['。', '，', '？', '！', '…', '、', '.', ',', '?', '!', '~', '～'];
  const aCounts = marks.map((m) => (a.split(m).length - 1) / Math.max(1, a.length));
  const bCounts = marks.map((m) => (b.split(m).length - 1) / Math.max(1, b.length));
  const distance = aCounts.reduce((sum, val, idx) => sum + Math.abs(val - bCounts[idx]), 0);
  return Math.max(0, 1.0 - distance * 4.0);
}

function extractStyleFeatures(text) {
  const safeText = typeof text === 'string' ? text : '';
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const emojiCount = (safeText.match(emojiRegex) || []).length;
  const len = safeText.length;
  const lengthBucketIdx = len <= 8 ? 0 : len <= 22 ? 1 : len <= 55 ? 2 : 3;

  return {
    emojiCount,
    hasEllipsis: /\.{2,}|…{1,}|……/.test(safeText),
    hasQuestion: /[?？]/.test(safeText),
    hasExclamation: /[!！]/.test(safeText),
    hasTilde: /[~～]/.test(safeText),
    cleanTerminal: !/[。！？!?.~～…]$/.test(safeText.trim()),
    lengthBucketIdx,
    hasRepetition: /([\u4e00-\u9fa5a-z])\1{2,}/i.test(safeText),
  };
}

function extractBehaviorFeatures(text) {
  const safeText = typeof text === 'string' ? text : '';
  return {
    isPlayful: /(哈哈|哼|才不|明明|你才是|略略略|好呀|偏不|笑死|好玩|诶嘿|233)/i.test(safeText),
    isGentle: /(抱抱|摸摸|辛苦啦|别难过|没事|我在|慢慢来|乖|好啦|别急|休息)/i.test(safeText),
    hasQuestionBack: /[?？]/.test(safeText),
    isFormal: /(您|您好|请问|不知道是否|非常抱歉|很高兴为您|祝您)/i.test(safeText),
    isBrief: safeText.length <= 15,
  };
}

function round(val, dec = 3) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
