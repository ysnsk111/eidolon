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

async function ask(rl, questionText, defaultValue = '') {
  const prompt = defaultValue ? `${questionText} [${defaultValue}]: ` : `${questionText}: `;
  const answer = await rl.question(prompt);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

export async function runOnboardingWizard(options = {}) {
  logger.divider();
  console.log(pc.bold(pc.cyan('✨ 欢迎使用 EIDOLON — 人格蒸馏与记忆运行时 ✨')));
  console.log(pc.bold('首次安装部署用户引导程序'));
  console.log(pc.gray('本引导程序将逐步指导您完成模型连接、语料配置与机器人安全配对。\n注意：在完成前期参数配置前，机器人将保持静默暂不启动。'));
  logger.divider();

  // Ensure local DB & directories are initialized
  await initCommand({ silent: true });

  const config = loadConfig();
  const isNonInteractive = options.nonInteractive || process.env.EIDOLON_NON_INTERACTIVE === '1';

  let rl;
  if (!isNonInteractive) {
    rl = readline.createInterface({ input, output });
  }

  try {
    // -------------------------------------------------------------
    // Step 1: LLM API Connection & Simple-Test (先不启动机器人)
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow('\n【步骤 1/5】连接语言模型 API (LLM API Configuration)')));
    console.log(pc.gray('请配置兼容 OpenAI 接口标准的模型服务地址、鉴权 Key 与模型名称。'));

    let apiReady = false;
    let baseUrl = options.llmBaseUrl || config.llm?.baseUrl || 'http://localhost:8083/v1';
    let apiKey = options.llmApiKey || config.llm?.apiKey || '';
    let model = options.llmModel || config.llm?.model || 'opencode/nemotron-3.5-lightning-free';

    while (!apiReady) {
      if (!isNonInteractive) {
        baseUrl = await ask(rl, '  • 模型 API 端点地址 (Base URL)', baseUrl);
        apiKey = await ask(rl, '  • 模型 API Key (留空表示无)', apiKey);
        model = await ask(rl, '  • 模型名称 (Model Name)', model);
      }

      console.log(pc.cyan('\n  正在对模型 API 执行 simple-test 连通性与可用性测试...'));
      const spinner = ora('  发送测试握手请求至模型端点...').start();

      const testProvider = new OpenAICompatibleProvider({
        baseUrl,
        apiKey,
        model,
        timeoutMs: 30000,
      });

      const testRes = await testProvider.testConnection();

      if (testRes.ok) {
        spinner.succeed(pc.green('  ✔ 模型 API simple-test 验证成功！回复正常，API 可用。'));
        console.log(pc.gray(`    端点回复: "${testRes.response}"`));
        updateConfig('llm.baseUrl', baseUrl);
        updateConfig('llm.apiKey', apiKey);
        updateConfig('llm.model', model);
        apiReady = true;
      } else {
        spinner.fail(pc.red(`  ✘ 模型 API 测试未通过: ${testRes.error}`));
        if (isNonInteractive) {
          throw new Error(`Model API test failed: ${testRes.error}`);
        }
        const retry = await ask(rl, '  是否修改后重试 API 配置？[Y/n]', 'Y');
        if (retry.toLowerCase() === 'n' || retry.toLowerCase() === 'no') {
          console.log(pc.yellow('  已跳过 API 验证，使用当前输入配置保存。'));
          updateConfig('llm.baseUrl', baseUrl);
          updateConfig('llm.apiKey', apiKey);
          updateConfig('llm.model', model);
          apiReady = true;
        }
      }
    }

    // -------------------------------------------------------------
    // Step 2: Distillation Data File Path
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow('\n【步骤 2/5】指定蒸馏语料文件路径 (Distillation File Path)')));
    console.log(pc.gray('请输入需要蒸馏的目标对象历史聊天记录文件路径（支持 PDF, JSON, HTML, TXT 格式）。'));

    let distillFilePath = options.input || '';
    let fileValid = false;

    while (!fileValid) {
      if (!isNonInteractive) {
        distillFilePath = await ask(rl, '  • 聊天记录文件路径 (Path to chat file)', distillFilePath || 'tests/fixtures/chat_sample.txt');
      } else if (!distillFilePath) {
        distillFilePath = 'tests/fixtures/chat_sample.txt';
      }

      const absPath = path.resolve(process.cwd(), distillFilePath);
      if (fs.existsSync(absPath)) {
        console.log(pc.green(`  ✔ 文件校验通过: ${absPath}`));
        distillFilePath = absPath;
        fileValid = true;
      } else {
        console.log(pc.red(`  ✘ 指定的文件不存在: ${absPath}`));
        if (isNonInteractive) {
          throw new Error(`File not found: ${absPath}`);
        }
      }
    }

    // -------------------------------------------------------------
    // Step 3: Supplementary Worldview & Context
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow('\n【步骤 3/5】补充背景设定与世界观 (Supplementary World Context)')));
    console.log(pc.gray('继续追问：有什么需要补充的背景信息吗？'));
    console.log(pc.gray('（补充的内容一般是聊天记录里不会出现的、大环境、世界观世界线、未言明的经历与关系背景等）'));

    let contextFilePath = options.context || null;
    let supplementText = '';

    if (!isNonInteractive && !contextFilePath) {
      console.log(pc.cyan('  提示：可直接输入一段文本补充说明，或输入已有设定文件路径（例如 world.md），无补充直接按回车跳过。'));
      supplementText = await ask(rl, '  • 补充内容 / 背景文件路径', '');
    }

    if (supplementText) {
      const resolvedCheck = path.resolve(process.cwd(), supplementText);
      if (fs.existsSync(resolvedCheck) && fs.statSync(resolvedCheck).isFile()) {
        contextFilePath = resolvedCheck;
        console.log(pc.green(`  ✔ 已挂载世界观设定文件: ${contextFilePath}`));
      } else {
        // Save user's supplementary text to a local markdown file
        const configDir = getConfigDir();
        contextFilePath = path.join(configDir, 'world_context.md');
        fs.writeFileSync(contextFilePath, `# EIDOLON 补充世界观与大环境设定\n\n${supplementText}\n`, 'utf-8');
        console.log(pc.green(`  ✔ 已保存补充的世界观与大环境设定至: ${contextFilePath}`));
      }
    } else if (contextFilePath) {
      console.log(pc.green(`  ✔ 使用指定背景设定文件: ${contextFilePath}`));
    } else {
      console.log(pc.gray('  ✔ 未提供补充信息，将直接基于聊天记录本身构建记忆与关系。'));
    }

    // -------------------------------------------------------------
    // Step 4: Telegram Bot Token & User ID
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow('\n【步骤 4/5】Telegram 机器人与用户配对绑定 (Bot Token & User ID)')));
    console.log(pc.gray('连接 Telegram 机器人并输入您自己的 User ID 进行首次保存。'));

    let botToken = options.botToken || config.bot?.telegramToken || '8921441705:AAGUANTfr3NEyohWTy3Rwn9Ewebo8cusnTE';
    let botUsername = 'TelegramBot';
    let tokenValid = false;

    while (!tokenValid) {
      if (!isNonInteractive) {
        botToken = await ask(rl, '  • 请输入 Telegram Bot Token', botToken);
      }

      const verifyRes = await verifyBotToken(botToken);
      if (verifyRes.ok) {
        botUsername = verifyRes.username;
        console.log(pc.green(`  ✔ Telegram Bot 连通成功: @${botUsername} (${verifyRes.firstName})`));
        tokenValid = true;
      } else {
        console.log(pc.red(`  ✘ Telegram Token 校验失败: ${verifyRes.error}`));
        if (isNonInteractive) {
          tokenValid = true; // allow in mock/test
          break;
        }
        const retry = await ask(rl, '  是否重新输入 Token？[Y/n]', 'Y');
        if (retry.toLowerCase() === 'n' || retry.toLowerCase() === 'no') {
          tokenValid = true;
        }
      }
    }

    // User ID prompt
    const defaultUserID = config.bot?.allowedUsers?.[0] || '8287471787';
    let tgUserID = options.userId || '';
    if (!isNonInteractive) {
      tgUserID = await ask(rl, '  • 请输入您的 Telegram User ID 进行首次保存 (可在 TG 咨询 @userinfobot 获取)', defaultUserID);
    } else if (!tgUserID) {
      tgUserID = defaultUserID;
    }

    // Save token and userID
    updateConfig('bot.telegramToken', botToken);
    updateConfig('bot.allowedUsers', [String(tgUserID).trim()]);
    console.log(pc.green(`  ✔ Telegram Token 与 User ID (${tgUserID}) 已完成首次保存！`));

    // -------------------------------------------------------------
    // Step 5: Start Robot and Pair via /start (启动机器人鉴权配对)
    // -------------------------------------------------------------
    console.log(pc.bold(pc.yellow('\n【步骤 5/5】启动机器人并发送 /start 完成最后鉴权配对')));
    console.log(pc.cyan('  正在启动 EIDOLON 运行时服务与 Telegram 机器人...'));

    try {
      await serviceCommand('start');
    } catch (err) {
      console.log(pc.yellow(`  启动服务提示: ${err.message}`));
    }

    logger.divider();
    console.log(pc.bold(pc.magenta('  📢 操作指引:')));
    console.log(pc.bold(`  1. 请打开 Telegram，搜索并进入机器人私聊: ${pc.cyan('@' + botUsername)}`));
    console.log(pc.bold(`  2. 向机器人发送指令: ${pc.green('/start')}`));
    console.log(pc.gray('  机器人收到后将完成最后鉴权配对并自动清理配对指令。'));
    logger.divider();

    if (!isNonInteractive) {
      const spinner = ora('  等待 Telegram 鉴权配对中 (请在 Telegram 发送 /start)...').start();
      let paired = false;
      const pollStart = Date.now();
      const serverPort = config.server?.port || 8090;
      const serverHost = config.server?.host || '127.0.0.1';

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
        spinner.succeed(pc.green(`  ✔ 鉴权配对成功！机器人已正式与您的 Telegram 账号绑定！`));
      } else {
        spinner.info(pc.yellow('  提示：未能自动检测到 /start 或等待超时。若您已发送 /start，可继续下一步。'));
      }
    }

    // Mark onboarding complete
    updateConfig('onboarded', true);
    logger.success('EIDOLON 首次部署引导配置已全部完成！');

    // -------------------------------------------------------------
    // Distillation Confirmation (通过cli确认是否启动蒸馏)
    // -------------------------------------------------------------
    logger.divider();
    console.log(pc.bold(pc.cyan('🚀 人格蒸馏就绪确认')));
    console.log(pc.gray('语料文件: ') + distillFilePath);
    if (contextFilePath) console.log(pc.gray('世界观补充: ') + contextFilePath);

    let startDistill = 'Y';
    if (!isNonInteractive) {
      startDistill = await ask(rl, '\n是否立即启动人格蒸馏？(可在 Telegram 机器人实时汇报进度) [Y/n]', 'Y');
    } else if (options.startDistill !== undefined) {
      startDistill = options.startDistill ? 'Y' : 'N';
    }

    if (startDistill.toLowerCase() === 'y' || startDistill.toLowerCase() === 'yes') {
      logger.info('正在启动人格蒸馏引擎...');
      await distillCommand(distillFilePath, {
        context: contextFilePath,
      });
    } else {
      console.log(pc.green('\n✔ 已跳过即时蒸馏。您随时可以在终端执行以下命令启动蒸馏:'));
      console.log(pc.cyan(`  eidolon distill "${distillFilePath}"${contextFilePath ? ` --context "${contextFilePath}"` : ''}`));
    }
  } finally {
    if (rl) {
      rl.close();
    }
  }
}
