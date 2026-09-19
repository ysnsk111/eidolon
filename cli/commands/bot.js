import { loadConfig, updateConfig, saveConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import pc from 'picocolors';

export async function botCommand(action, subaction, value) {
  const config = loadConfig();

  switch (action) {
    case 'token': {
      if (subaction === 'set') {
        if (!value) {
          logger.error('Usage: eidolon bot token set <TELEGRAM_BOT_TOKEN>');
          process.exit(1);
        }
        updateConfig('bot.telegramToken', value.trim());
        logger.success('Telegram bot token updated.');
      } else if (subaction === 'test') {
        const token = config.bot.telegramToken;
        if (!token) {
          logger.warn('No Telegram bot token configured. Set one with `eidolon bot token set <token>`');
          break;
        }
        logger.info('Verifying Telegram token with api.telegram.org...');
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
          const data = await res.json();
          if (data.ok) {
            logger.success(`Telegram Bot Connected: @${data.result.username} (${data.result.first_name})`);
          } else {
            logger.error(`Telegram API Error: ${data.description}`);
          }
        } catch (err) {
          logger.error(`Network Error connecting to Telegram: ${err.message}`);
        }
      }
      break;
    }

    case 'user': {
      const allowed = new Set((config.bot.allowedUsers || []).map(String));

      if (subaction === 'add') {
        if (!value) {
          logger.error('Usage: eidolon bot user add <user_id>');
          process.exit(1);
        }
        allowed.add(String(value).trim());
        updateConfig('bot.allowedUsers', Array.from(allowed));
        logger.success(`Added user ID ${value} to Telegram allowlist.`);
      } else if (subaction === 'remove') {
        if (!value) {
          logger.error('Usage: eidolon bot user remove <user_id>');
          process.exit(1);
        }
        allowed.delete(String(value).trim());
        updateConfig('bot.allowedUsers', Array.from(allowed));
        logger.success(`Removed user ID ${value} from Telegram allowlist.`);
      } else if (subaction === 'list') {
        logger.divider();
        console.log(pc.bold(pc.cyan('Allowed Telegram Users:')));
        allowed.forEach((u) => console.log(`  • ${u}`));
        logger.divider();
      }
      break;
    }

    case 'status': {
      logger.divider();
      console.log(pc.bold(pc.cyan('Telegram Bot Configuration:')));
      console.log(`Token: ${config.bot.telegramToken ? 'configured (hidden)' : pc.red('NOT SET')}`);
      console.log(`Allowed Users: ${(config.bot.allowedUsers || []).join(', ') || 'None'}`);
      console.log(`Typing Simulation: ${config.bot.enableTypingSimulation ? pc.green('ENABLED') : pc.yellow('DISABLED')}`);
      console.log(`Streaming/SSE: ${pc.red('DISABLED (per v1 spec)')}`);
      logger.divider();
      break;
    }

    default:
      logger.error(`Unknown bot action: "${action}". Valid actions: token, user, status.`);
      break;
  }
}
