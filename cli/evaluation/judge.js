/**
 * EIDOLON Pairwise Independent Blind Judge Engine
 * Implements Section 23 & 24 of the specification.
 *
 * Requirements (P0-7, Section 13):
 * 1. Judge model is decoupled from Generator model (Judge != Generator).
 * 2. Candidates A and B are randomly assigned so the judge remains completely blind.
 * 3. Structured output schema:
 *    {
 *      winner: 'A' | 'B' | 'TIE',
 *      style_similarity: number,
 *      behavior_similarity: number,
 *      context_similarity: number,
 *      confidence: number,
 *      score: number,
 *      reason_codes: string[],
 *      reasoning: string
 *    }
 */

export async function executeBlindPairwiseJudge({
  context,
  originalTarget,
  generatedCandidate,
  llmProvider = null,
  judgeModel = null,
}) {
  // Randomly assign A and B to maintain blind protocol
  const isTargetA = Math.random() >= 0.5;
  const candidateA = isTargetA ? originalTarget : generatedCandidate;
  const candidateB = isTargetA ? generatedCandidate : originalTarget;

  if (llmProvider && typeof llmProvider.judge === 'function') {
    try {
      const parsed = await llmProvider.judge(context, candidateA, candidateB, {
        judgeModel: judgeModel || llmProvider.judgeModel,
      });

      if (parsed && typeof parsed === 'object') {
        const styleSim = typeof parsed.style_similarity === 'number' ? parsed.style_similarity : null;
        const behavSim = typeof parsed.behavior_similarity === 'number' ? parsed.behavior_similarity : null;
        const ctxSim = typeof parsed.context_similarity === 'number' ? parsed.context_similarity : null;

        if (styleSim !== null && behavSim !== null && ctxSim !== null) {
          const favoredGenerated =
            (isTargetA && parsed.winner === 'B') ||
            (!isTargetA && parsed.winner === 'A') ||
            parsed.winner === 'TIE';

          const compositeScore = round(
            styleSim * 0.40 +
            behavSim * 0.35 +
            ctxSim * 0.25,
            3
          );

          return {
            blind_winner: parsed.winner || 'TIE',
            synthetic_is_winner_or_tie: favoredGenerated,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.80,
            score: compositeScore,
            dimension_scores: {
              style_similarity: styleSim,
              behavior_similarity: behavSim,
              context_similarity: ctxSim,
            },
            reason_codes: Array.isArray(parsed.reason_codes) ? parsed.reason_codes : ['completed_blind_evaluation'],
            reason: parsed.rationale || parsed.reason || 'Independent blind LLM judge evaluation completed',
            judge_metadata: {
              blind: true,
              shuffled: true,
              target_position: isTargetA ? 'A' : 'B',
              mode: 'llm_judge',
              judge_model: parsed.judge_model || judgeModel || llmProvider.judgeModel,
            },
          };
        }
      }
    } catch (_) {
      // Fall through to deterministic heuristic blind judge
    }
  }

  // Deterministic Heuristic Blind Judge (when no LLM judge is configured or LLM fails)
  const lenRatio =
    Math.min(generatedCandidate.length, originalTarget.length) /
    Math.max(generatedCandidate.length, originalTarget.length);

  const reasonCodes = [];
  if (lenRatio < 0.4) reasonCodes.push('message_length_mismatch');

  // Compare emoji presence
  const emojiRegex = /\p{Extended_Pictographic}/gu;
  const targetEmojis = (originalTarget.match(emojiRegex) || []).length;
  const candEmojis = (generatedCandidate.match(emojiRegex) || []).length;
  if (Math.abs(targetEmojis - candEmojis) > 2) reasonCodes.push('emoji_overuse');

  const score = round(Math.min(0.95, Math.max(0.40, 0.55 + lenRatio * 0.35)), 3);
  const winner = lenRatio >= 0.85 ? 'TIE' : (isTargetA ? 'A' : 'B');
  const favoredGenerated =
    (isTargetA && winner === 'B') ||
    (!isTargetA && winner === 'A') ||
    winner === 'TIE';

  return {
    blind_winner: winner,
    synthetic_is_winner_or_tie: favoredGenerated,
    confidence: 0.70,
    score,
    dimension_scores: {
      style_similarity: score,
      behavior_similarity: round(score * 0.95, 3),
      context_similarity: round(score * 0.98, 3),
    },
    reason_codes: reasonCodes.length > 0 ? reasonCodes : ['natural_dialogue_heuristic'],
    reason: 'Deterministic heuristic blind judgment applied (no LLM judge configured or LLM unavailable)',
    judge_metadata: {
      blind: true,
      shuffled: true,
      target_position: isTargetA ? 'A' : 'B',
      mode: 'heuristic_judge',
      heuristic_fallback: true,
    },
  };
}

function round(val, dec = 3) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}
