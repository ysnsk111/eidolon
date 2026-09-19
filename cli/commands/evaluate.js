import path from 'node:path';
import fs from 'node:fs';
import { runEvaluation } from '../evaluation/runner.js';
import { printEvaluationTable } from '../evaluation/report.js';
import { loadConfig } from '../utils/config.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { logger } from '../utils/logger.js';
import pc from 'picocolors';

export async function evaluateCommand(personaIdentifier, options) {
  const personaArg = personaIdentifier || options.persona;
  if (!personaArg) {
    logger.error('Missing persona identifier. Usage: eidolon evaluate <persona_id|path>');
    process.exit(1);
  }

  // Locate persona directory
  let personaDir = path.resolve(process.cwd(), personaArg);
  if (!fs.existsSync(personaDir)) {
    const candidate = path.join(process.cwd(), 'completed_result', personaArg);
    if (fs.existsSync(candidate)) {
      personaDir = candidate;
    } else {
      logger.error(`Cannot find persona at: ${personaArg}`);
      process.exit(1);
    }
  }

  const personaJsonPath = path.join(personaDir, 'persona.json');
  if (!fs.existsSync(personaJsonPath)) {
    logger.error(`Invalid persona package: missing persona.json in ${personaDir}`);
    process.exit(1);
  }

  const persona = JSON.parse(fs.readFileSync(personaJsonPath, 'utf-8'));
  const style = JSON.parse(fs.readFileSync(path.join(personaDir, 'style.json'), 'utf-8'));
  const behavior = JSON.parse(fs.readFileSync(path.join(personaDir, 'behavior.json'), 'utf-8'));
  const languageModel = JSON.parse(fs.readFileSync(path.join(personaDir, 'language_model.json'), 'utf-8'));
  const world = JSON.parse(fs.readFileSync(path.join(personaDir, 'world.json'), 'utf-8'));

  let testDataset = [];
  const testFile = path.join(personaDir, 'evaluation', 'test.jsonl');
  if (fs.existsSync(testFile)) {
    const lines = fs.readFileSync(testFile, 'utf-8').split('\n').filter((l) => l.trim());
    testDataset = lines.map((l) => JSON.parse(l));
  }

  const config = loadConfig();
  const llmProvider = new OpenAICompatibleProvider(config.llm);

  logger.info(`Evaluating persona "${persona.name}" (${persona.id})...`);
  const report = await runEvaluation({
    persona,
    testDataset,
    languageModel,
    styleModel: style,
    behaviorModel: behavior,
    worldModel: world,
    llmProvider,
  });

  printEvaluationTable(report);
}
