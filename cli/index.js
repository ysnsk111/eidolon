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

const program = new Command();

program
  .name('eidolon')
  .description('EIDOLON — Persona Distillation & Memory Runtime')
  .version('1.0.0');

// Default command: print status
program
  .action(async () => {
    await statusCommand();
  });

// 1. init
program
  .command('init')
  .description('Initialize EIDOLON environment and local databases')
  .action(initCommand);

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

program.parse(process.argv);
