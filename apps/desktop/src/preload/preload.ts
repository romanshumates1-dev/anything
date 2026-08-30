/**
 * Preload script — the ONLY bridge between the sandboxed renderer and the main
 * process. Runs with contextIsolation ON + sandbox ON, so it exposes a small,
 * explicit, typed surface via contextBridge and nothing else. The renderer has
 * no direct access to Node, ipcRenderer, or the DOM of the main process.
 */
import { contextBridge, ipcRenderer } from "electron";

import { IpcEvent, IpcInvoke, IpcSend } from "../shared/ipc";
import type {
  AppInfo,
  AppSettings,
  ConnectivityStatus,
  DesktopBridge,
  UpdateStatus,
} from "../shared/ipc";

/** Wrap an event subscription so callers get an unsubscribe function. */
function subscribe<T>(
  channel: string,
  cb: (payload: T) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Pipeline operations interface
interface PipelineConfig {
  smtpUser: string;
  smtpPass: string;
  databaseUrl: string;
  testEmail: string;
}

interface PipelineResult {
  success: boolean;
  output: string;
  error?: string;
}

interface PipelineBridge {
  run: (script: string, config: PipelineConfig, args?: string[]) => Promise<PipelineResult>;
  stop: () => Promise<boolean>;
  getOperations: () => Promise<Record<string, string>>;
  dailyOps: (config: PipelineConfig) => Promise<PipelineResult>;
  autonomous: (config: PipelineConfig) => Promise<PipelineResult>;
  conversion: (config: PipelineConfig) => Promise<PipelineResult>;
  deals: (config: PipelineConfig) => Promise<PipelineResult>;
  force: (config: PipelineConfig) => Promise<PipelineResult>;
  audit: (config: PipelineConfig) => Promise<PipelineResult>;
  validate: (config: PipelineConfig) => Promise<PipelineResult>;
  followups: (config: PipelineConfig, count?: number) => Promise<PipelineResult>;
  warmup: (config: PipelineConfig, count?: number) => Promise<PipelineResult>;
  onOutput: (cb: (data: { text: string; type: string }) => void) => () => void;
  onComplete: (cb: (data: { script: string; success: boolean; output: string }) => void) => () => void;
  onError: (cb: (data: { script: string; error: string }) => void) => () => void;
}

const pipeline: PipelineBridge = {
  run: (script, config, args) =>
    ipcRenderer.invoke('pipeline:run', { script, config, args }) as Promise<PipelineResult>,
  stop: () => ipcRenderer.invoke('pipeline:stop') as Promise<boolean>,
  getOperations: () => ipcRenderer.invoke('pipeline:operations') as Promise<Record<string, string>>,
  dailyOps: (config) => ipcRenderer.invoke('pipeline:daily-ops', config) as Promise<PipelineResult>,
  autonomous: (config) => ipcRenderer.invoke('pipeline:autonomous', config) as Promise<PipelineResult>,
  conversion: (config) => ipcRenderer.invoke('pipeline:conversion', config) as Promise<PipelineResult>,
  deals: (config) => ipcRenderer.invoke('pipeline:deals', config) as Promise<PipelineResult>,
  force: (config) => ipcRenderer.invoke('pipeline:force', config) as Promise<PipelineResult>,
  audit: (config) => ipcRenderer.invoke('pipeline:audit', config) as Promise<PipelineResult>,
  validate: (config) => ipcRenderer.invoke('pipeline:validate', config) as Promise<PipelineResult>,
  followups: (config, count) => ipcRenderer.invoke('pipeline:followups', { config, count }) as Promise<PipelineResult>,
  warmup: (config, count) => ipcRenderer.invoke('pipeline:warmup', { config, count }) as Promise<PipelineResult>,
  onOutput: (cb) => subscribe('pipeline:output', cb),
  onComplete: (cb) => subscribe('pipeline:complete', cb),
  onError: (cb) => subscribe('pipeline:error', cb),
};

const bridge: DesktopBridge = {
  getAppInfo: () => ipcRenderer.invoke(IpcInvoke.GetAppInfo) as Promise<AppInfo>,

  getSettings: () =>
    ipcRenderer.invoke(IpcInvoke.GetSettings) as Promise<AppSettings>,

  setSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IpcInvoke.SetSettings, patch) as Promise<AppSettings>,

  resetSettings: () =>
    ipcRenderer.invoke(IpcInvoke.ResetSettings) as Promise<AppSettings>,

  checkForUpdates: () =>
    ipcRenderer.invoke(IpcInvoke.CheckForUpdates) as Promise<UpdateStatus>,

  quitAndInstallUpdate: () =>
    ipcRenderer.invoke(IpcInvoke.QuitAndInstallUpdate) as Promise<void>,

  reloadApp: () => ipcRenderer.invoke(IpcInvoke.ReloadApp) as Promise<void>,

  openExternal: (url: string) =>
    ipcRenderer.invoke(IpcInvoke.OpenExternal, url) as Promise<boolean>,

  rendererReady: () => ipcRenderer.send(IpcSend.RendererReady),

  log: (level, message) => ipcRenderer.send(IpcSend.LogMessage, level, message),

  showNotification: (title, body, onClickUrl) =>
    ipcRenderer.invoke(IpcInvoke.ShowNotification, title, body, onClickUrl),

  onConnectivityChanged: (cb) =>
    subscribe<ConnectivityStatus>(IpcEvent.ConnectivityChanged, cb),

  onUpdateStatus: (cb) => subscribe<UpdateStatus>(IpcEvent.UpdateStatus, cb),

  onSettingsChanged: (cb) =>
    subscribe<AppSettings>(IpcEvent.SettingsChanged, cb),
};

// Expose under a namespaced global to avoid clashing with the SaaS app code.
contextBridge.exposeInMainWorld("dealflow", bridge);
contextBridge.exposeInMainWorld("pipeline", pipeline);

// Signal readiness once the preload has finished wiring up.
window.addEventListener("DOMContentLoaded", () => {
  ipcRenderer.send(IpcSend.RendererReady);
});
