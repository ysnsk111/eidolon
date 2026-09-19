import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { getConfigDir, loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import pc from 'picocolors';

export async function serviceCommand(action) {
  const config = loadConfig();
  const configDir = getConfigDir();
  const pidFile = path.join(configDir, 'eidolon.pid');
  const logFile = config.server.logPath || path.join(configDir, 'runtime.log');

  switch (action) {
    case 'start': {
      if (isDaemonRunning(pidFile)) {
        logger.warn(`EIDOLON service is already running (PID: ${fs.readFileSync(pidFile, 'utf-8').trim()}).`);
        return;
      }

      logger.info('Starting EIDOLON persistent service daemon...');

      // Find server binary
      const serverBin = path.join(process.cwd(), 'bin', 'eidolon-server');
      const hasGoServer = fs.existsSync(serverBin);

      let child;
      if (hasGoServer) {
        const out = fs.openSync(logFile, 'a');
        const err = fs.openSync(logFile, 'a');
        child = spawn(serverBin, [], {
          detached: true,
          stdio: ['ignore', out, err],
          env: {
            ...process.env,
            EIDOLON_CONFIG: path.join(configDir, 'config.json'),
          },
        });
      } else {
        // Run lightweight node fallback server
        const nodeServerScript = path.join(process.cwd(), 'server', 'node-server.js');
        const out = fs.openSync(logFile, 'a');
        const err = fs.openSync(logFile, 'a');
        child = spawn('node', [nodeServerScript], {
          detached: true,
          stdio: ['ignore', out, err],
          env: process.env,
        });
      }

      child.unref();
      fs.writeFileSync(pidFile, String(child.pid), 'utf-8');
      logger.success(`EIDOLON service started (PID: ${child.pid})`);
      logger.info(`Logs: ${logFile}`);
      logger.info(`Web Dashboard: http://${config.server.host}:${config.server.port}`);
      break;
    }

    case 'stop': {
      if (!isDaemonRunning(pidFile)) {
        logger.info('EIDOLON service is not running.');
        if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
        return;
      }

      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      logger.info(`Stopping EIDOLON daemon (PID: ${pid})...`);
      try {
        process.kill(pid, 'SIGTERM');
        fs.unlinkSync(pidFile);
        logger.success('Service stopped.');
      } catch (err) {
        logger.error(`Failed to kill process ${pid}: ${err.message}`);
      }
      break;
    }

    case 'restart': {
      await serviceCommand('stop');
      await new Promise((r) => setTimeout(r, 1000));
      await serviceCommand('start');
      break;
    }

    case 'status': {
      const running = isDaemonRunning(pidFile);
      logger.divider();
      console.log(pc.bold(pc.cyan('EIDOLON Daemon Status:')));
      if (running) {
        const pid = fs.readFileSync(pidFile, 'utf-8').trim();
        console.log(`Status:  ${pc.green('● RUNNING')} (PID: ${pid})`);
        console.log(`Address: http://${config.server.host}:${config.server.port}`);
        console.log(`Logs:    ${logFile}`);
      } else {
        console.log(`Status:  ${pc.red('● STOPPED')}`);
      }
      logger.divider();
      break;
    }

    default:
      logger.error(`Unknown service action: "${action}". Valid actions: start, stop, restart, status.`);
      break;
  }
}

export function logsCommand(options = {}) {
  const config = loadConfig();
  const logFile = config.server.logPath || path.join(getConfigDir(), 'runtime.log');
  if (!fs.existsSync(logFile)) {
    logger.warn(`Log file does not exist yet: ${logFile}`);
    return;
  }

  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  const tailCount = options.lines ? parseInt(options.lines, 10) : 50;
  console.log(lines.slice(-tailCount).join('\n'));
}

function isDaemonRunning(pidFile) {
  if (!fs.existsSync(pidFile)) return false;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 0); // check existence without killing
    return true;
  } catch (_) {
    return false;
  }
}
