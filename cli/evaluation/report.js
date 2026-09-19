import Table from 'cli-table3';
import pc from 'picocolors';
import { formatScore, formatStatus } from '../utils/format.js';

export function printEvaluationTable(report) {
  console.log('\n' + pc.bold(pc.cyan('EIDOLON DISTILLATION EVALUATION')));
  console.log(pc.dim('─'.repeat(45)));
  console.log(`${pc.bold('Persona:')} ${report.persona_id}`);
  console.log(`${pc.bold('Dataset:')} ${report.dataset_size} blind samples\n`);

  if (report.status === 'INSUFFICIENT_DATA') {
    console.log(pc.yellow(`⚠ Cannot evaluate persona: ${report.error || 'Blind test dataset is empty'}`));
    console.log(pc.dim('─'.repeat(45)));
    console.log(pc.bold(`Status: ${formatStatus(report.status)}\n`));
    return;
  }

  const table = new Table({
    head: [pc.white('Metric Dimension'), pc.white('Score'), pc.white('Quality Gate')],
    colWidths: [26, 14, 16],
  });

  table.push(
    ['Lexical Similarity', formatScore(report.metrics.lexical), report.gate_results.lexical_pass ? pc.green('PASS (≥80%)') : pc.red('FAIL (<80%)')],
    ['Style Similarity', formatScore(report.metrics.style), report.gate_results.style_pass ? pc.green('PASS (≥80%)') : pc.red('FAIL (<80%)')],
    ['Behavior Similarity', formatScore(report.metrics.behavior), report.gate_results.behavior_pass ? pc.green('PASS (≥75%)') : pc.red('FAIL (<75%)')],
    ['Context Consistency', formatScore(report.metrics.context), report.gate_results.context_pass ? pc.green('PASS (≥90%)') : pc.red('FAIL (<90%)')],
    ['Blind Judge', formatScore(report.metrics.blind_judge), pc.dim('Blind Peer')]
  );

  console.log(table.toString());
  console.log(pc.dim('─'.repeat(45)));
  console.log(pc.bold(`DSI (Distillation Similarity Index): ${formatScore(report.dsi)}`));
  console.log(pc.bold(`Status: ${formatStatus(report.status)}\n`));
}

