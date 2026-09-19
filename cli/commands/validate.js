import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import Ajv from 'ajv';
import pc from 'picocolors';
import { logger } from '../utils/logger.js';

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

/**
 * EIDOLON Package Schema Validator
 * Implements Section 24 of the specification.
 * Validates .eidolon packages and directories against formal JSON schemas using Ajv.
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

  const result = await validatePackage(resolved);

  for (const item of result.details) {
    if (item.valid) {
      console.log(pc.green(`  ✓ ${item.name}`));
    } else {
      console.log(pc.red(`  ✖ ${item.name}`));
      if (Array.isArray(item.errors)) {
        for (const err of item.errors) {
          console.log(pc.red(`      ${err}`));
        }
      } else if (item.error) {
        console.log(pc.red(`      ${item.error}`));
      }
    }
  }

  logger.divider();
  if (result.valid) {
    console.log(pc.green(pc.bold('Package valid.')));
  } else {
    console.log(pc.red(pc.bold('Package validation failed.')));
    process.exit(1);
  }
}

export async function validatePackage(packagePath) {
  const resolved = path.resolve(packagePath);
  let packageContents = {};

  if (fs.statSync(resolved).isDirectory()) {
    packageContents = readDirectoryContents(resolved);
  } else {
    packageContents = await readZipContents(resolved);
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
  const details = [];
  const allErrors = [];

  for (const item of schemaMap) {
    let content = packageContents[item.file];
    if (!content && item.fallback) {
      content = packageContents[item.fallback];
    }

    if (!content) {
      allValid = false;
      const msg = `missing ${item.file}`;
      details.push({ name: item.name, valid: false, error: msg, errors: [msg] });
      allErrors.push(`${item.name}: ${msg}`);
      continue;
    }

    const schemaPath = path.join(schemasDir, item.schema);
    const validationResult = validateAgainstSchema(content, schemaPath);

    if (validationResult.valid) {
      details.push({ name: item.name, valid: true });
    } else {
      allValid = false;
      details.push({
        name: item.name,
        valid: false,
        error: validationResult.error,
        errors: validationResult.formattedErrors || [validationResult.error],
      });
      allErrors.push(`${item.name}: ${validationResult.error}`);
    }
  }

  return {
    valid: allValid,
    details,
    errors: allErrors,
  };
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
    return { valid: typeof content === 'object' && content !== null };
  }

  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const validate = ajv.compile(schema);
    const valid = validate(content);

    if (!valid) {
      const formattedErrors = (validate.errors || []).map(
        (e) => `${e.instancePath || '/'} ${e.message}`
      );
      return {
        valid: false,
        error: formattedErrors.join('; '),
        formattedErrors,
        errors: validate.errors,
      };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message, formattedErrors: [err.message] };
  }
}
