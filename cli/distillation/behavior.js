/**
 * EIDOLON Layer 2 (Conditional Style), Layer 3 (Response Behavior), and Layer 4 (Conversation Rhythm)
 * Implements Sections 11, 12, 13 of the specification.
 */

export async function extractBehaviorAndRhythm(turns, messages, targetSpeaker, llmProvider = null) {
  // 1. Calculate Conditional Style Probabilities P(feature | context)
  const conditionalStyle = calculateConditionalProbabilities(turns);

  // 2. Calculate Conversation Rhythm & Latency Distribution
  const conversationRhythm = calculateRhythm(messages, targetSpeaker);

  // 3. Extract Response Policies (Situation -> Strategy mapping)
  const responsePolicies = await extractResponsePolicies(turns, llmProvider);

  return {
    conditional_style: conditionalStyle,
    conversation_rhythm: conversationRhythm,
    response_policies: responsePolicies,
  };
}

function calculateConditionalProbabilities(turns) {
  let jokingTotal = 0, jokingWithEmoji = 0;
  let seriousTotal = 0, seriousWithEmoji = 0;
  let sadTotal = 0, sadWithEmoji = 0;
  let uncertaintyTotal = 0, uncertaintyWithEllipsis = 0;
  let greetingTotal = 0, greetingShort = 0;
  let explanationTotal = 0, explanationLong = 0;
  let closingTotal = 0, closingWithStickerOrEmoji = 0;

  for (const turn of turns) {
    const contextText = turn.context.map((c) => c.content).join(' ');
    const targetText = turn.target_message;
    const hasEmoji = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/u.test(targetText);
    const hasEllipsis = /\.{2,}|…{1,}|……/.test(targetText);
    const hasSticker = turn.mediaType === 'sticker' || /\[(表情包|sticker|动画表情)\]/i.test(targetText);

    // Context classification heuristics:
    const isJoking = /(哈哈|233|逗你|开玩笑|笑死|好玩|逗比|lol|haha)/i.test(contextText);
    const isSerious = /(重要|必须|严肃|工作|考试|生病|真的|严谨)/i.test(contextText);
    const isSad = /(难过|伤心|哭|委屈|抑郁|烦|累死|心碎|惨)/i.test(contextText);
    const isUncertain = /(不知道|确定吗|是不是|可能|也许|大概|怎么|为啥|如何)/i.test(contextText);
    const isGreeting = /(在嘛|在吗|早|早上好|晚安|嗨|哈喽|hello|hi)/i.test(contextText);
    const isExplanation = /(为什么|怎么回事|原因|详细|解释|具体)/i.test(contextText);
    const isClosing = /(先睡了|下了|拜拜|改天聊|再见|晚安|去忙了)/i.test(contextText);

    if (isJoking) {
      jokingTotal++;
      if (hasEmoji) jokingWithEmoji++;
    }
    if (isSerious) {
      seriousTotal++;
      if (hasEmoji) seriousWithEmoji++;
    }
    if (isSad) {
      sadTotal++;
      if (hasEmoji) sadWithEmoji++;
    }
    if (isUncertain) {
      uncertaintyTotal++;
      if (hasEllipsis) uncertaintyWithEllipsis++;
    }
    if (isGreeting) {
      greetingTotal++;
      if (targetText.length <= 15) greetingShort++;
    }
    if (isExplanation) {
      explanationTotal++;
      if (targetText.length >= 35) explanationLong++;
    }
    if (isClosing) {
      closingTotal++;
      if (hasSticker || hasEmoji) closingWithStickerOrEmoji++;
    }
  }

  return {
    p_emoji_given_joking: safeRate(jokingWithEmoji, jokingTotal, 0.70),
    p_emoji_given_serious: safeRate(seriousWithEmoji, seriousTotal, 0.15),
    p_emoji_given_sadness: safeRate(sadWithEmoji, sadTotal, 0.35),
    p_ellipsis_given_uncertainty: safeRate(uncertaintyWithEllipsis, uncertaintyTotal, 0.45),
    p_short_given_greeting: safeRate(greetingShort, greetingTotal, 0.85),
    p_long_given_explanation: safeRate(explanationLong, explanationTotal, 0.60),
    p_sticker_or_emoji_given_closing: safeRate(closingWithStickerOrEmoji, closingTotal, 0.65),
  };
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

  // Calculate delay statistics (clamped within realistic interactive chat bounds)
  targetDelaysMs.sort((a, b) => a - b);
  const medianDelayMs = targetDelaysMs.length > 0 ? getPercentile(targetDelaysMs, 0.50) : 3500;
  const p90DelayMs = targetDelaysMs.length > 0 ? getPercentile(targetDelaysMs, 0.90) : 12000;

  const doubleMessageRate =
    targetTotalMessages > 0 ? round(doubleMessageCount / targetTotalMessages, 3) : 0.08;

  // Typing speed estimate (characters per minute, standard human typing 120 - 240 cpm on mobile)
  const typingSpeedCpm = 180;

  return {
    base_delay_ms: Math.max(1200, Math.min(round(medianDelayMs), 8000)),
    p90_delay_ms: Math.max(3000, Math.min(round(p90DelayMs), 25000)),
    typing_speed_cpm: typingSpeedCpm,
    double_message_probability: Math.min(0.35, Math.max(0.02, doubleMessageRate)),
    topic_switch_probability: 0.12,
  };
}

