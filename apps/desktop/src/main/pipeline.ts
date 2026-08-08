/**
 * Pipeline Operations Module
 *
 * Integrates all web pipeline scripts into desktop app:
 * - Daily Operations
 * - Autonomous Operator
 * - Conversion Engine
 * - Deal Finalization
 * - Pipeline Force Action
 */

import { ipcMain, BrowserWindow } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { logger } from './logger';

// Script paths relative to web app
const WEB_SCRIPTS_PATH = path.join(__dirname, '..', '..', '..', '..', 'web', 'scripts');

interface PipelineConfig {
  smtpUser: string;
  smtpPass: string;
  databaseUrl: string;
  testEmail: string;
}

let activeProcess: ChildProcess | null = null;

// Pipeline operations
export const PipelineOperations = {
  DAILY_OPS: 'daily-operations.mjs',
  AUTONOMOUS: 'autonomous-operator.mjs',
  CONVERSION: 'conversion-engine.mjs',
  DEAL_FINALIZATION: 'deal-finalization-engine.mjs',
  PIPELINE_FORCE: 'pipeline-force-action.mjs',
  CONVERSATION_AUDIT: 'conversation-audit.mjs',
  MVP_VALIDATION: 'mvp-e2e-validation.mjs',
  SCALE_AUDIT: 'scale-architecture-audit.mjs',
  FOLLOWUPS: 'execute-followups.mjs',
  PRODUCTION_WARMUP: 'production-warmup.mjs'
};

function sendToRenderer(win: BrowserWindow | null, channel: string, data: any): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

export function runPipelineScript(
  scriptName: string,
  config: PipelineConfig,
  win: BrowserWindow | null,
  args: string[] = []
): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const scriptPath = path.join(WEB_SCRIPTS_PATH, scriptName);

    logger.info(`Running pipeline script: ${scriptName}`);
    sendToRenderer(win, 'pipeline:start', { script: scriptName });

    const env = {
      ...process.env,
      SMTP_USER: config.smtpUser,
      SMTP_PASS: config.smtpPass,
      DATABASE_URL: config.databaseUrl,
      TEST_EMAIL: config.testEmail
    };

    let output = '';
    let errorOutput = '';

    activeProcess = spawn('node', [scriptPath, ...args], {
      cwd: path.join(WEB_SCRIPTS_PATH, '..'),
      env,
      shell: true
    });

    activeProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      sendToRenderer(win, 'pipeline:output', { text, type: 'stdout' });
      logger.info(`[${scriptName}] ${text.trim()}`);
    });

    activeProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      sendToRenderer(win, 'pipeline:output', { text, type: 'stderr' });
      logger.error(`[${scriptName}] ${text.trim()}`);
    });

    activeProcess.on('close', (code) => {
      activeProcess = null;
      const success = code === 0;

      sendToRenderer(win, 'pipeline:complete', {
        script: scriptName,
        success,
        code,
        output,
        error: errorOutput
      });

      logger.info(`Pipeline script ${scriptName} exited with code ${code}`);

      resolve({
        success,
        output,
        error: errorOutput || undefined
      });
    });

    activeProcess.on('error', (err) => {
      activeProcess = null;
      logger.error(`Pipeline script ${scriptName} error: ${err.message}`);

      sendToRenderer(win, 'pipeline:error', {
        script: scriptName,
        error: err.message
      });

      resolve({
        success: false,
        output,
        error: err.message
      });
    });
  });
}

export function stopPipelineScript(): boolean {
  if (activeProcess) {
    activeProcess.kill('SIGTERM');
    activeProcess = null;
    logger.info('Pipeline script stopped');
    return true;
  }
  return false;
}

export function registerPipelineIpc(getMainWindow: () => BrowserWindow | null): void {
  // Run specific pipeline operation
  ipcMain.handle('pipeline:run', async (_event, { script, config, args }) => {
    const win = getMainWindow();
    return runPipelineScript(script, config, win, args);
  });

  // Stop running pipeline
  ipcMain.handle('pipeline:stop', async () => {
    return stopPipelineScript();
  });

  // Get available operations
  ipcMain.handle('pipeline:operations', async () => {
    return PipelineOperations;
  });

  // Quick actions
  ipcMain.handle('pipeline:daily-ops', async (_event, config) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.DAILY_OPS, config, win);
  });

  ipcMain.handle('pipeline:autonomous', async (_event, config) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.AUTONOMOUS, config, win);
  });

  ipcMain.handle('pipeline:conversion', async (_event, config) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.CONVERSION, config, win);
  });

  ipcMain.handle('pipeline:deals', async (_event, config) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.DEAL_FINALIZATION, config, win);
  });

  ipcMain.handle('pipeline:force', async (_event, config) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.PIPELINE_FORCE, config, win);
  });

  ipcMain.handle('pipeline:audit', async (_event, config) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.CONVERSATION_AUDIT, config, win);
  });

  ipcMain.handle('pipeline:validate', async (_event, config) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.MVP_VALIDATION, config, win);
  });

  ipcMain.handle('pipeline:followups', async (_event, { config, count }) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.FOLLOWUPS, config, win, [String(count || 10)]);
  });

  ipcMain.handle('pipeline:warmup', async (_event, { config, count }) => {
    const win = getMainWindow();
    return runPipelineScript(PipelineOperations.PRODUCTION_WARMUP, config, win, [String(count || 25)]);
  });

  logger.info('Pipeline IPC handlers registered');
}
