import path from 'node:path';
import fs from 'node:fs';
import { ingestChatFile } from '../ingestion/index.js';
import { chunkAndSplit } from './chunker.js';
import { extractLanguageFingerprint } from './language.js';
import { extractBehaviorAndRhythm } from './behavior.js';
import { extractAssetModels } from './assets.js';
import { buildWorldModel } from './context.js';
import { constructPersonaPackage } from './persona.js';
import { analyzeFailuresAndOptimize } from './merge.js';
import { exportPersonaPackage } from './exporter.js';
import { runEvaluation } from '../evaluation/runner.js';
import { generateEvaluationReportHtml } from '../evaluation/report.js';
import { logger } from '../utils/logger.js';

export async function runDistillationPipeline({
  inputFile,
  contextFile = null,
  outputDir = null,
  targetSpeaker = null,
  llmProvider = null,
  maxOptimizationRounds = 2,
  qualityGateThreshold = 0.80,
}) {
  const timestampStr = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);
  const personaId = `persona_${timestampStr}`;

  logger.step(1, 8, `Ingesting and normalizing conversation data from: ${inputFile}`);
  const normalizedData = await ingestChatFile(inputFile, { targetSpeaker });
  const detectedTarget = normalizedData.targetSpeaker;
  const counterpart = normalizedData.counterpartSpeaker;

  logger.info(`Detected primary speaker (Target): ${detectedTarget}`);
  logger.info(`Detected counterpart: ${counterpart || 'None'}`);
  logger.info(`Total messages: ${normalizedData.totalMessages} (${normalizedData.targetMessageCount} by target)`);

  logger.step(2, 8, 'Segmenting sessions & creating isolated blind evaluation datasets...');
  const splitResult = chunkAndSplit(normalizedData);
  logger.info(`Turns created: ${splitResult.totalTurns} | Train: ${splitResult.distillationSet.length} | Val: ${splitResult.validationSet.length} | Blind Test: ${splitResult.blindTestSet.length}`);

  if (!splitResult.isolationAudit.passed) {
    logger.warn('Warning: Dataset leakage detected. Scrubbing test targets from distillation set.');
  }

  logger.step(3, 8, 'Layer 1: Computing statistical Language Fingerprint...');
  const languageModel = extractLanguageFingerprint(normalizedData.messages, detectedTarget);

  logger.step(4, 8, 'Layers 2, 3, 4: Distilling Conditional Style, Behavior Policies & Rhythm...');
  let behaviorResult = await extractBehaviorAndRhythm(
    splitResult.distillationSet,
    normalizedData.messages,
    detectedTarget,
    llmProvider
  );
  let behaviorModel = {
    version: '1.0.0',
    response_policies: behaviorResult.response_policies,
    conversation_rhythm: behaviorResult.conversation_rhythm,
    reply_mode_preference: { quote_reply_rate: 0.25, direct_send_rate: 0.75 },
  };
  let styleModel = {
    version: '1.0.0',
    metrics: languageModel.punctuation,
    conditional_probabilities: behaviorResult.conditional_style,
    punctuation_profile: {
      favored_punctuations: ['...', '~', '？', '！'],
      terminal_punctuation_drop_rate: languageModel.punctuation.terminal_punctuation_drop_rate,
    },
    length_distribution: languageModel.message_length,
  };

  logger.step(5, 8, 'Layer 5: Modeling Emoji & Sticker usage with context bindings...');
  const targetTexts = normalizedData.messages
    .filter((m) => m.isTarget)
    .map((m) => m.content);
  const assetsModel = extractAssetModels(targetTexts, splitResult.distillationSet);

  logger.step(6, 8, 'Layer 6 & 7: Constructing World Model & Initial Memory Seed...');
  const worldModel = await buildWorldModel(
    contextFile,
    normalizedData.messages,
    splitResult.distillationSet,
    llmProvider
  );

  const memorySeed = {
    version: '1.0.0',
    persona_id: personaId,
    working_memory: { recent_turns: [], active_topic: '', user_state: 'neutral' },
    episodes: worldModel.timeline.map((evt, idx) => ({
      id: evt.event_id || `ep_${idx + 1}`,
      timestamp: evt.date_or_period || new Date().toISOString(),
      summary: `${evt.title}: ${evt.description}`,
      importance_score: 0.85,
      sentiment: 'neutral',
      source: evt.provenance,
    })),
    facts: worldModel.entities.map((ent) => ({
      key: `entity_${ent.name}`,
      category: ent.type,
      versions: [
        {
          value: ent.description,
          valid_from: '2026-01-01',
          valid_to: null,
          confidence: 0.95,
        },
      ],
    })),
    timeline: worldModel.timeline,
  };

  logger.step(7, 8, 'Constructing Persona Package with 1:1 Complete Agent System Prompts...');
  let personaPackage = constructPersonaPackage({
    personaId,
    targetSpeaker: detectedTarget,
    counterpartSpeaker: counterpart,
    languageModel,
    styleModel,
    behaviorModel,
    worldModel,
    assetsModel,
    memorySeed,
  });

  logger.step(8, 8, 'Executing Offline Blind Evaluation against isolated test dataset...');
  let evalReport = await runEvaluation({
    persona: personaPackage,
    testDataset: splitResult.blindTestSet,
    languageModel,
    styleModel,
    behaviorModel,
    worldModel,
    llmProvider,
  });

  // Distillation Optimization Loop if quality gate not yet satisfied
  let optimizationRound = 0;
  while (evalReport.dsi < qualityGateThreshold && optimizationRound < maxOptimizationRounds) {
    optimizationRound++;
    logger.warn(`DSI score (${(evalReport.dsi * 100).toFixed(1)}%) below gate (${(qualityGateThreshold * 100).toFixed(1)}%). Running Optimization Loop Round ${optimizationRound}...`);

    const optResult = analyzeFailuresAndOptimize({
      evaluationReport: evalReport,
      behaviorModel,
      styleModel,
      personaPackage,
      iteration: optimizationRound,
    });

    behaviorModel = optResult.refinedBehaviorModel;
    styleModel = optResult.refinedStyleModel;
    personaPackage = optResult.refinedPersona;

    logger.info(`Re-evaluating optimized persona...`);
    evalReport = await runEvaluation({
      persona: personaPackage,
      testDataset: splitResult.blindTestSet,
      languageModel,
      styleModel,
      behaviorModel,
      worldModel,
      llmProvider,
    });
  }

  const manifest = {
    eidolon_version: '1.0.0',
    package_name: `eidolon-persona-${detectedTarget.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    persona_id: personaId,
    created_at: new Date().toISOString(),
    dsi_score: evalReport.dsi,
    evaluation_status: evalReport.status,
    model_metadata: {
      distillation_model: llmProvider?.model || 'heuristic',
      judgeModel: llmProvider?.judgeModel || 'heuristic',
      temperature: 0.7,
    },
    components: {
      persona: 'persona.json',
      style: 'style.json',
      behavior: 'behavior.json',
      language_model: 'language_model.json',
      world: 'world.json',
      relationships: 'relationships.json',
      memory_seed: 'memory_seed.json',
      assets: 'assets/',
      evaluation: 'evaluation/',
    },
  };

  const evalHtml = generateEvaluationReportHtml(evalReport, personaPackage);

  const exportResult = await exportPersonaPackage({
    outputBaseDir: outputDir,
    personaId,
    manifest,
    persona: personaPackage,
    style: styleModel,
    behavior: behaviorModel,
    languageModel,
    world: worldModel,
    relationships: worldModel.relationships,
    memorySeed,
    assets: assetsModel,
    evaluationReport: evalReport,
    evaluationHtml: evalHtml,
  });

  logger.success(`Distillation completed!`);
  logger.info(`Persona Directory: ${exportResult.packageDir}`);
  logger.info(`Compressed Bundle: ${exportResult.archivePath}`);
  logger.info(`Final DSI Score: ${(evalReport.dsi * 100).toFixed(1)}% [${evalReport.status}]`);

  return {
    personaId,
    exportResult,
    evaluationReport: evalReport,
    manifest,
  };
}

export * from './chunker.js';
export * from './language.js';
export * from './behavior.js';
export * from './context.js';
export * from './assets.js';
export * from './persona.js';
export * from './merge.js';
export * from './exporter.js';
