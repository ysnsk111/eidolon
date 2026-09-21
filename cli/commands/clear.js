import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pc from 'picocolors';
import Table from 'cli-table3';
import { loadConfig, updateConfig, getConfigDir } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { t } from '../utils/i18n.js';

export async function clearCommand(options = {}) {
  logger.divider();
  console.log(pc.bold(pc.cyan(`🧹 ${t('clear.title')}`)));
  logger.divider();

  const config = loadConfig();
  const dbPath = config.server?.dbPath || path.join(getConfigDir(), 'eidolon.db');
  const isNonInteractive = options.nonInteractive || process.env.EIDOLON_NON_INTERACTIVE === '1';

  let rl = null;
  if (!isNonInteractive) {
    rl = readline.createInterface({ input, output });
  }

  let mode = options.mode;

  try {
    // -----------------------------------------------------------------
    // Step 1: Mode Selection
    // -----------------------------------------------------------------
    if (!mode) {
      if (isNonInteractive) {
        throw new Error('In non-interactive mode, --mode <all|chat-memory> must be specified.');
      }
      console.log(pc.bold(pc.yellow(`\n${t('clear.step1_title')}`)));
      console.log(pc.white('  1) all-clear    - Complete purge: clears all personas, chats, memories, packages, and logs.'));
      console.log(pc.white('  2) chat-memory  - Runtime wipe: clears conversations & memories only; strictly preserves distilled persona packages.'));

      const choice = await rl.question(pc.cyan('\nSelect clearance mode (1: all-clear, 2: chat-memory) [2]: '));
      const cleanChoice = choice.trim();
      if (cleanChoice === '1' || cleanChoice.toLowerCase() === 'all' || cleanChoice.toLowerCase() === 'all-clear') {
        mode = 'all';
      } else {
        mode = 'chat-memory';
      }
    } else {
      mode = mode.toLowerCase() === 'all' || mode.toLowerCase() === 'all-clear' ? 'all' : 'chat-memory';
    }

    // -----------------------------------------------------------------
    // Step 2: Risk Assessment & Consequence Review
    // -----------------------------------------------------------------
    console.log(pc.bold(pc.yellow(`\n${t('clear.step2_title')}`)));

    const assessmentTable = new Table({
      head: ['Item / Component', 'Action', 'Impact'],
      colWidths: [28, 14, 45],
    });

    if (mode === 'all') {
      assessmentTable.push(
        ['Personas DB Table', pc.red('WIPED'), 'All persona registrations deleted'],
        ['Runtime Conversations', pc.red('WIPED'), 'All session records and chat messages deleted'],
        ['Memory Graphs (L0-L3)', pc.red('WIPED'), 'All dynamic episodic and semantic memories deleted'],
        ['Distilled Packages', pc.red('DELETED'), 'All packages in ./completed_result/ and ~/.config/ removed'],
        ['Active Persona State', pc.red('RESET'), 'Runtime active persona de-registered']
      );
    } else {
      assessmentTable.push(
        ['Personas DB Table', pc.green('PRESERVED'), 'Distilled persona records retained intact'],
        ['Distilled Packages', pc.green('PRESERVED'), 'All packages in ./completed_result/ retained intact'],
        ['Runtime Conversations', pc.red('WIPED'), 'Session history and chat turns with agent deleted'],
        ['Memory Graphs (L0-L3)', pc.red('WIPED'), 'Dynamic conversational memories deleted'],
        ['Active Persona State', pc.green('PRESERVED'), 'Persona identity preserved (memory buffer reset)']
      );
    }

    console.log(assessmentTable.toString());

    if (mode === 'all') {
      console.log(pc.bold(pc.red(`\n  ⚠  ${t('clear.step2_all_warn')}`)));
    } else {
      console.log(pc.bold(pc.cyan(`\n  ℹ  ${t('clear.step2_chat_warn')}`)));
    }

    if (!options.yes && !options.force && !isNonInteractive) {
      const confirmStep2 = await rl.question(pc.yellow(`\n${t('clear.step2_confirm')}: `));
      const cleanStep2 = confirmStep2.trim().toLowerCase();
      if (cleanStep2 !== 'yes' && cleanStep2 !== 'y') {
        console.log(pc.gray(`\n${t('clear.cancelled')}`));
        if (rl) rl.close();
        return;
      }
    }

    // -----------------------------------------------------------------
    // Step 3: Irreversible Verification
    // -----------------------------------------------------------------
    console.log(pc.bold(pc.yellow(`\n${t('clear.step3_title')}`)));

    if (!options.confirm && !options.force && !isNonInteractive) {
      const promptVerification = await rl.question(pc.red(`${t('clear.step3_prompt')}: `));
      const cleanVerification = promptVerification.trim().toUpperCase();
      if (cleanVerification !== 'CONFIRM' && cleanVerification !== 'CLEAR' && cleanVerification !== 'YES') {
        console.log(pc.gray(`\n${t('clear.cancelled')}`));
        if (rl) rl.close();
        return;
      }
    }

    // -----------------------------------------------------------------
    // Execute Clearance
    // -----------------------------------------------------------------
    executePurge(mode, dbPath, config);

    logger.divider();
    if (mode === 'all') {
      logger.success(t('clear.success_all'));
    } else {
      logger.success(t('clear.success_chat_memory'));
    }
    logger.divider();
  } finally {
    if (rl) rl.close();
  }
}

function executePurge(mode, dbPath, config) {
  if (fs.existsSync(dbPath)) {
    try {
      const db = new DatabaseSync(dbPath);
      // Clean chat and memory tables for both modes
      db.exec(`
        DELETE FROM messages;
        DELETE FROM sessions;
        DELETE FROM memories;
        DELETE FROM scheduler_events;
        DELETE FROM audit_logs;
      `);

      try {
        db.exec('DELETE FROM relationship_states;');
      } catch (_) {}

      if (mode === 'all') {
        try {
          db.exec('DELETE FROM personas;');
        } catch (_) {}
      }

      db.close();
    } catch (err) {
      logger.warn(`Database cleanup encountered notice: ${err.message}`);
    }
  }

  if (mode === 'all') {
    // Delete completed_result directory contents
    const completedDir = config.storage?.completedResultDir || path.join(process.cwd(), 'completed_result');
    if (fs.existsSync(completedDir)) {
      try {
        const files = fs.readdirSync(completedDir);
        for (const f of files) {
          const p = path.join(completedDir, f);
          fs.rmSync(p, { recursive: true, force: true });
        }
      } catch (_) {}
    }

    // Delete ~/.config/eidolon/personas directory contents
    const configDir = getConfigDir();
    const personasConfigDir = path.join(configDir, 'personas');
    if (fs.existsSync(personasConfigDir)) {
      try {
        fs.rmSync(personasConfigDir, { recursive: true, force: true });
        fs.mkdirSync(personasConfigDir, { recursive: true });
      } catch (_) {}
    }

    // Reset active_persona.json
    const activePersonaFile = path.join(configDir, 'active_persona.json');
    if (fs.existsSync(activePersonaFile)) {
      try {
        fs.unlinkSync(activePersonaFile);
      } catch (_) {}
    }

    updateConfig('activePersona', null);
  }
}