export function generateEvaluationReportHtml(report, persona) {
  const dsiPercent = report.dsi !== null && report.dsi !== undefined ? (report.dsi * 100).toFixed(1) : 'N/A';
  const failureRows = (report.failure_cases || []).map((f, i) => `
    <div class="failure-card">
      <div class="failure-header">
        <span class="sample-tag">Sample #${String(i + 1).padStart(3, '0')} (${f.sample_id})</span>
        <span class="score-tag ${f.score >= 0.75 ? 'tag-warn' : 'tag-fail'}">${(f.score * 100).toFixed(1)}%</span>
      </div>
      <div class="dialog-context">
        <strong>Context:</strong>
        <p>${escapeHtml(f.context.join(' → '))}</p>
      </div>
      <div class="diff-grid">
        <div class="diff-box orig">
          <label>Original Historical Target</label>
          <div class="bubble">${escapeHtml(f.original_target)}</div>
        </div>
        <div class="diff-box gen">
          <label>Generated Synthetic Candidate</label>
          <div class="bubble">${escapeHtml(f.generated_candidate)}</div>
        </div>
      </div>
      <div class="issues-list">
        <strong>Identified Divergence:</strong>
        <ul>
          ${f.issues.map((iss) => `<li>• ${escapeHtml(iss)}</li>`).join('')}
        </ul>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EIDOLON Evaluation Report — ${escapeHtml(persona.name || report.persona_id)}</title>
  <style>
    :root {
      --bg: #090b10;
      --card-bg: #121620;
      --card-border: #1e2638;
      --accent: #00d2ff;
      --accent-glow: rgba(0, 210, 255, 0.25);
      --success: #00e676;
      --warn: #ffab00;
      --danger: #ff1744;
      --text: #e2e8f0;
      --text-dim: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      padding: 30px 20px;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    header {
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 25px;
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 15px;
    }
    h1 { font-size: 28px; font-weight: 700; color: #fff; letter-spacing: 1px; }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.5px;
    }
    .badge-pass { background: rgba(0, 230, 118, 0.15); color: var(--success); border: 1px solid var(--success); }
    .badge-fail { background: rgba(255, 23, 68, 0.15); color: var(--danger); border: 1px solid var(--danger); }
    .dsi-hero {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 30px;
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 30px;
      align-items: center;
      margin-bottom: 30px;
    }
    .dsi-circle {
      width: 150px;
      height: 150px;
      border-radius: 50%;
      border: 4px solid var(--accent);
      box-shadow: 0 0 25px var(--accent-glow);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin: 0 auto;
    }
    .dsi-val { font-size: 38px; font-weight: 800; color: #fff; }
    .dsi-label { font-size: 11px; text-transform: uppercase; color: var(--text-dim); letter-spacing: 1px; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 15px;
    }
    .metric-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 15px;
    }
    .metric-title { font-size: 12px; color: var(--text-dim); text-transform: uppercase; }
    .metric-num { font-size: 22px; font-weight: 700; color: #fff; margin: 4px 0; }
    .progress-bar { width: 100%; height: 6px; background: #1e2638; border-radius: 3px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--accent); }
    h2 { font-size: 20px; margin: 30px 0 15px; color: #fff; }
    .failure-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .failure-header { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
    .sample-tag { color: var(--accent); font-weight: 600; }
    .score-tag { padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
    .tag-warn { background: rgba(255, 171, 0, 0.2); color: var(--warn); }
    .tag-fail { background: rgba(255, 23, 68, 0.2); color: var(--danger); }
    .dialog-context { font-size: 13px; color: var(--text-dim); margin-bottom: 15px; }
    .diff-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
    .diff-box label { font-size: 11px; text-transform: uppercase; color: var(--text-dim); display: block; margin-bottom: 6px; }
    .bubble { background: #1a2233; padding: 12px; border-radius: 8px; font-size: 14px; border-left: 3px solid #334155; }
    .diff-box.orig .bubble { border-color: var(--success); }
    .diff-box.gen .bubble { border-color: var(--accent); }
    .issues-list ul { list-style: none; margin-top: 6px; font-size: 13px; color: #f87171; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>EIDOLON Distillation Evaluation Report</h1>
        <p style="color: var(--text-dim); font-size: 14px;">Persona: ${escapeHtml(persona.name || report.persona_id)} | Dataset: ${report.dataset_size} samples</p>
      </div>
      <div>
        <span class="badge ${report.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">STATUS: ${report.status}</span>
      </div>
    </header>

    <div class="dsi-hero">
      <div class="dsi-circle">
        <div class="dsi-val">${dsiPercent}</div>
        <div class="dsi-label">DSI Score</div>
      </div>
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-title">Lexical (20%)</div>
          <div class="metric-num">${(report.metrics.lexical * 100).toFixed(1)}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width: ${(report.metrics.lexical * 100)}%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Style (20%)</div>
          <div class="metric-num">${(report.metrics.style * 100).toFixed(1)}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width: ${(report.metrics.style * 100)}%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Behavior (25%)</div>
          <div class="metric-num">${(report.metrics.behavior * 100).toFixed(1)}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width: ${(report.metrics.behavior * 100)}%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Context (15%)</div>
          <div class="metric-num">${(report.metrics.context * 100).toFixed(1)}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width: ${(report.metrics.context * 100)}%"></div></div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Blind Judge (20%)</div>
          <div class="metric-num">${(report.metrics.blind_judge * 100).toFixed(1)}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width: ${(report.metrics.blind_judge * 100)}%"></div></div>
        </div>
      </div>
    </div>

    <h2>Divergence & Failure Cases Inspector</h2>
    ${failureRows || '<p style="color: var(--text-dim);">No significant style divergence detected. All quality gates passed.</p>'}
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
