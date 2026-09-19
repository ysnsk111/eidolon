import path from 'node:path';
import fs from 'node:fs';
import { runDistillationPipeline } from '../distillation/index.js';
import { printEvaluationTable } from '../evaluation/report.js';
import { loadConfig } from '../utils/config.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
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

  try {
    const result = await runDistillationPipeline({
      inputFile: absInput,
      contextFile: absContext,
      outputDir: options.output ? path.resolve(process.cwd(), options.output) : null,
      targetSpeaker: options.target,
      llmProvider,
      qualityGateThreshold: qualityGate,
    });

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
