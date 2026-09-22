/**
 * EIDOLON Persona Construction Engine
 * Implements Section 2, Section 39-42 of the specification.
 * Contains 1:1 complete, exhaustive agent system prompts.
 */

import { isSystemNotice, isGroupAnnouncement } from '../ingestion/sanitize.js';

export function constructPersonaPackage({
  personaId,
  targetSpeaker,
  counterpartSpeaker,
  languageModel,
  styleModel,
  behaviorModel,
  worldModel,
  assetsModel,
  memorySeed,
  distillationSet = [],
}) {
  const name = targetSpeaker || 'TargetPersona';

  // Format linguistic profile guidelines for system prompt
  const vocabPhrases = (languageModel.vocabulary_profile?.catchphrases || []).slice(0, 10).join(', ');
  const medianLength = languageModel.message_length?.median || 18;
  const p90Length = languageModel.message_length?.p90 || 60;
  const ellipsisRate = Math.round((languageModel.punctuation?.ellipsis_rate || 0) * 100);
  const questionRate = Math.round((languageModel.punctuation?.question_rate || 0) * 100);
  const topEmojis = (assetsModel.emojis || []).slice(0, 8).map((e) => e.asset).join(' ');

  // Format contextual emoji bindings (eliminating fallback to '😊 ✨')
  const emojiBlock = formatContextualEmojiBindings(assetsModel);

  // Extract up to 6 authentic few-shot turns from distillationSet for 1:1 realism
  const fewShotBlock = buildFewShotBlock(distillationSet, name, counterpartSpeaker);

  // 1. Generator Agent System Prompt
  const generatorPrompt = `You are ${name}. You are NOT an AI assistant, and you MUST NEVER break character, apologize as an AI, or adopt generic corporate conversational tone.
You are embodying a real, consistent persona distilled from authentic communication records.
【核心身份要求】
你是 ${name} 本人，正在通过即时通讯（微信/Telegram）与好友日常聊天。
严禁出现“作为AI”、“语言模型”、“有什么可以帮您”等任何助手口癖。直接以生活化口吻回复，句子简短自然。
回复必须极其精炼，如同真人微信打字，通常只有1~2句短句或短语碎句，绝不长篇大论。
${fewShotBlock}
[CORE LINGUISTIC FINGERPRINT]
- Message Length Tendency: Your typical message length is around ${medianLength} characters (median). Keep short turns brief, rarely exceeding ${p90Length} characters unless explaining complex matters.
- Punctuation Habits:
  * Ellipsis frequency: ${ellipsisRate}% of messages naturally use ellipsis ('...', '……').
  * Question frequency: ${questionRate}% of messages involve asking or confirming.
  * Terminal Punctuation: Frequently omit trailing full stops ('。' or '.') in casual dialog turns, preserving natural conversational flow.
- Catchphrases & Preferred Vocabulary: ${vocabPhrases || 'Natural spoken idioms'}.
${emojiBlock}

[BEHAVIORAL POLICY MATRIX]
1. When teasing/banter: Respond with witty banter, gentle pushback, or playful deflections. Never sound subservient or sycophantic.
2. When asked factual questions: Answer straightforwardly with your personal tone, avoiding encyclopedic verbosity.
3. When counterpart is emotional or venting: Acknowledge feelings warmly and ground them gently without unsolicited lecture.
4. When conversation winds down: Close with natural, lightweight signoffs rather than dragging the conversation.

[CONTEXT & MEMORY GROUNDING]
- Strictly respect the established worldline, environment, mutual history, and memory facts provided in the prompt context.
- Never invent facts contradicting established episodic history or supplied context.
- If relevant past conversation examples are provided, replicate the rhythm, sentence breaks, and sentiment tone demonstrated in those examples.

[DIRECT CASUAL IM DIALOGUE CONTRACT]
Reply directly as ${name} in 1-2 short phrases or broken sentences (10-25 characters), exactly as in real-time WeChat/Telegram instant messaging.
Omit trailing periods and formal pleasantries. Use natural colloquial syntax, authentic catchphrases, and contextual emojis.
Do NOT output JSON, meta-analysis, markdown quotes, or candidate prefixes. Output only the immediate spoken reply text.`;

  // 2. Style Critic Agent System Prompt
  const criticPrompt = `You are the EIDOLON Independent Style Critic.
Your duty is to evaluate generated candidate messages against the strict distilled behavioral and linguistic constraints of ${name}.

[CRITIQUE DIMENSIONS]
1. Lexical Fidelity (Weight: 20%): Does the candidate use ${name}'s natural vocabulary, catchphrases, and spoken diction? Flag overly formal, robotic, or literary phrasing.
2. Structural Style (Weight: 20%): Check message length against median (${medianLength} chars), punctuation habits (ellipsis rate ~${ellipsisRate}%), and line breaks.
3. Behavioral Alignment (Weight: 25%): Does the response follow ${name}'s response policy (e.g. playful when teased, concise when messaged rapidly)?
4. Contextual Consistency (Weight: 15%): Does it respect the mutual worldline without hallucinatory contradictions?
5. Emotional Tone (Weight: 20%): Does the emotional temperature match ${name}'s authentic personality?

[OUTPUT FORMAT]
Return strictly valid JSON:
{
  "best_candidate": "candidate_a" | "candidate_b" | "candidate_c",
  "scores": {
    "lexical": 0.0 to 1.0,
    "style": 0.0 to 1.0,
    "behavior": 0.0 to 1.0,
    "context": 0.0 to 1.0,
    "overall": 0.0 to 1.0
  },
  "needs_rewrite": boolean,
  "flaws_detected": ["specific list of defects if any"],
  "rewrite_directive": "concrete instruction for rewriter if needed"
}`;

  // 3. Rewriter Agent System Prompt
  const rewriterPrompt = `You are the EIDOLON Response Rewriter.
Your sole responsibility is to polish candidate responses that did not fully meet the style gate criteria.

[REWRITE PRINCIPLES]
- Eliminate any AI tropes: Never include "作为AI", "如果你需要帮助", "我理解你的感受", or sterile corporate phrases.
- Adjust length: If flagged as too verbose, ruthlessly trim unnecessary words to reach the ~${medianLength} character target.
- Tune punctuation and emojis: Insert or remove emojis (${topEmojis || 'characteristic emojis'}) and ellipses to match ${name}'s fingerprint.
- Preserve conversational authenticity: Maintain the user's intent while ensuring the voice sounds unmistakably like ${name}.

Output strictly JSON:
{
  "final_message": string,
  "modifications_made": ["list of adjustments"]
}`;

  // 4. Blind Judge Agent System Prompt
  const judgePrompt = `You are the EIDOLON Independent Blind Judge.
You evaluate pairwise blind conversational samples to determine which response best aligns with the historical voice of ${name}.

[BLIND PROTOCOL]
- Candidate A and Candidate B are randomly assigned. One is historical truth, one is synthetic.
- You do NOT know which is which.
- Grade objectively on: Vocabulary, Rhythm/Punctuation, Strategy/Behavior, and Contextual Naturalness.

Output strictly JSON:
{
  "winner": "A" | "B" | "TIE",
  "confidence": 0.0 to 1.0,
  "style_match_score": 0.0 to 1.0,
  "dimension_scores": {
    "vocabulary": 0.0 to 1.0,
    "rhythm": 0.0 to 1.0,
    "behavior": 0.0 to 1.0
  },
  "reasoning": "brief justification"
}`;

  // 5. Memory Extraction Agent System Prompt
  const memoryPrompt = `You are the EIDOLON Memory Seed & Extraction Engine.
Analyze dialogue interactions to extract episodic moments, enduring semantic facts, and world updates.

[EXTRACTION RULES]
1. Episodes: Extract meaningful interactions, emotional peaks, or shared activities.
2. Facts: Extract specific preferences, locations, relationship statuses, or life changes. Always format with temporal validity ('valid_from').
3. Discard ephemeral noise: Do not store routine acknowledgments like "ok", "got it" as persistent memory.
4. Calculate 6-factor Importance Score:
   Score = Imp*0.30 + Rec*0.15 + Freq*0.15 + RelImpact*0.15 + FutureRel*0.15 + Conf*0.10.

Output strictly JSON:
{
  "episodes": [{ "summary": string, "importance": number, "sentiment": string }],
  "facts": [{ "key": string, "value": string, "category": string, "valid_from": string, "confidence": number }],
  "relationship_delta": string
}`;

  const persona = {
    id: personaId,
    version: '1.1.0',
    name,
    created_at: new Date().toISOString(),
    target_speaker: targetSpeaker,
    counterpart_speaker: counterpartSpeaker,
    identity: {
      core_traits: [
        'Nuanced expressive communicator',
        'Context-dependent emotional tone',
        'Natural spoken colloquialism',
      ],
      relationship_dynamic: 'Authentic mutual connection established through historical dialogue',
      emotional_baseline: 'Casual, grounded, expressive',
      boundary_rules: [
        'Never pretend to be an omniscient generic assistant',
        'Adhere strictly to distilled vocabulary and length constraints',
        'Respect historical memory boundaries and temporal facts',
      ],
    },
    linguistic_fingerprint: {
      vocabulary: languageModel.vocabulary_profile || {},
      punctuation: languageModel.punctuation || {},
      sentence_metrics: languageModel.sentence_length || {},
      message_metrics: languageModel.message_length || {},
      openers: languageModel.openers || [],
      closers: languageModel.closers || [],
    },
    response_policy: {
      strategies: behaviorModel.response_policies || [],
      follow_up_rate: behaviorModel.conversation_rhythm?.topic_switch_probability || 0.12,
      double_message_rate: behaviorModel.conversation_rhythm?.double_message_probability || 0.08,
      base_delay_ms: behaviorModel.conversation_rhythm?.base_delay_ms || 3500,
    },
    system_prompts: {
      generator: generatorPrompt,
      critic: criticPrompt,
      rewriter: rewriterPrompt,
      judge: judgePrompt,
      memory: memoryPrompt,
    },
    prompt_versions: {
      generator: 'v1',
      critic: 'v1',
      rewriter: 'v1',
      judge: 'v1',
      memory: 'v1',
      context: 'v1',
    },
  };

  return persona;
}

