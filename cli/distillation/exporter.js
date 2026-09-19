import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import archiver from 'archiver';

/**
 * EIDOLON Persona Package Exporter & .eidolon Bundler
 * Implements Section 22, 27, 32, 60, 61 of the specification.
 */

export async function exportPersonaPackage({
  outputBaseDir,
  personaId,
  manifest,
  persona,
  style,
  behavior,
  languageModel,
  world,
  relationships,
  memorySeed,
  assets,
  evaluationReport,
  evaluationHtml,
  reproducibilityOptions = {},
}) {
  const targetDir = path.join(outputBaseDir || path.join(process.cwd(), 'completed_result'), personaId);
  fs.mkdirSync(targetDir, { recursive: true });

  const memoryDir = path.join(targetDir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  const evalDir = path.join(targetDir, 'evaluation');
  fs.mkdirSync(evalDir, { recursive: true });

  const assetsDir = path.join(targetDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  // 1. Root JSON components (Section 27 layout)
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(targetDir, 'persona.json'), JSON.stringify(persona, null, 2));
  fs.writeFileSync(path.join(targetDir, 'style.json'), JSON.stringify(style, null, 2));
  fs.writeFileSync(path.join(targetDir, 'behavior.json'), JSON.stringify(behavior, null, 2));
  fs.writeFileSync(path.join(targetDir, 'language.json'), JSON.stringify(languageModel, null, 2));
  fs.writeFileSync(path.join(targetDir, 'language_model.json'), JSON.stringify(languageModel, null, 2)); // compatibility alias
  fs.writeFileSync(path.join(targetDir, 'rhythm.json'), JSON.stringify(behavior.conversation_rhythm || {}, null, 2));
  fs.writeFileSync(path.join(targetDir, 'assets.json'), JSON.stringify(assets || {}, null, 2));
  fs.writeFileSync(path.join(targetDir, 'world.json'), JSON.stringify(world || {}, null, 2));
  fs.writeFileSync(path.join(targetDir, 'relationships.json'), JSON.stringify(relationships || {}, null, 2));
  fs.writeFileSync(path.join(targetDir, 'timeline.json'), JSON.stringify(world?.timeline || [], null, 2));

  // 2. Memory layers in memory/ directory
  const l0 = memorySeed?.l0 || [];
  const l1 = memorySeed?.l1 || memorySeed?.episodes || [];
  const l2 = memorySeed?.l2 || memorySeed?.facts || [];
  const l3 = memorySeed?.l3 || memorySeed?.world_grounding || [];

  fs.writeFileSync(path.join(memoryDir, 'l0.json'), JSON.stringify(l0, null, 2));
  fs.writeFileSync(path.join(memoryDir, 'l1.json'), JSON.stringify(l1, null, 2));
  fs.writeFileSync(path.join(memoryDir, 'l2.json'), JSON.stringify(l2, null, 2));
  fs.writeFileSync(path.join(memoryDir, 'l3.json'), JSON.stringify(l3, null, 2));
  fs.writeFileSync(path.join(targetDir, 'memory_seed.json'), JSON.stringify(memorySeed || {}, null, 2)); // root alias

  // 3. Evaluation directory artifacts
  fs.writeFileSync(path.join(evalDir, 'metrics.json'), JSON.stringify(evaluationReport.metrics || {}, null, 2));
  fs.writeFileSync(path.join(evalDir, 'dsi.json'), JSON.stringify({
    dsi: evaluationReport.dsi,
    dsi_scaled: evaluationReport.dsi_scaled,
    status: evaluationReport.status,
    gate_results: evaluationReport.gate_results,
    weights: { L: 0.20, S: 0.20, B: 0.25, C: 0.15, H: 0.20 },
  }, null, 2));
  fs.writeFileSync(path.join(evalDir, 'failures.json'), JSON.stringify(evaluationReport.failure_cases || [], null, 2));
  fs.writeFileSync(path.join(evalDir, 'blind_test.json'), JSON.stringify(evaluationReport.blind_test || [], null, 2));
  fs.writeFileSync(path.join(evalDir, 'report.json'), JSON.stringify(evaluationReport, null, 2));
  if (evaluationHtml) {
    fs.writeFileSync(path.join(evalDir, 'report.html'), evaluationHtml);
  }

  // Assets compatibility
  fs.writeFileSync(path.join(assetsDir, 'emoji.json'), JSON.stringify(assets.emojis || [], null, 2));
  fs.writeFileSync(path.join(assetsDir, 'stickers.json'), JSON.stringify(assets.stickers || [], null, 2));

  // 4. Reproducibility metadata (Section 22)
  const datasetHash = computeHash(JSON.stringify(languageModel) + JSON.stringify(behavior));
  const promptHash = computeHash(JSON.stringify(persona.system_prompts || {}));
  const reproducibility = {
    reproducibility: {
      eidolon_version: manifest.eidolon_version || '1.1.0',
      git_commit: reproducibilityOptions.gitCommit || getGitCommitHash(),
      model: reproducibilityOptions.model || 'distill-pipeline-v1',
      provider: reproducibilityOptions.provider || 'local-statistical',
      temperature: reproducibilityOptions.temperature ?? 0.2,
      seed: reproducibilityOptions.seed || 42,
      dataset_hash: datasetHash,
      context_hash: computeHash(JSON.stringify(world || {})),
      prompt_hash: promptHash,
      created_at: new Date().toISOString(),
    },
  };
  fs.writeFileSync(path.join(targetDir, 'reproducibility.json'), JSON.stringify(reproducibility, null, 2));

  // 5. Package README
  const readmeContent = `# EIDOLON Persona: ${persona.name} (${personaId})

- **EIDOLON Version**: ${manifest.eidolon_version || '1.1.0'}
- **Distillation Date**: ${manifest.created_at}
- **Distillation Similarity Index (DSI)**: ${(manifest.dsi_score * 100).toFixed(1)}%
- **Evaluation Status**: ${manifest.evaluation_status}

## Metrics Breakdown
- Lexical Similarity (L): ${((evaluationReport.metrics?.lexical || 0) * 100).toFixed(1)}%
- Style Similarity (S): ${((evaluationReport.metrics?.style || 0) * 100).toFixed(1)}%
- Behavior Similarity (B): ${((evaluationReport.metrics?.behavior || 0) * 100).toFixed(1)}%
- Context Consistency (C): ${((evaluationReport.metrics?.context || 0) * 100).toFixed(1)}%
- Blind Judge Score (H): ${((evaluationReport.metrics?.blind_judge || 0) * 100).toFixed(1)}%

## Usage
Activate this persona in the runtime:
\`\`\`bash
eidolon persona activate ${personaId}
eidolon status
\`\`\`
`;
  fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);

  // 6. Compress package into .eidolon archive bundle
  const archivePath = path.join(path.dirname(targetDir), `${personaId}.eidolon`);
  await compressDirectory(targetDir, archivePath);

  return {
    packageDir: targetDir,
    archivePath,
  };
}

function computeHash(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 16);
}

function getGitCommitHash() {
  try {
    const gitHeadPath = path.join(process.cwd(), '.git', 'HEAD');
    if (!fs.existsSync(gitHeadPath)) return 'unknown';
    const head = fs.readFileSync(gitHeadPath, 'utf-8').trim();
    if (head.startsWith('ref:')) {
      const refPath = path.join(process.cwd(), '.git', head.slice(5).trim());
      if (fs.existsSync(refPath)) {
        return fs.readFileSync(refPath, 'utf-8').trim().slice(0, 12);
      }
    }
    return head.slice(0, 12);
  } catch (_) {
    return 'unknown';
  }
}

function compressDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(outPath));
    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}
