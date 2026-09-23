import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, getConfigDir } from '../utils/config.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { formatScore, formatStatus } from '../utils/format.js';
import { printBanner } from '../utils/banner.js';
import { logger } from '../utils/logger.js';
import pc from 'picocolors';

export async function statusCommand() {
  printBanner();
  const config = loadConfig();
  const configDir = getConfigDir();
  const pidFile = path.join(configDir, 'eidolon.pid');

  // 1. Service Runtime Status
  let runtimeRunning = false;
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 0);
      runtimeRunning = true;
    } catch (_) {}
  }

  // 2. LLM Connectivity
  const provider = new OpenAICompatibleProvider({
    ...config.llm,
    timeoutMs: Math.max(config.llm?.timeoutMs || 30000, 30000),
  });
  let llmStatus = 'TESTING...';
  try {
    const res = await provider.testConnection();
    llmStatus = res.ok ? 'OK' : 'ERROR';
  } catch (_) {
    llmStatus = 'ERROR';
  }

  // 3. Telegram Status
  let telegramStatus = 'NOT CONFIGURED';
  if (config.bot.telegramToken) {
    telegramStatus = 'CONFIGURED';
  }

  // 4. Database counts
  let memoryCount = 0;
  let sessionsCount = 0;
  let activeDsi = 0;

  if (fs.existsSync(config.server.dbPath)) {
    try {
      const db = new DatabaseSync(config.server.dbPath);
      memoryCount = db.prepare('SELECT COUNT(*) as c FROM memories').get().c;
      sessionsCount = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
      db.close();
    } catch (_) {}
  }

  // 5. Active Persona
  let activePersona = config.activePersona || 'None';
  if (config.activePersona) {
    const manifestPath = path.join(
      process.cwd(),
      'completed_result',
      config.activePersona,
      'manifest.json'
    );
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        activeDsi = manifest.dsi_score || 0;
      } catch (_) {}
    }
  }

  logger.divider();
  console.log(`  ${pc.bold('Runtime:')}        ${formatStatus(runtimeRunning ? 'RUNNING' : 'STOPPED')}`);
  console.log(`  ${pc.bold('Telegram:')}       ${formatStatus(telegramStatus)}`);
  console.log(`  ${pc.bold('LLM Backend:')}     ${formatStatus(llmStatus)} (${config.llm.model})`);
  console.log(`  ${pc.bold('Active Persona:')}  ${pc.cyan(activePersona)}`);
  console.log(`  ${pc.bold('Distillation DSI:')} ${activeDsi > 0 ? formatScore(activeDsi) : pc.dim('N/A')}`);
  console.log(`  ${pc.bold('Memory Records:')}  ${memoryCount.toLocaleString()}`);
  console.log(`  ${pc.bold('Sessions:')}        ${sessionsCount.toLocaleString()}`);
  console.log(`  ${pc.bold('Web Dashboard:')}   http://${config.server.host}:${config.server.port}`);
  logger.divider();
}
