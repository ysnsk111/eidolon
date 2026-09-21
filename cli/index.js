#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { configCommand } from './commands/config.js';
import { distillCommand } from './commands/distill.js';
import { evaluateCommand } from './commands/evaluate.js';
import { personaCommand } from './commands/persona.js';
import { memoryCommand } from './commands/memory.js';
import { botCommand } from './commands/bot.js';
import { serviceCommand, logsCommand } from './commands/service.js';
import { statusCommand } from './commands/status.js';
import { printBanner } from './utils/banner.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOnboardingWizard } from './commands/onboarding.js';
import { loadConfig } from './utils/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('eidolon')
  .description('EIDOLON — Persona Distillation & Memory Runtime')
  .version(pkg.version);

// Default command: if first run (not onboarded), execute onboarding wizard; else print status
program
  .action(async () => {
    const config = loadConfig();
    if (!config.onboarded) {
      await runOnboardingWizard();
    } else {
      await statusCommand();
    }
  });

// 0. start (runs onboarding on first launch, or starts service)
program
  .command('start')
  .description('Start EIDOLON service (automatically launches user onboarding guide on first run)')
  .option('-g, --guided', 'Force run interactive onboarding guide')
  .action(async (options) => {
    const config = loadConfig();
    if (!config.onboarded || options.guided) {
      await runOnboardingWizard();
    } else {
      await serviceCommand('start');
    }
  });

// 1. init
program
  .command('init')
  .description('Initialize EIDOLON environment and local databases (launches onboarding guide if uninitialized)')
  .option('-g, --guided', 'Run interactive onboarding guide')
  .action(async (options) => {
    const config = loadConfig();
    if (!config.onboarded || options.guided) {
      await runOnboardingWizard();
    } else {
      await initCommand(options);
    }
  });

// 1b. guide
program
  .command('guide')
  .alias('onboarding')
  .description('Run interactive user onboarding and pairing guide')
  .action(async () => {
    await runOnboardingWizard();
  });

// 2. config
program
  .command('config [action] [key] [value]')
  .description('Inspect or modify configuration (show, set, test, edit)')
  .action(configCommand);

// 3. distill
program
  .command('distill [file]')
  .description('Distill chat history into persona, behavior, and memory models')
  .option('-i, --input <path>', 'Input chat history file (PDF, JSON, HTML, TXT)')
  .option('-c, --context <path>', 'Supplied world context file (Markdown/TXT)')
  .option('-o, --output <dir>', 'Output destination directory')
  .option('-t, --target <speaker>', 'Target speaker to distill')
  .option('-q, --quality-gate <threshold>', 'Minimum DSI acceptance threshold (default: 0.80)')
  .action(distillCommand);

// 4. evaluate
program
  .command('evaluate [persona]')
  .description('Run offline blind evaluation benchmarks and calculate DSI')
  .option('-p, --persona <id|path>', 'Persona to evaluate')
  .option('-d, --dataset <name>', 'Dataset partition (test, validation, train)')
  .action(evaluateCommand);

// 5. persona
program
  .command('persona <action> [target]')
  .description('Manage distilled personas (list, activate, install, verify)')
  .action(personaCommand);

// 6. memory
program
  .command('memory <action> [query]')
  .description('Inspect, query, compact, or export memory stores')
  .action(memoryCommand);

// 7. bot
program
  .command('bot <action> [subaction] [value]')
  .description('Manage Telegram bot token, users allowlist, and runtime status')
  .action(botCommand);

// 8. service
program
  .command('service <action>')
  .description('Manage EIDOLON daemon service (start, stop, restart, status)')
  .action(serviceCommand);

// 9. logs
program
  .command('logs')
  .description('View live or recent daemon service runtime logs')
  .option('-n, --lines <number>', 'Number of log lines to show', '50')
  .action(logsCommand);

// 10. status
program
  .command('status')
  .description('Display complete EIDOLON runtime and subsystem status')
  .action(statusCommand);

// 11. validate
import { validateCommand } from './commands/validate.js';
import { clearCommand } from './commands/clear.js';

program
  .command('validate <packagePath>')
  .description('Validate an .eidolon bundle or directory against schemas')
  .action(validateCommand);

// 12. clear
program
  .command('clear')
  .description('Clear conversation logs, runtime memories, or all data with 3-step verification')
  .option('-m, --mode <mode>', 'Clearance mode: all (All-Clear) or chat-memory (preserve personas)')
  .option('-y, --yes', 'Skip step 2 confirmation prompt')
  .option('--confirm', 'Skip step 3 verification code in automated environments')
  .option('--force', 'Bypass interactive confirmation steps')
  .action(clearCommand);

program.parse(process.argv);