async function extractResponsePolicies(turns, llmProvider) {
  // Standard base situational policy matrix
  const defaultPolicies = [
    {
      situation: 'user_teasing_or_banter',
      strategy: 'playful_retaliation_or_witty_deflection',
      length_bias: 'short',
      emoji_probability: 0.55,
      follow_up_probability: 0.15,
    },
    {
      situation: 'user_factual_inquiry',
      strategy: 'direct_clear_answer_with_brief_comment',
      length_bias: 'medium',
      emoji_probability: 0.18,
      follow_up_probability: 0.25,
    },
    {
      situation: 'user_emotional_venting',
      strategy: 'empathic_acknowledgment_and_gentle_grounding',
      length_bias: 'medium',
      emoji_probability: 0.35,
      follow_up_probability: 0.40,
    },
    {
      situation: 'user_continuous_burst_messages',
      strategy: 'selective_keypoint_reply_concise',
      length_bias: 'short',
      emoji_probability: 0.25,
      follow_up_probability: 0.05,
    },
    {
      situation: 'deep_complex_discussion',
      strategy: 'multi_point_structured_reasoning',
      length_bias: 'long',
      emoji_probability: 0.10,
      follow_up_probability: 0.30,
    },
    {
      situation: 'conversation_closing',
      strategy: 'warm_lightweight_signoff',
      length_bias: 'micro',
      emoji_probability: 0.65,
      follow_up_probability: 0.0,
    },
  ];

  // If LLM provider is available, analyze sample turns to refine behavioral nuance
  if (llmProvider && turns.length >= 5) {
    try {
      const sampleTexts = turns.slice(0, 10).map((t) => ({
        user_context: t.context.map((c) => `${c.sender}: ${c.content}`).join(' | '),
        target_reply: t.target_message,
      }));

      const instructions = `Given these sample dialogue turns from a conversation, extract 4-6 response policy rules.
Format: JSON array of objects: [{ "situation": string, "strategy": string, "length_bias": "micro"|"short"|"medium"|"long", "emoji_probability": number, "follow_up_probability": number }]`;

      const refined = await llmProvider.extract(JSON.stringify(sampleTexts), instructions, {
        timeoutMs: 15000,
      });

      if (Array.isArray(refined) && refined.length > 0) {
        return refined;
      }
    } catch (_) {
      // Fallback to solid statistical default policies
    }
  }

  return defaultPolicies;
}

function safeRate(num, den, fallback) {
  if (!den || den < 2) return fallback;
  return round(num / den, 3);
}

function getPercentile(arr, p) {
  const idx = Math.floor((arr.length - 1) * p);
  return arr[idx];
}

function round(val, dec = 2) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
