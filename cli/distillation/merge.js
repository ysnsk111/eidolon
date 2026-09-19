/**
 * EIDOLON Distillation Optimization Loop
 * Implements Sections 27 and 28 of the specification.
 * Analyzes evaluation failures and tunes distillation parameters.
 */

export function analyzeFailuresAndOptimize({
  evaluationReport,
  behaviorModel,
  styleModel,
  personaPackage,
  iteration = 1,
}) {
  const { metrics, failure_cases = [] } = evaluationReport;
  const optimizationsApplied = [];

  const newBehaviorModel = JSON.parse(JSON.stringify(behaviorModel));
  const newStyleModel = JSON.parse(JSON.stringify(styleModel));
  const newPersona = JSON.parse(JSON.stringify(personaPackage));

  // 1. Behavior Optimization
  if (metrics.behavior < 0.75) {
    // Check failure patterns: are responses too verbose or lacking follow-up?
    let verboseCount = 0;
    let missingEmojiCount = 0;
    let wrongStrategyCount = 0;

    for (const f of failure_cases) {
      const issues = f.issues || [];
      if (issues.some((i) => i.includes('too long') || i.includes('verbose'))) verboseCount++;
      if (issues.some((i) => i.includes('missing emoji'))) missingEmojiCount++;
      if (issues.some((i) => i.includes('strategy') || i.includes('direct'))) wrongStrategyCount++;
    }

    if (verboseCount >= 1) {
      newPersona.linguistic_fingerprint.message_metrics.median = Math.max(
        10,
        Math.round(newPersona.linguistic_fingerprint.message_metrics.median * 0.85)
      );
      optimizationsApplied.push('Reduced target message length constraint to counter verbosity');
    }

    if (missingEmojiCount >= 1) {
      newBehaviorModel.response_policies = newBehaviorModel.response_policies.map((p) => ({
        ...p,
        emoji_probability: Math.min(0.80, p.emoji_probability + 0.15),
      }));
      optimizationsApplied.push('Increased emoji probability across response policies');
    }

    if (wrongStrategyCount >= 1) {
      optimizationsApplied.push('Strengthened playful/nuanced strategy directives in system prompt');
    }
  }

  // 2. Style & Rhythm Optimization
  if (metrics.style < 0.80) {
    newStyleModel.metrics.ellipsis_rate = Math.min(
      0.60,
      (newStyleModel.metrics.ellipsis_rate || 0.2) + 0.08
    );
    optimizationsApplied.push('Adjusted ellipsis rate calibration');
  }

  // 3. Update generator prompt with explicit failure counter-measures
  if (optimizationsApplied.length > 0) {
    const additionalDirectives = `\n[OPTIMIZATION DIRECTIVES (Iteration ${iteration + 1})]
- STRICTLY enforce natural length: Avoid assistant-like multi-sentence answers unless requested.
- Use distilled catchphrases and characteristic emojis appropriately.
- Maintain authentic conversational emotional valence.`;

    newPersona.system_prompts.generator += additionalDirectives;
  }

  return {
    iteration: iteration + 1,
    optimizationsApplied,
    refinedBehaviorModel: newBehaviorModel,
    refinedStyleModel: newStyleModel,
    refinedPersona: newPersona,
  };
}
