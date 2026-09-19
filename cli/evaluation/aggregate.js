/**
 * EIDOLON Score Aggregation & Acceptance Gate Validator
 * Implements Section 21 & Section 29 of the specification.
 * DSI = L*0.20 + S*0.20 + B*0.25 + C*0.15 + H*0.20
 */

export function aggregateEvaluationResults({
  sampleResults,
  personaId,
  qualityGate = {
    dsiThreshold: 0.80,
    lexicalThreshold: 0.80,
    styleThreshold: 0.80,
    behaviorThreshold: 0.75,
    contextThreshold: 0.90,
  },
}) {
  const n = sampleResults.length;
  if (n === 0) {
    return getDefaultReport(personaId);
  }

  // Calculate means for the 5 core dimensions
  let sumL = 0, sumS = 0, sumB = 0, sumC = 0, sumH = 0;
  let countC = 0;
  const failureCases = [];

  for (const s of sampleResults) {
    sumL += s.metrics.lexical;
    sumS += s.metrics.style;
    sumB += s.metrics.behavior;
    const hasC = typeof s.metrics.context === 'number' && s.metrics.context !== null;
    if (hasC) {
      sumC += s.metrics.context;
      countC++;
    }
    sumH += s.judge.score;

    const sampleDsi = hasC
      ? s.metrics.lexical * 0.20 +
        s.metrics.style * 0.20 +
        s.metrics.behavior * 0.25 +
        s.metrics.context * 0.15 +
        s.judge.score * 0.20
      : (s.metrics.lexical * 0.20 +
         s.metrics.style * 0.20 +
         s.metrics.behavior * 0.25 +
         s.judge.score * 0.20) / 0.85;

    // A failure case is any sample with score below 0.75 or containing detected issues
    if (sampleDsi < 0.78 || (s.metrics.issues && s.metrics.issues.length > 0)) {
      failureCases.push({
        sample_id: s.sample_id,
        context: (s.context || []).map((c) => `${c.sender}: ${c.content}`),
        original_target: s.original_target,
        generated_candidate: s.generated_candidate,
        issues: (s.metrics.issues && s.metrics.issues.length > 0) ? s.metrics.issues : ['sub-threshold behavioral match'],
        score: round(sampleDsi, 3),
      });
    }
  }

  const avgL = round(sumL / n, 3);
  const avgS = round(sumS / n, 3);
  const avgB = round(sumB / n, 3);
  const avgC = countC > 0 ? round(sumC / countC, 3) : null;
  const avgH = round(sumH / n, 3);

  // Core DSI Formula
  const dsi = avgC !== null
    ? round(
        avgL * 0.20 +
        avgS * 0.20 +
        avgB * 0.25 +
        avgC * 0.15 +
        avgH * 0.20,
        3
      )
    : round(
        (avgL * 0.20 +
         avgS * 0.20 +
         avgB * 0.25 +
         avgH * 0.20) / 0.85,
        3
      );

  // Acceptance Gate
  const gateResults = {
    dsi_pass: dsi >= qualityGate.dsiThreshold,
    lexical_pass: avgL >= qualityGate.lexicalThreshold,
    style_pass: avgS >= qualityGate.styleThreshold,
    behavior_pass: avgB >= qualityGate.behaviorThreshold,
    context_pass: avgC !== null ? avgC >= qualityGate.contextThreshold : true,
  };

  const allPassed = Object.values(gateResults).every(Boolean);
  const status = allPassed ? 'PASS' : dsi >= 0.75 ? 'NEEDS_OPTIMIZATION' : 'FAIL';

  return {
    version: '1.1.0',
    persona_id: personaId,
    created_at: new Date().toISOString(),
    dataset_size: n,
    metrics: {
      lexical: avgL,
      style: avgS,
      behavior: avgB,
      context: avgC,
      blind_judge: avgH,
    },
    sub_metrics: {
      emoji_fidelity: avgS,
      vocabulary_fidelity: avgL,
      sentence_rhythm: avgS,
      response_strategy: avgB,
      context_fidelity: avgC,
    },
    dsi,
    dsi_scaled: round(dsi * 100, 1),
    status,
    gate_results: gateResults,
    failure_cases: failureCases.slice(0, 15), // keep top representative failure cases
  };
}

function round(val, dec = 3) {
  const p = Math.pow(10, dec);
  return Math.round(val * p) / p;
}

function getDefaultReport(personaId) {
  return {
    version: '1.1.0',
    persona_id: personaId || 'unknown',
    created_at: new Date().toISOString(),
    dataset_size: 0,
    metrics: { lexical: 0, style: 0, behavior: 0, context: 0, blind_judge: 0 },
    sub_metrics: {
      emoji_fidelity: 0,
      vocabulary_fidelity: 0,
      sentence_rhythm: 0,
      response_strategy: 0,
      context_fidelity: 0,
    },
    dsi: 0,
    dsi_scaled: 0,
    status: 'FAIL',
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
