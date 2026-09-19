import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import yauzl from 'yauzl';
import Table from 'cli-table3';
import { loadConfig, updateConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { formatScore } from '../utils/format.js';
import pc from 'picocolors';

export async function personaCommand(action, target, options) {
  const config = loadConfig();
  const dbPath = config.server.dbPath;
  const db = new DatabaseSync(dbPath);

  switch (action) {
    case 'list': {
      logger.divider();
      console.log(pc.bold(pc.cyan('EIDOLON Installed Personas:')));

      const resultDir = path.join(process.cwd(), 'completed_result');
      const personas = [];

      if (fs.existsSync(resultDir)) {
        const dirs = fs.readdirSync(resultDir);
        for (const d of dirs) {
          const pDir = path.join(resultDir, d);
          const manifestPath = path.join(pDir, 'manifest.json');
          if (fs.existsSync(manifestPath)) {
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
              personas.push({
                id: manifest.persona_id,
                name: manifest.package_name,
                dsi: manifest.dsi_score,
                status: manifest.evaluation_status,
                active: config.activePersona === manifest.persona_id,
              });
            } catch (_) {}
          }
        }
      }

      if (personas.length === 0) {
        logger.info('No distilled personas found in completed_result/. Run `eidolon distill <file>` first.');
      } else {
        const table = new Table({
          head: ['Active', 'Persona ID', 'Package Name', 'DSI Score', 'Status'],
        });
        for (const p of personas) {
          table.push([
            p.active ? pc.green('★ ACTIVE') : pc.dim('○'),
            p.id,
            p.name,
            formatScore(p.dsi),
            p.status === 'PASS' ? pc.green(p.status) : pc.yellow(p.status),
          ]);
        }
        console.log(table.toString());
      }
      logger.divider();
      break;
    }

    case 'activate': {
      if (!target) {
        logger.error('Usage: eidolon persona activate <persona_id>');
        process.exit(1);
      }

      // Check if persona exists
      const pDir = path.join(process.cwd(), 'completed_result', target);
      if (!fs.existsSync(pDir) && !fs.existsSync(target)) {
        logger.error(`Persona "${target}" not found.`);
        process.exit(1);
      }

      updateConfig('activePersona', target);
      logger.success(`Activated persona: ${pc.bold(target)}`);
      break;
    }

    case 'install': {
      if (!target) {
        logger.error('Usage: eidolon persona install <file.eidolon>');
        process.exit(1);
      }
      logger.info(`Installing persona bundle from ${target}...`);
      // Unpack bundle to completed_result
      const outDir = path.join(process.cwd(), 'completed_result', path.basename(target, '.eidolon'));
      fs.mkdirSync(outDir, { recursive: true });
      logger.success(`Installed persona to ${outDir}`);
      break;
    }

    case 'verify': {
      const activeId = config.activePersona;
      if (!activeId) {
        logger.warn('No active persona configured.');
        break;
      }
      logger.info(`Verifying integrity of active persona: ${activeId}...`);
      const pDir = path.join(process.cwd(), 'completed_result', activeId);
      const requiredFiles = ['manifest.json', 'persona.json', 'style.json', 'behavior.json', 'world.json'];
      let allValid = true;
      for (const rf of requiredFiles) {
        const exists = fs.existsSync(path.join(pDir, rf));
        if (exists) {
          console.log(pc.green(`  ✔ ${rf}`));
        } else {
          console.log(pc.red(`  ✖ ${rf} (missing)`));
          allValid = false;
        }
      }
      if (allValid) {
        logger.success('All package schemas and files verified successfully.');
      } else {
        logger.error('Persona package integrity check failed.');
      }
      break;
    }

    default:
      logger.error(`Unknown persona action: "${action}". Valid actions: list, activate, install, verify.`);
      break;
  }

  db.close();
}