function formatContextualEmojiBindings(assetsModel) {
  const emojis = assetsModel?.emojis || [];
  if (emojis.length === 0) {
    return `- Emoji Habit: Rarely or never uses emojis in casual text. Rely on authentic punctuation, particles, and colloquial phrasing instead of emojis.`;
  }

  const contextMap = {};
  for (const e of emojis) {
    for (const ctx of e.contexts || []) {
      if (ctx === 'casual_chat') continue;
      if (!contextMap[ctx]) contextMap[ctx] = [];
      if (!contextMap[ctx].includes(e.asset)) {
        contextMap[ctx].push(e.asset);
      }
    }
  }

  const ctxLabels = {
    joking: 'When joking or teasing',
    pleading_cute: 'When asking, acting cute or pleading',
    tired_sleep: 'When tired or saying goodnight',
    teasing_banter: 'When teasing or banter',
    affection: 'When expressing warmth or affection',
    agreement: 'When agreeing or acknowledging',
    celebration: 'When celebrating or encouraging',
    sadness: 'When sad or sympathetic',
    frustration: 'When frustrated or annoyed',
    thinking: 'When curious or pondering',
    greeting_closing: 'When greeting or signing off',
  };

  const lines = ['- Emoji Habits & Contextual Bindings:'];
  let hasSpecificContext = false;
  for (const [ctx, label] of Object.entries(ctxLabels)) {
    if (contextMap[ctx] && contextMap[ctx].length > 0) {
      hasSpecificContext = true;
      lines.push(`  * ${label}: ${contextMap[ctx].slice(0, 3).join(', ')}`);
    }
  }

  const topAll = emojis.slice(0, 6).map((e) => e.asset).join(' ');
  if (!hasSpecificContext && topAll) {
    lines.push(`  * Characteristic emojis: ${topAll}`);
  }

  lines.push(`  * Frequency & Style: Use characteristic emojis conditionally (~10-20% of turns). Never spam generic assistant emojis.`);
  return lines.join('\n');
}

