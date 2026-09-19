import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';

/**
 * EIDOLON Persona Package Exporter & .eidolon Bundler
 * Implements Section 32, Section 60, and Section 61 of the specification.
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
}) {
  const targetDir = path.join(outputBaseDir || path.join(process.cwd(), 'completed_result'), personaId);
  fs.mkdirSync(targetDir, { recursive: true });

  const assetsDir = path.join(targetDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const evalDir = path.join(targetDir, 'evaluation');
  fs.mkdirSync(evalDir, { recursive: true });

  // 1. Write root json components
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(targetDir, 'persona.json'), JSON.stringify(persona, null, 2));
  fs.writeFileSync(path.join(targetDir, 'style.json'), JSON.stringify(style, null, 2));
  fs.writeFileSync(path.join(targetDir, 'behavior.json'), JSON.stringify(behavior, null, 2));
  fs.writeFileSync(path.join(targetDir, 'language_model.json'), JSON.stringify(languageModel, null, 2));
  fs.writeFileSync(path.join(targetDir, 'world.json'), JSON.stringify(world, null, 2));
  fs.writeFileSync(path.join(targetDir, 'relationships.json'), JSON.stringify(relationships, null, 2));
  fs.writeFileSync(path.join(targetDir, 'memory_seed.json'), JSON.stringify(memorySeed, null, 2));

  // 2. Write assets
  fs.writeFileSync(path.join(assetsDir, 'emoji.json'), JSON.stringify(assets.emojis || [], null, 2));
  fs.writeFileSync(path.join(assetsDir, 'stickers.json'), JSON.stringify(assets.stickers || [], null, 2));

  // 3. Write evaluation report artifacts
  fs.writeFileSync(path.join(evalDir, 'report.json'), JSON.stringify(evaluationReport, null, 2));
  fs.writeFileSync(path.join(evalDir, 'metrics.json'), JSON.stringify(evaluationReport.metrics || {}, null, 2));
  fs.writeFileSync(path.join(evalDir, 'failures.json'), JSON.stringify(evaluationReport.failure_cases || [], null, 2));
  if (evaluationHtml) {
    fs.writeFileSync(path.join(evalDir, 'report.html'), evaluationHtml);
  }

  // 4. Write README.md for this persona
  const readmeContent = `# EIDOLON Persona: ${persona.name} (${personaId})

- **EIDOLON Version**: ${manifest.eidolon_version}
- **Distillation Date**: ${manifest.created_at}
- **Distillation Similarity Index (DSI)**: ${(manifest.dsi_score * 100).toFixed(1)}%
- **Evaluation Status**: ${manifest.evaluation_status}

## Metrics Breakdown
- Lexical Similarity: ${((evaluationReport.metrics?.lexical || 0) * 100).toFixed(1)}%
- Style Similarity: ${((evaluationReport.metrics?.style || 0) * 100).toFixed(1)}%
- Behavior Similarity: ${((evaluationReport.metrics?.behavior || 0) * 100).toFixed(1)}%
- Context Consistency: ${((evaluationReport.metrics?.context || 0) * 100).toFixed(1)}%
- Blind Judge Score: ${((evaluationReport.metrics?.blind_judge || 0) * 100).toFixed(1)}%

## Usage
Activate this persona in the runtime:
\`\`\`bash
eidolon persona activate ${personaId}
eidolon status
\`\`\`
`;
  fs.writeFileSync(path.join(targetDir, 'README.md'), readmeContent);

  // 5. Compress package into .eidolon archive bundle
  const archivePath = path.join(path.dirname(targetDir), `${personaId}.eidolon`);
  await compressDirectory(targetDir, archivePath);

  return {
    packageDir: targetDir,
    archivePath,
  };
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
