/**
 * EIDOLON Conversation Chunker & Dataset Splitter
 * Implements strict data isolation per Section 17 of the specification:
 * Historical Chat -> Distillation Set (70%) + Validation Set (15%) + Blind Test Set (15%)
 */

export function chunkAndSplit(normalizedData, options = {}) {
  const { messages, targetSpeaker, sessions } = normalizedData;
  const contextWindowSize = options.contextWindowSize || 5;

  // 1. Build dialog turns (Context -> Target Response pairs)
  const turns = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Find messages sent by the target speaker that have prior conversation context
    if (msg.isTarget && i > 0) {
      // Collect prior context within the same session or within reasonable history window
      const contextSlice = [];
      const startIdx = Math.max(0, i - contextWindowSize);

      for (let c = startIdx; c < i; c++) {
        const ctxMsg = messages[c];
        contextSlice.push({
          sender: ctxMsg.sender,
          content: ctxMsg.content,
          timestamp: ctxMsg.timestamp,
        });
      }

      if (contextSlice.length > 0 && msg.content.trim().length > 0) {
        turns.push({
          id: `sample_${String(turns.length + 1).padStart(5, '0')}`,
          context: contextSlice,
          target_message: msg.content,
          target_sender: msg.sender,
          timestamp: msg.timestamp,
          mediaType: msg.mediaType,
        });
      }
    }
  }

  // 2. Deterministic split using a hash or pseudo-random seed to allow reproducibility
  const trainRatio = options.trainRatio || 0.70;
  const valRatio = options.valRatio || 0.15;
  // testRatio is remainder (~0.15)

  // Shuffle copies for unbiased distribution across early/late timeline
  const shuffled = [...turns];
  shuffleDeterministic(shuffled, options.seed || 42);

  const nTotal = shuffled.length;
  const nTrain = Math.max(1, Math.floor(nTotal * trainRatio));
  const nVal = Math.max(0, Math.floor(nTotal * valRatio));

  const distillationSamples = shuffled.slice(0, nTrain);
  const validationSamples = shuffled.slice(nTrain, nTrain + nVal);
  const blindTestSamples = shuffled.slice(nTrain + nVal);

  // 3. Strict Data Leakage Audit
  // Verify that none of the blind test target messages appear directly in distillation training data
  const testTargetSet = new Set(blindTestSamples.map((s) => s.target_message.trim().toLowerCase()));
  const leaked = distillationSamples.filter((s) => testTargetSet.has(s.target_message.trim().toLowerCase()));

  const auditPassed = leaked.length === 0 || blindTestSamples.length === 0;

  return {
    totalTurns: turns.length,
    distillationSet: distillationSamples,
    validationSet: validationSamples,
    blindTestSet: blindTestSamples,
    isolationAudit: {
      passed: auditPassed,
      leakedSamplesCount: leaked.length,
    },
    sessionsCount: sessions.length,
  };
}

function shuffleDeterministic(array, seed = 42) {
  let s = seed;
  const random = () => {
    const x = Math.sin(s++) * 10000;
    return x - Math.floor(x);
  };

  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
