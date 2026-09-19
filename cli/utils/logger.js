import pc from 'picocolors';

export const logger = {
  info: (msg, ...args) => console.log(pc.cyan('ℹ'), msg, ...args),
  success: (msg, ...args) => console.log(pc.green('✔'), pc.bold(msg), ...args),
  warn: (msg, ...args) => console.log(pc.yellow('⚠'), pc.yellow(msg), ...args),
  error: (msg, ...args) => console.error(pc.red('✖'), pc.red(msg), ...args),
  step: (step, total, msg) => console.log(pc.blue(`[${step}/${total}]`), pc.bold(msg)),
  dim: (msg) => console.log(pc.dim(msg)),
  table: (data) => console.table(data),
  divider: () => console.log(pc.dim('─'.repeat(60))),
};
