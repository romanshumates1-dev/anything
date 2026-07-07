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

  onNavigate: (cb) => subscribe<string>(IpcEvent.Navigate, cb),

  onConnectivityChanged: (cb) =>
    subscribe<ConnectivityStatus>(IpcEvent.ConnectivityChanged, cb),

  onUpdateStatus: (cb) => subscribe<UpdateStatus>(IpcEvent.UpdateStatus, cb),

  onSettingsChanged: (cb) =>
    subscribe<AppSettings>(IpcEvent.SettingsChanged, cb),

  onShowSettings: (cb) => subscribe<void>(IpcEvent.ShowSettings, () => cb()),
};

// Expose under a namespaced global to avoid clashing with the SaaS app code.
contextBridge.exposeInMainWorld("dealflow", bridge);

// Signal readiness once the preload has finished wiring up.
window.addEventListener("DOMContentLoaded", () => {
  ipcRenderer.send(IpcSend.RendererReady);
});
