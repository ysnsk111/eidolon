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
  judgeModel = null,
  onProgress = null,
}) {
  const timestampStr = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);
  const personaId = `persona_${timestampStr}`;

  if (onProgress) {
    await onProgress({ event: 'start', stage: 0, totalStages: 8, message: '开始人格蒸馏流程...', personaId });
  }

  logger.step(1, 8, `Ingesting and normalizing conversation data from: ${inputFile}`);
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 1, totalStages: 8, message: '数据导入与格式清洗 (Ingestion & Normalization)', personaId });
  }
  const normalizedData = await ingestChatFile(inputFile, { targetSpeaker });
  const detectedTarget = normalizedData.targetSpeaker;
  const counterpart = normalizedData.counterpartSpeaker;

  logger.info(`Detected primary speaker (Target): ${detectedTarget}`);
  logger.info(`Detected counterpart: ${counterpart || 'None'}`);
  logger.info(`Total messages: ${normalizedData.totalMessages} (${normalizedData.targetMessageCount} by target)`);

  logger.step(2, 8, 'Segmenting sessions & creating isolated blind evaluation datasets...');
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 2, totalStages: 8, message: '对话切片与评测集划分 (Chunking & Dataset Split)', personaId });
  }
  const splitResult = chunkAndSplit(normalizedData);
  logger.info(`Turns created: ${splitResult.totalTurns} | Train: ${splitResult.distillationSet.length} | Val: ${splitResult.validationSet.length} | Blind Test: ${splitResult.blindTestSet.length}`);

  if (!splitResult.isolationAudit.passed) {
    logger.warn('Warning: Dataset leakage detected. Scrubbing test targets from distillation set.');
  }

  logger.step(3, 8, 'Layer 1: Computing statistical Language Fingerprint...');
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 3, totalStages: 8, message: '统计语言指纹建模 (Layer 1 Language Fingerprint)', personaId });
  }
  const languageModel = extractLanguageFingerprint(normalizedData.messages, detectedTarget);

  logger.step(4, 8, 'Layers 2, 3, 4: Distilling Conditional Style, Behavior Policies & Rhythm...');
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 4, totalStages: 8, message: '风格与行为策略树生成 (Layers 2, 3, 4 Style & Behavior)', personaId });
  }
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
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 5, totalStages: 8, message: '表情包与上下文语义绑定建模 (Layer 5 Assets Model)', personaId });
  }
  const targetTexts = normalizedData.messages
    .filter((m) => m.isTarget)
    .map((m) => m.content);
  const assetsModel = extractAssetModels(targetTexts, splitResult.distillationSet);

  logger.step(6, 8, 'Layer 6 & 7: Constructing World Model & Initial Memory Seed...');
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 6, totalStages: 8, message: '世界模型与记忆图谱种子构建 (Layer 6 & 7 World Model)', personaId });
  }
  const worldModel = await buildWorldModel(
    contextFile,
    normalizedData.messages,
    splitResult.distillationSet,
    llmProvider
  );

  const firstConversationTimestamp =
    normalizedData.messages?.find((m) => m.timestamp)?.timestamp || null;

  const memorySeed = {
    version: '1.1.0',
    persona_id: personaId,
    working_memory: { recent_turns: [], active_topic: '', user_state: 'neutral' },
    episodes: (worldModel.timeline || []).map((evt, idx) => {
      const impScore = typeof evt.importance_score === 'number'
        ? evt.importance_score
        : evt.significance === 'critical'
          ? 0.95
          : evt.significance === 'high'
            ? 0.85
            : evt.significance === 'medium'
              ? 0.70
              : 0.55;

      const evtTimestamp = evt.date_or_period || evt.timestamp || firstConversationTimestamp || null;
      const temporalPrecision = (evt.date_or_period || evt.timestamp)
        ? 'exact_or_period'
        : (firstConversationTimestamp ? 'inferred_from_session' : 'unknown');

      return {
        id: evt.event_id || `ep_${idx + 1}`,
        timestamp: evtTimestamp,
        temporal_precision: temporalPrecision,
        summary: `${evt.title}: ${evt.description}`,
        importance_score: impScore,
        sentiment: evt.sentiment || 'neutral',
        source: evt.provenance || 'historical_conversation',
      };
    }),
    facts: (worldModel.entities || []).map((ent) => {
      const explicitTime = ent.provenance_timestamp || ent.first_mentioned || ent.timestamp;
      const validFrom = explicitTime || firstConversationTimestamp || null;
      const temporalPrecision = explicitTime
        ? 'timestamped'
        : (firstConversationTimestamp ? 'inferred_from_session' : 'unknown');
      const confidence = typeof ent.confidence === 'number' ? ent.confidence : (ent.evidence_count > 2 ? 0.90 : 0.75);

      return {
        key: `entity_${ent.name}`,
        category: ent.type || 'entity',
        versions: [
          {
            value: ent.description,
            valid_from: validFrom,
            valid_to: null,
            temporal_precision: temporalPrecision,
            confidence,
          },
        ],
      };
    }),
    timeline: worldModel.timeline || [],
  };

  logger.step(7, 8, 'Constructing Persona Package with 1:1 Complete Agent System Prompts...');
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 7, totalStages: 8, message: '1:1 系统人设 Prompt 生成 (Persona Package Construction)', personaId });
  }
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
  if (onProgress) {
    await onProgress({ event: 'progress', stage: 8, totalStages: 8, message: '执行离线双盲独立评测与 DSI 指标计算 (Offline Blind Evaluation)', personaId });
  }
  let evalReport = await runEvaluation({
    persona: personaPackage,
    testDataset: splitResult.blindTestSet,
    languageModel,
    styleModel,
    behaviorModel,
    worldModel,
    llmProvider,
    judgeModel: judgeModel || llmProvider?.judgeModel,
  });

  // Distillation Optimization Loop if quality gate not yet satisfied
  let optimizationRound = 0;
  while (evalReport.dsi !== null && evalReport.dsi < qualityGateThreshold && optimizationRound < maxOptimizationRounds) {
    optimizationRound++;
    logger.warn(`DSI score (${(evalReport.dsi * 100).toFixed(1)}%) below gate (${(qualityGateThreshold * 100).toFixed(1)}%). Running Optimization Loop Round ${optimizationRound}...`);
    if (onProgress) {
      await onProgress({ event: 'progress', stage: 8, totalStages: 8, message: `DSI 优化微调轮次 ${optimizationRound}...`, personaId });
    }

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
      judgeModel: judgeModel || llmProvider?.judgeModel,
    });
  }

  const manifest = {
    eidolon_version: '1.1.0',
    package_name: `eidolon-persona-${detectedTarget.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    persona_id: personaId,
    created_at: new Date().toISOString(),
    dsi_score: evalReport.dsi,
    evaluation_status: evalReport.status,
    model_metadata: {
      distillation_model: llmProvider?.model || 'heuristic',
      judge_model: judgeModel || llmProvider?.judgeModel || 'heuristic',
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

  const dsiStr = typeof evalReport.dsi === 'number' && !Number.isNaN(evalReport.dsi) ? `${(evalReport.dsi * 100).toFixed(1)}%` : 'N/A';

  if (onProgress) {
    await onProgress({
      event: 'complete',
      stage: 8,
      totalStages: 8,
      message: `人格蒸馏已完成！DSI 得分: ${dsiStr} [${evalReport.status}]`,
      personaId,
      dsi: evalReport.dsi,
    });
  }

  logger.success(`Distillation completed!`);
  logger.info(`Persona Directory: ${exportResult.packageDir}`);
  logger.info(`Final DSI Score: ${dsiStr} [${evalReport.status}]`);

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
