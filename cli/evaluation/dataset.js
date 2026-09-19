import fs from 'node:fs';
import path from 'node:path';

/**
 * EIDOLON Evaluation Dataset Exporter & Loader
 * Implements Section 17 & 18 of the specification.
 */

export function exportDatasets({ distillationSet, validationSet, blindTestSet, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });

  const trainPath = path.join(outputDir, 'train.jsonl');
  const valPath = path.join(outputDir, 'validation.jsonl');
  const testPath = path.join(outputDir, 'test.jsonl');

  writeJsonl(trainPath, distillationSet);
  writeJsonl(valPath, validationSet);
  writeJsonl(testPath, blindTestSet);

  return {
    trainPath,
    valPath,
    testPath,
  };
}

export function loadDataset(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dataset file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line) => JSON.parse(line));
}

function writeJsonl(filePath, items) {
  const content = items.map((item) => JSON.stringify(item)).join('\n');
  fs.writeFileSync(filePath, content ? `${content}\n` : '', 'utf-8');
}
