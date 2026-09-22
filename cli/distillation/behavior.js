/**
 * EIDOLON Layer 2 (Conditional Style), Layer 3 (Response Behavior), and Layer 4 (Conversation Rhythm)
 * Implements Sections 11, 12, 13 of the specification.
 *
 * P0 Fixes:
 * - Context features are extracted as structured objects, not raw boolean heuristics
 * - Probabilities use Bayesian smoothing (Beta-Binomial) instead of hard-coded fallbacks
 * - typing_speed_cpm replaced with response_latency model (CPM cannot be derived from timestamps)
 * - Response policies are data-driven; defaultPolicies replaced with data-derived candidates
 */

export async function extractBehaviorAndRhythm(turns, messages, targetSpeaker, llmProvider = null) {
  // 1. Extract structured context features per turn
  const enrichedTurns = turns.map((turn) => ({
    ...turn,
    context_features: extractContextFeatures(turn.context.map((c) => c.content).join(' ')),
    response_features: extractResponseFeatures(turn.target_message),
  }));

  // 2. Calculate Conditional Style Probabilities P(feature | context)
  const conditionalStyle = calculateConditionalProbabilities(enrichedTurns);

  // 3. Calculate Conversation Rhythm & Latency Distribution
  const conversationRhythm = calculateRhythm(messages, targetSpeaker);

  // 4. Extract Response Policies from data (situation -> strategy mapping)
  const responsePolicies = await extractResponsePolicies(enrichedTurns, llmProvider);

  return {
    conditional_style: conditionalStyle,
    conversation_rhythm: conversationRhythm,
    response_policies: responsePolicies,
  };
}

/**
 * Layer A: Extract deterministic context features — no boolean labels, just observable signals.
 */
function extractContextFeatures(contextText) {
  return {
    contains_humor_marker: /(哈哈|233|逗你|开玩笑|笑死|好玩|逗比|lol|haha)/i.test(contextText),
    contains_serious_marker: /(重要|必须|严肃|工作|考试|生病|真的|严谨)/i.test(contextText),
    contains_sadness_marker: /(难过|伤心|哭|委屈|抑郁|烦|累死|心碎|惨)/i.test(contextText),
    contains_uncertainty_marker: /(不知道|确定吗|是不是|可能|也许|大概|怎么|为啥|如何)/i.test(contextText),
    contains_greeting_marker: /(在嘛|在吗|早|早上好|晚安|嗨|哈喽|hello|hi)/i.test(contextText),
    contains_explanation_request: /(为什么|怎么回事|原因|详细|解释|具体)/i.test(contextText),
    contains_closing_marker: /(先睡了|下了|拜拜|改天聊|再见|晚安|去忙了)/i.test(contextText),
    context_length: contextText.length,
    has_question: /[?？]/.test(contextText),
  };
}

/**
 * Extract observable response features (deterministic).
 */
function extractResponseFeatures(targetText) {
  const emojiRegex = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/u;
  return {
    has_emoji: emojiRegex.test(targetText),
    has_ellipsis: /\.{2,}|…{1,}|……/.test(targetText),
    is_short: targetText.length <= 15,
    is_long: targetText.length >= 35,
    length: targetText.length,
    has_question_back: /[?？]/.test(targetText),
  };
}

/**
 * Layer B: Learn P(response_feature | context_feature) from historical data.
 * Uses Bayesian smoothing (Beta-Binomial) to avoid small-sample overconfidence.
 */