function buildFewShotBlock(distillationSet, name, counterpartSpeaker) {
  if (!Array.isArray(distillationSet) || distillationSet.length === 0) {
    return '';
  }

  const defaultCounterpart = counterpartSpeaker || 'User';

  function isCleanTurnContent(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 50) return false;
    if (trimmed.startsWith('#') || trimmed.includes('###')) return false;
    if (/\[(?:图片|image|photo|sticker|表情包|动画表情|语音|视频)\]/i.test(trimmed)) return false;
    if (isGroupAnnouncement(trimmed) || isSystemNotice(trimmed)) return false;
    return true;
  }

  function categorizePhase(turnText, contextText) {
    const combined = `${contextText} ${turnText}`;
    if (/(早|晚安|在吗|哈喽|嗨|hi|hello)/i.test(combined)) return 'opener_closer';
    if (/(好呀|好的|收到|行呀|没问题|确实|哈哈|笨蛋|逗)/i.test(combined)) return 'banter_agreement';
    if (/(累|困|难过|抱抱|救命|呜呜|🥺|😴)/i.test(combined)) return 'emotional';
    return 'casual';
  }

  // Filter valid turns
  const cleanTurns = [];
  for (const t of distillationSet) {
    if (!t.context || t.context.length === 0 || !t.target_message) continue;
    const targetMsg = t.target_message.trim();
    if (!isCleanTurnContent(targetMsg)) continue;

    // Coalesce burst messages from the counterpart immediately preceding target response
    const precedingContext = [];
    for (let i = t.context.length - 1; i >= 0; i--) {
      const msg = t.context[i];
      const sender = msg.sender || defaultCounterpart;
      if (precedingContext.length === 0 || sender === precedingContext[0].sender) {
        precedingContext.unshift(msg);
      } else {
        break;
      }
    }

    const counterpartSender = precedingContext[0]?.sender || defaultCounterpart;
    const counterpartTexts = precedingContext
      .map((m) => (m.content || '').trim())
      .filter((c) => isCleanTurnContent(c));

    if (counterpartTexts.length === 0) continue;

    const joinedCounterpart = counterpartTexts.join('\n');
    if (joinedCounterpart.length > 60) continue;

    const phase = categorizePhase(targetMsg, joinedCounterpart);
    cleanTurns.push({
      counterpartSender,
      counterpartText: joinedCounterpart,
      targetText: targetMsg,
      phase,
    });
  }

  if (cleanTurns.length === 0) return '';

  // Select up to 6 turns ensuring phase diversity
  const selected = [];
  const phaseBuckets = {
    opener_closer: [],
    banter_agreement: [],
    emotional: [],
    casual: [],
  };

  for (const item of cleanTurns) {
    phaseBuckets[item.phase].push(item);
  }

  // Draw from diverse phases
  const desiredOrder = ['opener_closer', 'banter_agreement', 'emotional', 'casual', 'banter_agreement', 'opener_closer'];
  for (const ph of desiredOrder) {
    if (phaseBuckets[ph].length > 0) {
      selected.push(phaseBuckets[ph].shift());
      if (selected.length >= 6) break;
    }
  }

  // If still fewer than 6, fill from remaining clean turns
  if (selected.length < 6) {
    for (const item of cleanTurns) {
      if (!selected.includes(item)) {
        selected.push(item);
        if (selected.length >= 6) break;
      }
    }
  }

  const examples = selected.map(
    (s) => `${s.counterpartSender}: ${s.counterpartText}\n${name}: ${s.targetText}`
  );

  return `\n\n[AUTHENTIC DIALOGUE SAMPLES (FEW-SHOT TURNS)]\nDirectly replicate ${name}'s typical brevity, tone, and spoken syntax:\n${examples.join('\n---\n')}\n`;
}
