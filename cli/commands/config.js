import { loadConfig, updateConfig, saveConfig } from '../utils/config.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import { logger } from '../utils/logger.js';
import { serviceCommand } from './service.js';
import { setCurrentLanguage, t } from '../utils/i18n.js';
import pc from 'picocolors';
import ora from 'ora';

export async function configCommand(action, key, value) {
  const config = loadConfig();

  switch (action) {
    case 'show': {
      logger.divider();
      console.log(pc.bold(pc.cyan('EIDOLON Configuration Profile:')));
      console.log(JSON.stringify(config, null, 2));
      logger.divider();
      break;
    }

    case 'set': {
      if (!key || value === undefined) {
        logger.error('Usage: eidolon config set <key.path> <value>');
        process.exit(1);
      }
      let parsedValue = value;
      try {
        parsedValue = JSON.parse(value);
      } catch (_) {
        // Keep string if not valid JSON
      }

      if (key === 'language' || key === 'lang') {
        const langCode = setCurrentLanguage(parsedValue);
        logger.success(`Updated language to: ${langCode}`);
        console.log(pc.cyan(`\n${t('config.updated_lang', { lang: langCode })}`));
        try {
          await serviceCommand('restart');
        } catch (err) {
          logger.warn(`Could not auto-restart background service: ${err.message}`);
        }
        break;
      }

      updateConfig(key, parsedValue);
      logger.success(`Updated config: ${key} = ${JSON.stringify(parsedValue)}`);
      break;
    }

    case 'test': {
      logger.divider();
      console.log(pc.bold('Testing LLM Provider Connectivity...'));
      logger.info(`Endpoint: ${config.llm.baseUrl}`);
      logger.info(`Model: ${config.llm.model}`);

      const spinner = ora('Sending ping handshake to LLM endpoint...').start();
      const provider = new OpenAICompatibleProvider(config.llm);

      const res = await provider.testConnection();
      if (res.ok) {
        spinner.succeed(pc.green(`Handshake SUCCESSFUL! LLM is connected.`));
        logger.info(`Provider Response: "${res.response}"`);
      } else {
        spinner.fail(pc.red(`Handshake FAILED: ${res.error}`));
        logger.warn('Please verify your baseUrl, apiKey, and model configuration.');
      }
      logger.divider();
      break;
    }

    case 'edit': {
      logger.info(`Config file location: ${loadConfig.__path || '~/.config/eidolon/config.json'}`);
      logger.info('Use `eidolon config set <key> <value>` or edit the JSON file directly.');
      break;
    }

    default:
      logger.error(`Unknown config action: "${action}". Valid actions: show, set, test, edit.`);
      break;
  }
}
