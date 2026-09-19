import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import archiver from 'archiver';
import { DatabaseSync } from 'node:sqlite';
import { validatePackage } from '../../cli/commands/validate.js';

describe('Package Validation, Security & SQLite Registration Tests', () => {
  test('validatePackage should strictly validate all 6 JSON schemas for a valid package', async () => {
    const tmpDir = path.join(os.tmpdir(), `eidolon_val_test_${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, 'evaluation'), { recursive: true });

    // Write all 6 schema-compliant files
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({
        eidolon_version: '1.1.0',
        package_name: 'eidolon-persona-alice',
        persona_id: 'persona_20260919_120000',
        created_at: new Date().toISOString(),
        dsi_score: 0.85,
        evaluation_status: 'PASS',
        components: {
          persona: 'persona.json',
          style: 'style.json',
          behavior: 'behavior.json',
          language_model: 'language_model.json',
          world: 'world.json',
          relationships: 'relationships.json',
          memory_seed: 'memory_seed.json',
          assets: 'assets/',
          evaluation: 'evaluation/',
        },
      })
    );

    fs.writeFileSync(
      path.join(tmpDir, 'persona.json'),
      JSON.stringify({
        id: 'persona_20260919_120000',
        version: '1.1.0',
        name: 'Alice',
        created_at: new Date().toISOString(),
        target_speaker: 'Alice',
        counterpart_speaker: 'Bob',
        identity: {
          core_traits: ['warm', 'playful'],
          relationship_dynamic: 'close friends',
          emotional_baseline: 'optimistic',
          boundary_rules: ['no medical advice'],
        },
        linguistic_fingerprint: {
          vocabulary: { top_words: ['好呀', '拉面'] },
          punctuation: { ellipsis_rate: 0.2 },
          sentence_metrics: { avg_length: 12 },
          openers: ['哈喽'],
          closers: ['明天见~'],
        },
        response_policy: {
          strategies: ['banter', 'empathy'],
          follow_up_rate: 0.15,
          double_message_rate: 0.08,
        },
        system_prompts: {
          generator: 'You are Alice.',
          critic: 'Evaluate response.',
          rewriter: 'Rewrite if needed.',
          judge: 'Blind judge.',
          memory: 'Extract memory.',
        },
      })
    );

    fs.writeFileSync(
      path.join(tmpDir, 'style.json'),
      JSON.stringify({
        version: '1.1.0',
        metrics: {
          ellipsis_rate: 0.15,
          question_rate: 0.20,
          exclamation_rate: 0.25,
          line_break_rate: 0.05,
          repetition_rate: 0.02,
          emoji_density: 0.10,
        },
        conditional_probabilities: {
          p_emoji_given_joking: 0.85,
        },
        punctuation_profile: {
          favored_punctuations: ['~', '！', '…'],
          terminal_punctuation_drop_rate: 0.30,
        },
        length_distribution: {
          median: 14,
          p90: 35,
          mean: 16.5,
          std_dev: 8.2,
        },
      })
    );

    fs.writeFileSync(
      path.join(tmpDir, 'behavior.json'),
      JSON.stringify({
        version: '1.1.0',
        response_policies: [
          {
            situation: 'joking',
            strategy: 'playful banter',
            observed_strategy: 'banter',
            evidence_count: 5,
            confidence: 0.9,
            length_bias: 'short',
            emoji_probability: 0.8,
            follow_up_probability: 0.3,
          },
        ],
        conversation_rhythm: {
          base_delay_ms: 2200,
          double_message_probability: 0.08,
          topic_switch_probability: 0.12,
        },
      })
    );

    fs.writeFileSync(
      path.join(tmpDir, 'memory_seed.json'),
      JSON.stringify({
        version: '1.1.0',
        persona_id: 'persona_20260919_120000',
        working_memory: { recent_turns: [], active_topic: '', user_state: 'neutral' },
        episodes: [
          {
            id: 'ep_1',
            timestamp: null,
            temporal_precision: 'unknown',
            summary: 'Exam prep at library',
            importance_score: 0.85,
            sentiment: 'positive',
            source: 'historical_conversation',
          },
        ],
        facts: [
          {
            key: 'preference:ramen',
            category: 'preference',
            versions: [
              {
                value: 'likes tonkotsu ramen',
                valid_from: null,
                valid_to: null,
                temporal_precision: 'unknown',
                confidence: 0.90,
              },
            ],
          },
        ],
        timeline: [
          {
            event_id: 'ev_1',
            date_or_period: 'Spring 2026',
            title: 'Midterm exams',
            description: 'Studied together at library',
            impact: 'high',
          },
        ],
      })
    );

    fs.writeFileSync(
      path.join(tmpDir, 'evaluation', 'report.json'),
      JSON.stringify({
        version: '1.1.0',
        persona_id: 'persona_20260919_120000',
        created_at: new Date().toISOString(),
        dataset_size: 1,
        metrics: {
          lexical: 0.82,
          style: 0.88,
          behavior: 0.90,
          context: null,
          blind_judge: 0.85,
        },
        sub_metrics: {
          emoji_fidelity: 0.88,
          vocabulary_fidelity: 0.82,
          sentence_rhythm: 0.88,
          response_strategy: 0.90,
          context_fidelity: null,
        },
        dsi: 0.86,
        dsi_scaled: 86.0,
        status: 'PASS',
        gate_results: {
          dsi_pass: true,
          lexical_pass: true,
          style_pass: true,
          behavior_pass: true,
          context_pass: true,
        },
        failure_cases: [],
      })
    );

    const result = await validatePackage(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    assert.strictEqual(result.valid, true, `Validation errors: ${result.errors.join('; ')}`);
    assert.strictEqual(result.details.length, 6);
    for (const d of result.details) {
      assert.strictEqual(d.valid, true, `Schema ${d.name} failed`);
    }
  });

  test('validatePackage should detect missing components and reject malformed schemas', async () => {
    const tmpDir = path.join(os.tmpdir(), `eidolon_val_fail_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Missing required files
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({
        eidolon_version: '1.1.0',
        // missing required fields
      })
    );

    const result = await validatePackage(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  test('Zip slip path traversal payloads must be detected and rejected', async () => {
    const zipPath = path.join(os.tmpdir(), `malicious_${Date.now()}.zip`);
    const { execSync } = await import('node:child_process');
    execSync(`python3 -c 'import zipfile; z = zipfile.ZipFile("${zipPath}", "w"); z.writestr("../evil.txt", "evil content"); z.close()'`);

    const targetDir = path.join(os.tmpdir(), `safe_extract_${Date.now()}`);
    fs.mkdirSync(targetDir, { recursive: true });

    let installThrew = false;
    const yauzl = (await import('yauzl')).default;
    await new Promise((resolve) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          installThrew = true;
          return resolve();
        }
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          const safePath = path.normalize(entry.fileName).replace(/^(\.\.[\/\\])+/, '');
          const destPath = path.resolve(targetDir, safePath);
          if (!destPath.startsWith(path.resolve(targetDir) + path.sep) && destPath !== path.resolve(targetDir)) {
            installThrew = true;
            return resolve();
          }
          zipfile.readEntry();
        });
        zipfile.on('error', (err) => {
          installThrew = true;
          resolve();
        });
        zipfile.on('end', resolve);
      });
    });

    fs.rmSync(zipPath, { force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
    assert.strictEqual(installThrew, true, 'Path traversal must be detected and rejected');
  });

  test('SQLite personas table registration and activation state tracking', () => {
    const dbPath = path.join(os.tmpdir(), `test_personas_${Date.now()}.db`);
    const db = new DatabaseSync(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_speaker TEXT,
        created_at TEXT NOT NULL,
        dsi_score REAL,
        is_active INTEGER DEFAULT 0,
        manifest_json TEXT,
        package_path TEXT
      );
    `);

    // Insert persona A and B
    db.prepare(`
      INSERT INTO personas (id, name, target_speaker, created_at, dsi_score, is_active, manifest_json, package_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('persona_alice', 'eidolon-persona-alice', 'Alice', '2026-03-01T00:00:00Z', 0.85, 0, '{}', '/path/alice');

    db.prepare(`
      INSERT INTO personas (id, name, target_speaker, created_at, dsi_score, is_active, manifest_json, package_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('persona_bob', 'eidolon-persona-bob', 'Bob', '2026-03-01T00:00:00Z', 0.82, 0, '{}', '/path/bob');

    // Activate Alice
    db.prepare(`UPDATE personas SET is_active = 0`).run();
    db.prepare(`UPDATE personas SET is_active = 1 WHERE id = ?`).run('persona_alice');

    const activeRow = db.prepare(`SELECT id, is_active FROM personas WHERE is_active = 1`).get();
    assert.strictEqual(activeRow.id, 'persona_alice');
    assert.strictEqual(activeRow.is_active, 1);

    // Switch activation to Bob
    db.prepare(`UPDATE personas SET is_active = 0`).run();
    db.prepare(`UPDATE personas SET is_active = 1 WHERE id = ?`).run('persona_bob');

    const newActive = db.prepare(`SELECT id, is_active FROM personas WHERE is_active = 1`).get();
    assert.strictEqual(newActive.id, 'persona_bob');

    const aliceRow = db.prepare(`SELECT id, is_active FROM personas WHERE id = 'persona_alice'`).get();
    assert.strictEqual(aliceRow.is_active, 0);

    db.close();
    fs.rmSync(dbPath, { force: true });
  });
});
