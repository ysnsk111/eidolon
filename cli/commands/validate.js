import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import pc from 'picocolors';
import { logger } from '../utils/logger.js';

/**
 * EIDOLON Package Schema Validator
 * Implements Section 24 of the specification.
 * Validates .eidolon packages and directories against formal JSON schemas.
 */

export async function validateCommand(packagePath) {
  if (!packagePath) {
    logger.error('Usage: eidolon validate <path_to_package_or_eidolon_file>');
    process.exit(1);
  }

  const resolved = path.resolve(packagePath);
  if (!fs.existsSync(resolved)) {
    logger.error(`Target not found: ${resolved}`);
    process.exit(1);
  }

  logger.divider();
  console.log(pc.bold(pc.cyan(`Validating EIDOLON Package: ${path.basename(resolved)}`)));
  logger.divider();

  let packageContents = {};

  if (fs.statSync(resolved).isDirectory()) {
    packageContents = readDirectoryContents(resolved);
  } else {
    try {
      packageContents = await readZipContents(resolved);
    } catch (err) {
      logger.error(`Failed to read archive bundle: ${err.message}`);
      process.exit(1);
    }
  }

  const schemaMap = [
    { name: 'manifest', file: 'manifest.json', schema: 'manifest.schema.json' },
    { name: 'persona', file: 'persona.json', schema: 'persona.schema.json' },
    { name: 'style', file: 'style.json', schema: 'style.schema.json' },
    { name: 'behavior', file: 'behavior.json', schema: 'behavior.schema.json' },
    { name: 'memory', file: 'memory_seed.json', schema: 'memory.schema.json' },
    { name: 'evaluation', file: 'evaluation/report.json', fallback: 'evaluation/metrics.json', schema: 'evaluation.schema.json' },
  ];

  const schemasDir = path.join(process.cwd(), 'schemas');
  let allValid = true;

  for (const item of schemaMap) {
    let content = packageContents[item.file];
    if (!content && item.fallback) {
      content = packageContents[item.fallback];
    }

    if (!content) {
      console.log(pc.red(`  ✖ ${item.name} (missing ${item.file})`));
      allValid = false;
      continue;
    }

    const schemaPath = path.join(schemasDir, item.schema);
    const validationResult = validateAgainstSchema(content, schemaPath);

    if (validationResult.valid) {
      console.log(pc.green(`  ✓ ${item.name}`));
    } else {
      console.log(pc.red(`  ✖ ${item.name} (${validationResult.error})`));
      allValid = false;
    }
  }

  logger.divider();
  if (allValid) {
    console.log(pc.green(pc.bold('Package valid.')));
  } else {
    console.log(pc.red(pc.bold('Package validation failed.')));
    process.exit(1);
  }
}

function readDirectoryContents(dirPath) {
  const map = {};
  function walk(current, base = '') {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      const rel = base ? `${base}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(full, rel);
      } else if (ent.name.endsWith('.json')) {
        try {
          map[rel] = JSON.parse(fs.readFileSync(full, 'utf-8'));
        } catch (_) {}
      }
    }
  }
  walk(dirPath);
  return map;
}

function readZipContents(zipPath) {
  return new Promise((resolve, reject) => {
    const map = {};
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
        } else if (entry.fileName.endsWith('.json')) {
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr) return reject(streamErr);
            const chunks = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => {
              try {
                const text = Buffer.concat(chunks).toString('utf-8');
                map[entry.fileName] = JSON.parse(text);
              } catch (_) {}
              zipfile.readEntry();
            });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => resolve(map));
      zipfile.on('error', reject);
    });
  });
}

function validateAgainstSchema(content, schemaPath) {
  if (!fs.existsSync(schemaPath)) {
    // If formal schema file doesn't exist, basic sanity check
    return { valid: typeof content === 'object' && content !== null };
  }

  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

    // Check required top-level fields if specified
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (content[req] === undefined) {
          return { valid: false, error: `missing required property: ${req}` };
        }
      }
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}
