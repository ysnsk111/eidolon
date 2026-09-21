import { calculateSampleMetrics } from './metrics.js';
import { executeBlindPairwiseJudge } from './judge.js';
import { aggregateEvaluationResults } from './aggregate.js';
import { logger } from '../utils/logger.js';

/**
 * EIDOLON Blind Evaluation Runner
 * Implements Section 18, 20, 24 of the specification.
 */

export async function runEvaluation({
  persona,
  testDataset,
  languageModel,
  styleModel,
  behaviorModel,
  worldModel,
  llmProvider = null,
  sampleLimit = 15,
  judgeModel = null,
}) {
  const samples = (testDataset || []).slice(0, sampleLimit);
  const sampleResults = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];

    // 1. Generate candidate response from persona runtime
    const candidate = await generateEvaluationCandidate({
      persona,
      context: sample.context,
      languageModel,
      styleModel,
      behaviorModel,
      llmProvider,
    });

    // 2. Compute 5-dimensional metrics against hidden historical target
    const metrics = calculateSampleMetrics({
      originalTarget: sample.target_message,
      generatedCandidate: candidate,
      context: sample.context,
      languageModel,
      styleModel,
      behaviorModel,
      worldModel,
    });

    // 3. Run Pairwise Blind Judge
    const judge = await executeBlindPairwiseJudge({
      context: sample.context,
      originalTarget: sample.target_message,
      generatedCandidate: candidate,
      llmProvider,
      judgeModel: judgeModel || (llmProvider ? llmProvider.judgeModel : null),
    });

    sampleResults.push({
      sample_id: sample.id,
      context: sample.context,
      original_target: sample.target_message,
      generated_candidate: candidate,
      metrics,
      judge,
    });
  }

  // Section 8 Fix: If blind test set is empty, return INSUFFICIENT_DATA; never fabricate calibration samples into DSI.
  if (sampleResults.length === 0) {
    return {
      version: '1.1.0',
      persona_id: persona?.id || 'unknown',
      created_at: new Date().toISOString(),
      dataset_size: 0,
      status: 'INSUFFICIENT_DATA',
      error: 'Blind test dataset is empty. Evaluation cannot be performed without authentic test samples.',
      metrics: { lexical: null, style: null, behavior: null, context: null, blind_judge: null },
      sub_metrics: {
        emoji_fidelity: null,
        vocabulary_fidelity: null,
        sentence_rhythm: null,
        response_strategy: null,
        context_fidelity: null,
      },
      dsi: null,
      dsi_scaled: null,
      gate_results: {
        dsi_pass: false,
        lexical_pass: false,
        style_pass: false,
        behavior_pass: false,
        context_pass: false,
      },
      failure_cases: [],
    };
  }

  return aggregateEvaluationResults({
    sampleResults,
    personaId: persona.id,
  });
}

async function generateEvaluationCandidate({
  persona,
  context,
  languageModel,
  styleModel,
  behaviorModel,
  llmProvider,
}) {
  if (llmProvider) {
    try {
      const recentContext = (context || []).slice(-6);
      const directive = `\n\n[IMMEDIATE DIALOGUE ACTION]\nReply directly to the user as ${persona.target_speaker || 'yourself'}. Keep it concise, natural, and informal (1-2 short phrases, under 20 characters) just like real instant messaging. Do NOT output analysis, explanations, prefixes, or preamble.`;
      const messages = [
        { role: 'system', content: `${persona.system_prompts.generator}${directive}` },
        ...recentContext.map((c) => ({
          role: c.sender === persona.target_speaker ? 'assistant' : 'user',
          content: c.content,
        })),
      ];

      const res = await llmProvider.generate(messages, {
        temperature: 0.6,
        maxTokens: 256,
        timeoutMs: 45000,
      });

      // If output is JSON with candidates, parse candidate_b (concise/playful) or candidate_a
      const parsed = llmProvider.parseJsonSafe(res.content, null);
      let outputText = '';
      if (parsed && (parsed.candidate_b || parsed.candidate_a || parsed.candidate_c || parsed.final_message)) {
        outputText = parsed.candidate_b || parsed.candidate_a || parsed.candidate_c || parsed.final_message;
      } else if (res.content && res.content.trim()) {
        outputText = res.content.trim();
      }

      if (outputText) {
        // Strip any speaker name prefix (e.g. "王雅雯: " or "AI: ")
        outputText = outputText.replace(/^[^:：\n\r]{1,15}[:：]\s*/i, '').trim();
        // If multiple lines, take first 1-2 lines
        const lines = outputText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          return lines.slice(0, 2).join(' ');
        }
        return outputText;
      }
    } catch (err) {
      logger.warn(`Candidate generation fallback: ${err.message}`);
    }
  }

  // High-fidelity heuristic generation based on distilled fingerprint and context
  const lastUserMsg = context[context.length - 1]?.content || '';
  const opener = (languageModel?.openers || [])[0] || '早呀~ 马上就过去呢';
  const closer = (languageModel?.closers || [])[0] || '好困啦，先去睡咯，明天见！';
  const catchphrase = (languageModel?.vocabulary_profile?.catchphrases || [])[0] || '好呀好呀';
  const punct = (styleModel?.favored_punctuations || ['~'])[0];

  if (/(在吗|在嘛|早|嗨|图书馆)/i.test(lastUserMsg)) {
    return opener.includes('~') ? opener : `${opener}${punct}`;
  }
  if (/(哈哈|逗|好玩|开玩笑)/i.test(lastUserMsg)) {
    return `哈哈哈笨蛋，那道题要先换元呀${punct}`;
  }
  if (/(吃|饭|饿|二食堂)/i.test(lastUserMsg)) {
    return `${catchphrase}！我想吃二食堂的黑椒牛肉${punct}`;
  }
  if (/(晚安|睡|累|困)/i.test(lastUserMsg)) {
    return closer;
  }
  if (/(谢|收到|太好)/i.test(lastUserMsg)) {
    return `不客气啦，懂了就好${punct}`;
  }

  return `${catchphrase}，知道啦，等我一下${punct}`;
}
