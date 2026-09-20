import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

// Load .env if present in current working directory
dotenv.config();

const CONFIG_DIR = path.join(os.homedir(), '.config', 'eidolon');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  version: '1.2.5',
  onboarded: false,
  llm: {
    baseUrl: process.env.EIDOLON_LLM_BASE_URL || 'http://localhost:8083/v1',
    apiKey: process.env.EIDOLON_LLM_API_KEY || '',
    model: process.env.EIDOLON_LLM_MODEL || 'opencode/nemotron-3.5-lightning-free',
    criticModel: process.env.EIDOLON_LLM_CRITIC_MODEL || 'opencode/critic-model',
    judgeModel: process.env.EIDOLON_LLM_JUDGE_MODEL || 'opencode/judge-model',
    temperature: 0.7,
    maxTokens: 2048,
    timeoutMs: 60000,
  },
  bot: {
    telegramToken: process.env.EIDOLON_TELEGRAM_TOKEN || '',
    allowedUsers: process.env.EIDOLON_ALLOWED_USERS
      ? process.env.EIDOLON_ALLOWED_USERS.split(',').map((id) => id.trim()).filter(Boolean)
      : [],
    pollTimeout: 30,
    enableTypingSimulation: true,
  },
  server: {
    host: '127.0.0.1',
    port: 8090,
    dbPath: path.join(CONFIG_DIR, 'eidolon.db'),
    logPath: path.join(CONFIG_DIR, 'runtime.log'),
  },
  evaluation: {
    dsiThreshold: 0.80,
    lexicalThreshold: 0.80,
    styleThreshold: 0.80,
    behaviorThreshold: 0.75,
    contextThreshold: 0.90,
    candidateCount: 3,
  },
  activePersona: null,
  storage: {
    completedResultDir: path.join(process.cwd(), 'completed_result'),
    runtimeDir: path.join(CONFIG_DIR, 'runtime'),
  },
};

export function getConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  return CONFIG_DIR;
}

export function loadConfig() {
  getConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (err) {
    console.error('Failed to parse config file, using defaults:', err.message);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  getConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function updateConfig(keyPath, value) {
  const cfg = loadConfig();
  const keys = keyPath.split('.');
  let curr = cfg;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!curr[keys[i]] || typeof curr[keys[i]] !== 'object') {
      curr[keys[i]] = {};
    }
    curr = curr[keys[i]];
  }
  curr[keys[keys.length - 1]] = value;
  saveConfig(cfg);
  return cfg;
}

function deepMerge(target, source) {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}