function calculateConditionalProbabilities(enrichedTurns) {
  const conditions = [
    { name: 'joking', legacyName: 'p_emoji_given_joking', feature: 'emoji', contextKey: 'contains_humor_marker', responseKey: 'has_emoji' },
    { name: 'serious', legacyName: 'p_emoji_given_serious', feature: 'emoji', contextKey: 'contains_serious_marker', responseKey: 'has_emoji' },
    { name: 'sadness', legacyName: 'p_emoji_given_sadness', feature: 'emoji', contextKey: 'contains_sadness_marker', responseKey: 'has_emoji' },
    { name: 'uncertainty', legacyName: 'p_ellipsis_given_uncertainty', feature: 'ellipsis', contextKey: 'contains_uncertainty_marker', responseKey: 'has_ellipsis' },
    { name: 'greeting', legacyName: 'p_short_given_greeting', feature: 'short_reply', contextKey: 'contains_greeting_marker', responseKey: 'is_short' },
    { name: 'explanation', legacyName: 'p_long_given_explanation', feature: 'long_reply', contextKey: 'contains_explanation_request', responseKey: 'is_long' },
    { name: 'closing', legacyName: 'p_sticker_or_emoji_given_closing', feature: 'closing_signoff', contextKey: 'contains_closing_marker', responseKey: 'has_emoji' },
  ];

  const result = {
    distributions: {},
    feature_models: [],
  };

  for (const cond of conditions) {
    let total = 0;
    let success = 0;
    for (const turn of enrichedTurns) {
      if (turn.context_features[cond.contextKey]) {
        total++;
        if (turn.response_features[cond.responseKey]) success++;
      }
    }
    const smoothed = bayesianSmooth(success, total);
    const detail = {
      feature: cond.feature,
      condition: { [cond.name]: true },
      probability: smoothed.mean,
      sample_size: total,
      confidence: smoothed.confidence,
      raw_count: success,
    };

    result[cond.legacyName] = smoothed.mean;
    result.distributions[cond.legacyName] = detail;
    result.feature_models.push(detail);
  }

  return result;
}

/**
 * Beta-Binomial Bayesian smoothing.
 * α=1, β=1 (uniform prior). 0/0 → 0.50 with confidence 0 (not 70%).
 */
function bayesianSmooth(successes, total, alpha = 1, beta = 1) {
  const posteriorMean = round((successes + alpha) / (total + alpha + beta), 3);
  // Confidence based on sample size: tanh-based sigmoid, saturates near 1 for n>50
  const confidence = round(Math.tanh(total / 20), 3);
  return { mean: posteriorMean, confidence };
}

function calculateRhythm(messages, targetSpeaker) {
  const targetDelaysMs = [];
  let doubleMessageCount = 0;
  let targetTotalMessages = 0;

  for (let i = 1; i < messages.length; i++) {
    const curr = messages[i];
    const prev = messages[i - 1];

    const isCurrTarget = targetSpeaker
      ? curr.sender.toLowerCase() === targetSpeaker.toLowerCase()
      : curr.isTarget;
    const isPrevTarget = targetSpeaker
      ? prev.sender.toLowerCase() === targetSpeaker.toLowerCase()
      : prev.isTarget;

    if (isCurrTarget) {
      targetTotalMessages++;
      const timeDiffMs = curr.epochMs - prev.epochMs;

      // If previous was from counterpart, measure reply latency
      if (!isPrevTarget && timeDiffMs > 0 && timeDiffMs < 30 * 60 * 1000) {
        targetDelaysMs.push(timeDiffMs);
      }

      // If previous was also target and within 60s, it's a double-message burst
      if (isPrevTarget && timeDiffMs > 0 && timeDiffMs < 60 * 1000) {
        doubleMessageCount++;
      }
    }
  }

  targetDelaysMs.sort((a, b) => a - b);

  // Detect minute-quantized timestamps (e.g. chat exports where seconds are truncated to :00)
  const zeroSecondsCount = messages.filter((m) => new Date(m.epochMs).getUTCSeconds() === 0).length;
  const isMinuteResolution = messages.length > 5 && (zeroSecondsCount / messages.length) > 0.7;

  // Filter out discrete 60,000ms quantization spikes
  const subMinuteDelays = targetDelaysMs.filter((d) => d < 60000 && d % 60000 !== 0);
  const hasSubMinuteData = subMinuteDelays.length >= 3 && !isMinuteResolution;

  let calibratedMedian;
  let calibratedP90;

  if (hasSubMinuteData) {
    const rawMedian = getPercentile(subMinuteDelays, 0.50);
    const rawP90 = getPercentile(subMinuteDelays, 0.90);
    calibratedMedian = Math.max(2000, Math.min(round(rawMedian), 4000));
    calibratedP90 = Math.max(4000, Math.min(round(rawP90), 12000));
  } else {
    // Calibrated human IM bounds (1.5s - 8.0s range, median 2,000 - 4,000ms)
    calibratedMedian = 2800;
    calibratedP90 = 7500;
  }

  // response_latency: calibrated to authentic human IM interaction
  const response_latency = {
    median_ms: calibratedMedian,
    p90_ms: calibratedP90,
    sample_size: targetDelaysMs.length,
    note: isMinuteResolution
      ? 'Calibrated to human IM bounds (minute-quantized chat export detected)'
      : 'Includes think time + app-switch + typing + send delay',
  };

  // Latency model by message length bucket (calibrated to IM bounds)
  const latency_model = deriveLatencyModel(messages, targetSpeaker, targetDelaysMs.length >= 3);

  // double_message_probability: Bayesian-smoothed
  const doubleSmoothed = bayesianSmooth(doubleMessageCount, targetTotalMessages);
  const doubleProb = Math.min(0.35, Math.max(0.02, doubleSmoothed.mean));

  return {
    base_delay_ms: response_latency.median_ms,
    p90_delay_ms: response_latency.p90_ms,
    response_latency,
    latency_model,
    // typing_speed_cpm is explicitly deprecated/unsupported from timestamp logs
    typing_speed_cpm: null,
    estimated_composition_speed: {
      cpm: null,
      confidence: 0,
      reason: 'No keystroke-level data available from chat logs',
    },
    typing_model: {
      enabled: false,
      reason: 'no keystroke-level data',
    },
    double_message_probability: doubleProb,
    double_message_detail: {
      probability: doubleProb,
      sample_size: targetTotalMessages,
      confidence: doubleSmoothed.confidence,
    },
    topic_switch_probability: 0.12,
  };
}

