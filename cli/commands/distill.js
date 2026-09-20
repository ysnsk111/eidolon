import path from 'node:path';
import fs from 'node:fs';
import { runDistillationPipeline } from '../distillation/index.js';
import { printEvaluationTable } from '../evaluation/report.js';
import { loadConfig, updateConfig } from '../utils/config.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { sendTelegramMessage, deleteTelegramMessage } from '../utils/telegram.js';
import { logger } from '../utils/logger.js';
import pc from 'picocolors';

export async function distillCommand(file, options) {
  const inputFile = file || options.input;
  if (!inputFile) {
    logger.error('Missing input chat file. Usage: eidolon distill <file> [--context <file>]');
    process.exit(1);
  }

  const absInput = path.resolve(process.cwd(), inputFile);
  if (!fs.existsSync(absInput)) {
    logger.error(`File not found: ${absInput}`);
    process.exit(1);
  }

  let absContext = null;
  if (options.context) {
    absContext = path.resolve(process.cwd(), options.context);
    if (!fs.existsSync(absContext)) {
      logger.error(`Context file not found: ${absContext}`);
      process.exit(1);
    }
  }

  const config = loadConfig();
  const llmProvider = new OpenAICompatibleProvider(config.llm);

  logger.divider();
  console.log(pc.bold(pc.cyan('EIDOLON PERSONA DISTILLATION ENGINE')));
  logger.info(`Source File: ${absInput}`);
  if (absContext) logger.info(`Supplied Context: ${absContext}`);
  logger.divider();

  const qualityGate = options.qualityGate ? parseFloat(options.qualityGate) : config.evaluation.dsiThreshold;
  const serverHost = config.server?.host || '127.0.0.1';
  const serverPort = config.server?.port || 8090;
  const serverUrl = `http://${serverHost}:${serverPort}`;

  // Fallback direct Telegram message tracking if server daemon is offline
  const fallbackMessageIDs = [];
  const primaryChatId = config.bot?.allowedUsers?.[0];

  const onProgress = async ({ event, stage, totalStages, message, personaId, dsi }) => {
    // 1. Notify running daemon server via HTTP API
    let notifiedServer = false;
    try {
      const resp = await fetch(`${serverUrl}/api/distill/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          stage,
          total_stages: totalStages,
          message,
          persona_id: personaId,
          dsi,
        }),
      });
      if (resp.ok) {
        notifiedServer = true;
      }
    } catch (_) {}

    // 2. Fallback: if server not reachable, report directly to Telegram via bot token
    if (!notifiedServer && config.bot?.telegramToken && primaryChatId) {
      const token = config.bot.telegramToken;
      if (event === 'start') {
        const mid = await sendTelegramMessage(token, primaryChatId, '⏳ [EIDOLON] 开始人格蒸馏流程...');
        if (mid) fallbackMessageIDs.push(mid);
      } else if (event === 'progress') {
        const mid = await sendTelegramMessage(token, primaryChatId, `🔄 [进度 ${stage}/${totalStages}] ${message}`);
        if (mid) fallbackMessageIDs.push(mid);
      } else if (event === 'complete') {
        // ALL-CLEAR fallback deletion
        for (const mid of fallbackMessageIDs) {
          await deleteTelegramMessage(token, primaryChatId, mid);
        }
        await sendTelegramMessage(token, primaryChatId, '好啦，我在呢~');
      }
    }
  };

  try {
    const result = await runDistillationPipeline({
      inputFile: absInput,
      contextFile: absContext,
      outputDir: options.output ? path.resolve(process.cwd(), options.output) : null,
      targetSpeaker: options.target,
      llmProvider,
      qualityGateThreshold: qualityGate,
      judgeModel: options.judgeModel || config.llm?.judgeModel,
      onProgress,
    });

    // Automatically activate the distilled persona
    updateConfig('activePersona', result.personaId);
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const { getConfigDir } = await import('../utils/config.js');
      const dbPath = config.server.dbPath || path.join(getConfigDir(), 'eidolon.db');
      const db = new DatabaseSync(dbPath);
      db.prepare(`UPDATE personas SET is_active = 0`).run();
      db.prepare(`INSERT OR REPLACE INTO personas (id, name, target_speaker, created_at, dsi_score, is_active, manifest_json, package_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        result.personaId,
        result.manifest?.package_name || result.personaId,
        result.manifest?.target_speaker || options.target || 'TargetSpeaker',
        result.manifest?.created_at || new Date().toISOString(),
        result.evaluationReport?.dsi || null,
        1,
        JSON.stringify(result.manifest || {}),
        result.exportResult?.packageDir || ''
      );
      db.close();
      logger.success(`Activated distilled persona: ${result.personaId}`);
    } catch (_) {}

    printEvaluationTable(result.evaluationReport);

    logger.divider();
    console.log(pc.bold('Distillation Checklist:'));
    console.log(pc.green('  ✔ Persona generated'));
    console.log(pc.green('  ✔ Style model generated'));
    console.log(pc.green('  ✔ Behavior model generated'));
    console.log(pc.green('  ✔ Memory seed generated'));
    console.log(pc.green('  ✔ Evaluation dataset generated'));
    console.log(pc.green('  ✔ Blind test completed'));
    console.log(pc.green('  ✔ Distillation Score calculated'));
    console.log(pc.green('  ✔ Failure cases analyzed'));
    console.log(pc.green(`  ✔ Quality gate (${result.evaluationReport.status})`));
    console.log(pc.green(`  ✔ Persona package exported (${result.exportResult.archivePath})`));
    logger.divider();
  } catch (err) {
    logger.error(`Distillation failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}
