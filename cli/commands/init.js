import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getConfigDir, loadConfig, saveConfig, DEFAULT_CONFIG } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import pc from 'picocolors';

export async function initCommand(options = {}) {
  const silent = options.silent === true;
  if (!silent) {
    logger.divider();
    logger.info('Initializing EIDOLON environment...');
  }

  // 1. Config directory
  const configDir = getConfigDir();
  if (!silent) logger.success(`Configuration directory ready: ${configDir}`);

  // 2. Default config file
  const config = loadConfig();
  saveConfig(config);
  if (!silent) logger.success(`Configuration file initialized: ${path.join(configDir, 'config.json')}`);

  // 3. Results directory
  const resultDir = path.join(process.cwd(), 'completed_result');
  if (!fs.existsSync(resultDir)) {
    fs.mkdirSync(resultDir, { recursive: true });
  }
  logger.success(`Output repository directory ready: ${resultDir}`);

  // 4. Initialize SQLite Database schemas
  const dbPath = config.server.dbPath || path.join(configDir, 'eidolon.db');
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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      persona_id TEXT,
      user_id TEXT,
      start_time TEXT,
      last_active_time TEXT,
      message_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      persona_id TEXT,
      user_id TEXT,
      sender TEXT,
      content TEXT,
      timestamp TEXT,
      reply_to_id TEXT,
      latency_ms INTEGER DEFAULT 0,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      persona_id TEXT,
      layer TEXT, -- L0, L1, L2, L3
      category TEXT,
      key TEXT,
      value TEXT,
      importance_score REAL,
      valid_from TEXT,
      valid_to TEXT,
      confidence REAL DEFAULT 1.0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scheduler_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      message_id TEXT,
      calculated_delay_ms INTEGER,
      actual_delay_ms INTEGER,
      jitter_ms INTEGER,
      typing_duration_ms INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subsystem TEXT,
      level TEXT,
      message TEXT,
      timestamp TEXT
    );
  `);

  db.close();
  if (!silent) {
    logger.success(`SQLite persistence database initialized: ${dbPath}`);
    logger.divider();
    logger.success(pc.bold('EIDOLON initialization complete!'));
    console.log(`
Next steps:
  1. Configure LLM API:
     ${pc.cyan('eidolon config test')}
     ${pc.cyan('eidolon config edit')}
  2. Distill chat history into persona:
     ${pc.cyan('eidolon distill /path/to/chat.pdf --context /path/to/world.md')}
  3. Start the runtime server:
     ${pc.cyan('eidolon service start')}
`);
  }
}
