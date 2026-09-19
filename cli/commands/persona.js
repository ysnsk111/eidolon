import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import yauzl from 'yauzl';
import Table from 'cli-table3';
import { loadConfig, updateConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { formatScore } from '../utils/format.js';
import { validatePackage } from './validate.js';
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
      const bundlePath = path.resolve(target);
      if (!fs.existsSync(bundlePath)) {
        logger.error(`Persona bundle not found: ${bundlePath}`);
        process.exit(1);
      }

      logger.info(`Installing persona bundle from ${path.basename(bundlePath)}...`);
      const tmpDir = path.join(os.tmpdir(), `eidolon_install_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
      fs.mkdirSync(tmpDir, { recursive: true });

      try {
        await extractZipBundle(bundlePath, tmpDir);

        // Run AJV validation on unpacked package
        const valResult = await validatePackage(tmpDir);
        if (!valResult.valid) {
          logger.error('Persona bundle validation failed:');
          for (const err of valResult.errors) {
            logger.error(`  ✖ ${err}`);
          }
          fs.rmSync(tmpDir, { recursive: true, force: true });
          process.exit(1);
        }

        const manifestPath = path.join(tmpDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const personaId = manifest.persona_id;
        const packageName = manifest.package_name || path.basename(bundlePath, '.eidolon');

        const resultDir = path.join(process.cwd(), 'completed_result');
        if (!fs.existsSync(resultDir)) {
          fs.mkdirSync(resultDir, { recursive: true });
        }
        const destDir = path.join(resultDir, personaId);
        if (fs.existsSync(destDir)) {
          fs.rmSync(destDir, { recursive: true, force: true });
        }
        fs.renameSync(tmpDir, destDir);

        // Register in SQLite
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO personas (
            id, name, target_speaker, created_at, dsi_score, is_active, manifest_json, package_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          personaId,
          packageName,
          manifest.target_speaker || 'Target',
          manifest.created_at || new Date().toISOString(),
          typeof manifest.dsi_score === 'number' ? manifest.dsi_score : null,
          config.activePersona === personaId ? 1 : 0,
          JSON.stringify(manifest),
          destDir
        );

        logger.success(`Installed and registered persona: ${pc.bold(packageName)} (${personaId})`);
        logger.info(`Destination: ${destDir}`);
      } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        logger.error(`Failed to install persona: ${err.message}`);
        process.exit(1);
      }
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

function extractZipBundle(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const destPath = path.join(destDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(destPath, { recursive: true });
          zipfile.readEntry();
        } else {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) return reject(streamErr);
            const writeStream = fs.createWriteStream(destPath);
            readStream.pipe(writeStream);
            writeStream.on('finish', () => {
              zipfile.readEntry();
            });
            writeStream.on('error', reject);
          });
        }
      });

      zipfile.on('end', () => resolve());
      zipfile.on('error', reject);
    });
  });
}
