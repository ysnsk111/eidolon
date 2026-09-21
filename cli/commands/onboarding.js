import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import fs from 'node:fs';
import pc from 'picocolors';
import ora from 'ora';
import { loadConfig, updateConfig, saveConfig, getConfigDir } from '../utils/config.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { verifyBotToken } from '../utils/telegram.js';
import { serviceCommand } from './service.js';
import { distillCommand } from './distill.js';
import { logger } from '../utils/logger.js';
import { initCommand } from './init.js';
import { SUPPORTED_LANGUAGES, setCurrentLanguage, t } from '../utils/i18n.js';

async function ask(rl, questionText, defaultValue = '') {
  const prompt = defaultValue ? `${questionText} [${defaultValue}]: ` : `${questionText}: `;
  const answer = await rl.question(prompt);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

export async function runOnboardingWizard(options = {}) {
  logger.divider();
  console.log(pc.bold(pc.cyan(`✨ ${t('app.welcome')} ✨`)));
  console.log(pc.bold(t('app.subtitle')));
  console.log(pc.gray(t('app.note_silent_bot')));
  logger.divider();

  // Ensure local DB & directories are initialized
  await initCommand({ silent: true });

  // Ensure robot is NOT running initially ("先不启动机器人")
  const configDir = getConfigDir();
  const pidFile = path.join(configDir, 'eidolon.pid');
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      fs.unlinkSync(pidFile);
    } catch (_) {}
  }

  const config = loadConfig();
  const isNonInteractive = options.nonInteractive || process.env.EIDOLON_NON_INTERACTIVE === '1';

  let rl;
  if (!isNonInteractive) {
    rl = readline.createInterface({ input, output });
  }

  try {
    // -------------------------------------------------------------
    // Step 0: Language Preference (8 languages)
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow(`\n${t('wizard.step_lang')}`)));
    console.log(pc.white('  1) English (Default)'));
    console.log(pc.white('  2) 简体中文 (Simplified Chinese)'));
    console.log(pc.white('  3) 繁體中文 (Traditional Chinese)'));
    console.log(pc.white('  4) 日本語 (Japanese)'));
    console.log(pc.white('  5) 한국어 (Korean)'));
    console.log(pc.white('  6) Русский (Russian)'));
    console.log(pc.white('  7) Français (French)'));
    console.log(pc.white('  8) Español (Spanish)'));

    let selectedLang = options.language || config.language || 'en';
    if (!isNonInteractive) {
      const choice = await ask(rl, `  ${t('wizard.select_lang_prompt')} (1-8)`, '1');
      const langMap = {
        '1': 'en',
        '2': 'zh-CN',
        '3': 'zh-TW',
        '4': 'ja',
        '5': 'ko',
        '6': 'ru',
        '7': 'fr',
        '8': 'es',
      };
      selectedLang = langMap[choice.trim()] || (SUPPORTED_LANGUAGES.some((l) => l.code === choice.trim()) ? choice.trim() : 'en');
    }
    setCurrentLanguage(selectedLang);
    console.log(pc.green(`  ✔ ${t('wizard.lang_set', { lang: selectedLang })}`));

    // -------------------------------------------------------------
    // Step 1: LLM API Connection & Simple-Test (先不启动机器人)
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow(`\n${t('wizard.step_llm')}`)));
    console.log(pc.gray(t('wizard.llm_desc')));

    let apiReady = false;
    let baseUrl = options.llmBaseUrl || config.llm?.baseUrl || 'http://localhost:8083/v1';
    let apiKey = options.llmApiKey || config.llm?.apiKey || 'sk-oc2oai-017d49ffb8309de5673932058071ce95';
    let model = options.llmModel || config.llm?.model || 'opencode/nemotron-3.5-lightning-free';

    while (!apiReady) {
      if (!isNonInteractive) {
        baseUrl = await ask(rl, `  ${t('wizard.base_url_prompt')}`, baseUrl);
        apiKey = await ask(rl, `  ${t('wizard.api_key_prompt')}`, apiKey);
        model = await ask(rl, `  ${t('wizard.model_prompt')}`, model);
      }

      console.log(pc.cyan(`\n  ${t('wizard.testing_api')}`));
      const spinner = ora(`  ${t('wizard.test_sending')}`).start();

      const testProvider = new OpenAICompatibleProvider({
        baseUrl,
        apiKey,
        model,
        timeoutMs: 30000,
      });

      const testRes = await testProvider.testConnection();

      if (testRes.ok) {
        spinner.succeed(pc.green(`  ${t('wizard.test_success')}`));
        console.log(pc.gray(`    Endpoint response: "${testRes.response}"`));
        updateConfig('llm.baseUrl', baseUrl);
        updateConfig('llm.apiKey', apiKey);
        updateConfig('llm.model', model);
        apiReady = true;
      } else {
        spinner.fail(pc.red(`  ${t('wizard.test_failed', { error: testRes.error })}`));
        if (isNonInteractive) {
          throw new Error(`Model API test failed: ${testRes.error}`);
        }
        const retry = await ask(rl, `  ${t('wizard.test_retry')}`, 'Y');
        if (retry.toLowerCase() === 'n' || retry.toLowerCase() === 'no') {
          console.log(pc.yellow(`  ${t('wizard.test_skipped')}`));
          updateConfig('llm.baseUrl', baseUrl);
          updateConfig('llm.apiKey', apiKey);
          updateConfig('llm.model', model);
          apiReady = true;
        }
      }
    }

    // -------------------------------------------------------------
    // Step 2: Distillation Data File Path & Context Backstory
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow(`\n${t('wizard.step_distill_data')}`)));

    let distillFilePath = options.input || '';
    let fileValid = false;

    while (!fileValid) {
      if (!isNonInteractive) {
        distillFilePath = await ask(rl, `  ${t('wizard.distill_path_prompt')}`, distillFilePath || 'tests/fixtures/chat_sample.txt');
      } else if (!distillFilePath) {
        distillFilePath = 'tests/fixtures/chat_sample.txt';
      }

      const absPath = path.resolve(process.cwd(), distillFilePath);
      if (fs.existsSync(absPath)) {
        console.log(pc.green(`  ✔ Validated: ${absPath}`));
        distillFilePath = absPath;
        fileValid = true;
      } else {
        console.log(pc.red(`  ${t('wizard.file_not_found', { path: absPath })}`));
        if (isNonInteractive) {
          throw new Error(`File not found: ${absPath}`);
        }
        distillFilePath = '';
      }
    }

    // Supplementary World Context
    let contextFilePath = options.context || null;
    let supplementText = options.supplementText || options.contextText || '';

    if (!isNonInteractive && !contextFilePath) {
      supplementText = await ask(rl, `  ${t('wizard.world_context_prompt')}`, '');
    }

    if (supplementText) {
      const resolvedCheck = path.resolve(process.cwd(), supplementText);
      if (fs.existsSync(resolvedCheck) && fs.statSync(resolvedCheck).isFile()) {
        contextFilePath = resolvedCheck;
        console.log(pc.green(`  ✔ Mounted context file: ${contextFilePath}`));
      } else {
        const configDir = getConfigDir();
        contextFilePath = path.join(configDir, 'world_context.md');
        fs.writeFileSync(contextFilePath, `# EIDOLON Supplementary World Context\n\n${supplementText}\n`, 'utf-8');
        console.log(pc.green(`  ${t('wizard.context_saved', { path: contextFilePath })}`));
      }
    }

    // -------------------------------------------------------------
    // Step 3: Telegram Bot Token & User ID
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow(`\n${t('wizard.step_bot')}`)));
    console.log(pc.gray(t('wizard.bot_desc')));

    let botToken = options.botToken || config.bot?.telegramToken || '8921441705:AAGUANTfr3NEyohWTy3Rwn9Ewebo8cusnTE';
    let botUsername = 'TelegramBot';
    let tokenValid = false;

    while (!tokenValid) {
      if (!isNonInteractive) {
        botToken = await ask(rl, `  ${t('wizard.bot_token_prompt')}`, botToken);
      }

      const verifyRes = await verifyBotToken(botToken);
      if (verifyRes.ok) {
        botUsername = verifyRes.username;
        console.log(pc.green(`  ${t('wizard.bot_token_valid', { username: botUsername, firstName: verifyRes.firstName })}`));
        tokenValid = true;
      } else {
        console.log(pc.red(`  ✘ Telegram Token verification failed: ${verifyRes.error}`));
        if (isNonInteractive) {
          tokenValid = true;
          break;
        }
        const retry = await ask(rl, '  Retry entering token? [Y/n]', 'Y');
        if (retry.toLowerCase() === 'n' || retry.toLowerCase() === 'no') {
          tokenValid = true;
        }
      }
    }

    // User ID prompt
    const defaultUserID = config.bot?.allowedUsers?.[0] || '8287471787';
    let tgUserID = options.userId || '';
    if (!isNonInteractive) {
      tgUserID = await ask(rl, `  ${t('wizard.user_id_prompt')}`, defaultUserID);
    } else if (!tgUserID) {
      tgUserID = defaultUserID;
    }

    updateConfig('bot.telegramToken', botToken);
    updateConfig('bot.allowedUsers', [String(tgUserID).trim()]);
    console.log(pc.green(`  ${t('wizard.user_id_saved', { userId: tgUserID })}`));

    // -------------------------------------------------------------
    // Step 4: Launch Bot & Pairing
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow(`\n${t('wizard.step_auth')}`)));
    console.log(pc.cyan(`  ${t('wizard.bot_launching')}`));

    try {
      const pidFile = path.join(getConfigDir(), 'eidolon.pid');
      const isRunning = fs.existsSync(pidFile) && (() => {
        try {
          const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
          process.kill(pid, 0);
          return true;
        } catch (_) {
          return false;
        }
      })();

      if (isRunning) {
        await serviceCommand('restart');
      } else {
        await serviceCommand('start');
      }
    } catch (err) {
      console.log(pc.yellow(`  Service startup notice: ${err.message}`));
    }

    logger.divider();
    console.log(pc.bold(pc.magenta('  📢 Instructions:')));
    console.log(pc.bold(`  1. Open Telegram and find: ${pc.cyan('@' + botUsername)}`));
    console.log(pc.bold(`  2. Send command: ${pc.green('/start')}`));
    console.log(pc.gray(`  ${t('wizard.pairing_instructions', { username: botUsername })}`));
    logger.divider();

    if (!isNonInteractive) {
      const spinner = ora(`  ${t('wizard.waiting_pairing')}`).start();
      let paired = false;
      const pollStart = Date.now();
      const currentCfg = loadConfig();
      const serverPort = currentCfg.server?.port || 8090;
      const serverHost = currentCfg.server?.host || '127.0.0.1';

      while (!paired && Date.now() - pollStart < 45000) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const res = await fetch(`http://${serverHost}:${serverPort}/api/bot/pairing-status`);
          if (res.ok) {
            const pData = await res.json();
            if (pData.paired) {
              paired = true;
              break;
            }
          }
        } catch (_) {}
      }

      if (paired) {
        spinner.succeed(pc.green(`  ${t('wizard.pairing_success', { userId: tgUserID })}`));
      } else {
        spinner.info(pc.yellow('  Note: Pairing detection timeout. If /start was already sent, you may proceed.'));
      }
    }

    updateConfig('onboarded', true);
    logger.success(t('wizard.complete_title'));

    // -------------------------------------------------------------
    // Step 5: Distillation Confirmation
    // -------------------------------------------------------------
    logger.divider();
    console.log(pc.bold(pc.cyan(`🚀 ${t('wizard.step_distill_confirm')}`)));

    let startDistill = 'Y';
    if (!isNonInteractive) {
      startDistill = await ask(rl, `\n${t('wizard.confirm_distill_prompt')}`, 'Y');
    } else if (options.startDistill !== undefined) {
      startDistill = options.startDistill ? 'Y' : 'N';
    }

    if (startDistill.toLowerCase() === 'y' || startDistill.toLowerCase() === 'yes') {
      logger.info(t('wizard.distill_started'));
      await distillCommand(distillFilePath, {
        context: contextFilePath,
      });
    } else {
      console.log(pc.green(`\n✔ ${t('wizard.distill_later')}`));
      console.log(pc.cyan(`  eidolon distill "${distillFilePath}"${contextFilePath ? ` --context "${contextFilePath}"` : ''}`));
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}