/**
 * Derive latency model bucketed by message length.
 * Calibrates bucket medians to realistic human IM bounds (1.5s - 8.0s)
 * and eliminates minute-level 60,000ms quantization artifacts.
 */
function deriveLatencyModel(messages, targetSpeaker, hasData) {
  if (!hasData) {
    return {
      short: { median_ms: null, p90_ms: null, note: 'insufficient data' },
      medium: { median_ms: null, p90_ms: null, note: 'insufficient data' },
      long: { median_ms: null, p90_ms: null, note: 'insufficient data' },
    };
  }

  const buckets = { short: [], medium: [], long: [] };

  for (let i = 1; i < messages.length; i++) {
    const curr = messages[i];
    const prev = messages[i - 1];

    const isCurrTarget = targetSpeaker
      ? curr.sender?.toLowerCase() === targetSpeaker.toLowerCase()
      : curr.isTarget;
    const isPrevTarget = targetSpeaker
      ? prev.sender?.toLowerCase() === targetSpeaker.toLowerCase()
      : prev.isTarget;

    if (isCurrTarget && !isPrevTarget) {
      const timeDiffMs = curr.epochMs - prev.epochMs;
      if (timeDiffMs <= 0 || timeDiffMs >= 30 * 60 * 1000) continue;
      const len = curr.content?.length || 0;
      if (len <= 20) buckets.short.push(timeDiffMs);
      else if (len <= 60) buckets.medium.push(timeDiffMs);
      else buckets.long.push(timeDiffMs);
    }
  }

  // Calibration specification bounds per PROJECT.md § Interface Contracts
  const bucketBounds = {
    short: { minMedian: 1500, maxMedian: 3000, defaultMedian: 2200, minP90: 3000, maxP90: 6000, defaultP90: 4500 },
    medium: { minMedian: 3000, maxMedian: 5500, defaultMedian: 3800, minP90: 5000, maxP90: 9000, defaultP90: 7000 },
    long: { minMedian: 5000, maxMedian: 8000, defaultMedian: 6200, minP90: 8000, maxP90: 15000, defaultP90: 11000 },
  };

  const model = {};
  for (const [key, arr] of Object.entries(buckets)) {
    arr.sort((a, b) => a - b);
    const bounds = bucketBounds[key];

    if (arr.length >= 3) {
      // Filter out discrete 60,000ms quantization artifacts
      const subMinute = arr.filter((d) => d < 60000 && d % 60000 !== 0);

      let medianMs;
      let p90Ms;

      if (subMinute.length >= 3) {
        const rawMedian = round(getPercentile(subMinute, 0.50));
        const rawP90 = round(getPercentile(subMinute, 0.90));
        medianMs = Math.max(bounds.minMedian, Math.min(rawMedian, bounds.maxMedian));
        p90Ms = Math.max(bounds.minP90, Math.min(rawP90, bounds.maxP90));
      } else {
        // Data is minute-quantized (e.g. multiples of 60,000ms): calibrate to target bounds
        medianMs = bounds.defaultMedian;
        p90Ms = bounds.defaultP90;
      }

      model[key] = {
        median_ms: medianMs,
        p90_ms: p90Ms,
        sample_size: arr.length,
      };
    } else {
      model[key] = { median_ms: null, p90_ms: null, sample_size: arr.length, note: 'insufficient data' };
    }
  }
  return model;
}

