import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, updateConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCALES_DIR = path.join(__dirname, '..', 'locales');

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'zh-CN', label: 'Simplified Chinese', native: '简体中文' },
  { code: 'zh-TW', label: 'Traditional Chinese', native: '繁體中文' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'ko', label: 'Korean', native: '한국어' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'es', label: 'Spanish', native: 'Español' },
];

const localeCache = new Map();

function loadLocaleFile(langCode) {
  if (localeCache.has(langCode)) {
    return localeCache.get(langCode);
  }
  const filePath = path.join(LOCALES_DIR, `${langCode}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      localeCache.set(langCode, data);
      return data;
    } catch (_) {}
  }
  return null;
}

export function getCurrentLanguage() {
  try {
    const config = loadConfig();
    if (config && config.language) {
      const match = SUPPORTED_LANGUAGES.find(
        (l) => l.code.toLowerCase() === config.language.toLowerCase()
      );
      if (match) return match.code;
    }
  } catch (_) {}
  return 'en';
}

export function setCurrentLanguage(langCode) {
  const norm = (langCode || '').trim();
  const match = SUPPORTED_LANGUAGES.find(
    (l) => l.code.toLowerCase() === norm.toLowerCase() ||
           l.label.toLowerCase() === norm.toLowerCase() ||
           l.native.toLowerCase() === norm.toLowerCase()
  );
  if (!match) {
    throw new Error(
      `Unsupported language "${langCode}". Supported: ${SUPPORTED_LANGUAGES.map((l) => l.code).join(', ')}`
    );
  }
  updateConfig('language', match.code);
  return match.code;
}

export function t(key, params = {}, explicitLang = null) {
  const lang = explicitLang || getCurrentLanguage();
  const translations = loadLocaleFile(lang) || loadLocaleFile('en') || {};
  const enTranslations = loadLocaleFile('en') || {};

  let val = translations[key] ?? enTranslations[key] ?? key;

  if (typeof val === 'string' && params) {
    for (const [k, v] of Object.entries(params)) {
      val = val.replaceAll(`{${k}}`, String(v));
    }
  }
  return val;
}