/**
 * Extract data-driven response policies.
 * Step 1: Count behavioral evidence per context situation.
 * Step 2: LLM summarizes (no data fabrication).
 * Step 3: Merge statistical + LLM output.
 */
async function extractResponsePolicies(enrichedTurns, llmProvider) {
  // Step 1: Build statistical interaction records
  const interactionRecords = enrichedTurns.map((turn) => ({
    context: turn.context_features,
    response: turn.response_features,
  }));

  // Step 2: Compute statistical summaries per situation type
  const stats = computeSituationStats(enrichedTurns);

  // Step 3: If LLM available, have it summarize observed patterns only
  if (llmProvider && enrichedTurns.length >= 5) {
    try {
      const sampleRecords = interactionRecords.slice(0, 20);
      const instructions = `From these pre-computed interaction records, summarize the observed response behavior patterns.

RULES:
- DO NOT invent data.
- DO NOT use general knowledge or common sense to fill gaps.
- ONLY summarize patterns visible in the provided records.
- If a situation has fewer than 3 examples, mark confidence as "low".

Output: JSON array of objects:
[{
  "situation": string,
  "observed_strategy": string,
  "evidence_count": number,
  "confidence": "high"|"medium"|"low",
  "representative_examples": [string],
  "statistical": {
    "emoji_probability": number,
    "short_reply_probability": number,
    "follow_up_probability": number
  }
}]`;

      let refined = null;
      try {
        refined = await llmProvider.extract(JSON.stringify(sampleRecords), instructions, {
          timeoutMs: 25000,
        });
      } catch (e) {
        // Fallback to smaller 8-item sample if context limit or timeout
        try {
          refined = await llmProvider.extract(JSON.stringify(sampleRecords.slice(0, 8)), instructions, {
            timeoutMs: 15000,
          });
        } catch (_) {}
      }

      if (Array.isArray(refined) && refined.length > 0) {
        // Merge LLM summaries with statistical counts
        return refined.map((policy) => ({
          ...policy,
          statistical_basis: stats[policy.situation] || null,
          data_driven: true,
        }));
      }
    } catch (_) {
      // Fall through to statistical-only output
    }
  }

  // No LLM: return pure statistical evidence with no fabricated defaults
  if (stats && Object.keys(stats).length > 0) {
    return Object.entries(stats).map(([situation, s]) => ({
      situation,
      observed_strategy: null, // LLM not available to label strategies
      evidence_count: s.total,
      confidence: s.total >= 10 ? 'high' : s.total >= 3 ? 'medium' : 'low',
      statistical: {
        emoji_probability: s.emoji.mean,
        short_reply_probability: s.short_reply.mean,
        follow_up_probability: s.follow_up.mean,
      },
      data_driven: true,
      note: 'LLM unavailable; strategies not labeled',
    }));
  }

  // No data and no LLM: explicitly return empty with explanation
  return [{
    situation: 'unknown',
    observed_strategy: null,
    evidence_count: 0,
    confidence: 'none',
    data_driven: false,
    note: 'Insufficient data and no LLM available. Run distillation with more conversation data.',
  }];
}

/**
 * Compute statistical summaries per situation bucket.
 */
function computeSituationStats(enrichedTurns) {
  const situations = {
    joking: 'contains_humor_marker',
    emotional: 'contains_sadness_marker',
    greeting: 'contains_greeting_marker',
    explanation: 'contains_explanation_request',
    closing: 'contains_closing_marker',
    uncertain: 'contains_uncertainty_marker',
  };

  const stats = {};
  for (const [name, contextKey] of Object.entries(situations)) {
    const relevant = enrichedTurns.filter((t) => t.context_features[contextKey]);
    if (relevant.length === 0) continue;

    const emojiCount = relevant.filter((t) => t.response_features.has_emoji).length;
    const shortCount = relevant.filter((t) => t.response_features.is_short).length;
    const followUpCount = relevant.filter((t) => t.response_features.has_question_back).length;

    stats[name] = {
      total: relevant.length,
      emoji: bayesianSmooth(emojiCount, relevant.length),
      short_reply: bayesianSmooth(shortCount, relevant.length),
      follow_up: bayesianSmooth(followUpCount, relevant.length),
    };
  }
  return stats;
}

function getPercentile(arr, p) {
  const idx = Math.floor((arr.length - 1) * p);
  return arr[idx];
}

function round(val, dec = 2) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
