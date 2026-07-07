/**
 * IPC handler registration.
 *
 * Every renderer-invokable channel is registered here with strict argument
 * validation. Handlers never trust renderer input: URLs are checked, unknown
 * settings keys are dropped by the store's sanitizer, and side effects
 * (zoom/theme/startup/tray) are applied centrally so state can't drift.
 */
import { app, ipcMain } from "electron";

import { IpcEvent, IpcInvoke, IpcSend } from "../shared/ipc";
import type { AppInfo, AppSettings } from "../shared/ipc";
import { logger } from "./logger";
import { openExternal } from "./security";
import {
  getSettings,
  resetSettings,
  setSettings as persistSettings,
} from "./store";
import {
  applyThemeToWindow,
  applyZoom,
  getMainWindow,
  reloadApp,
} from "./window";
import {
  checkForUpdates,
  onUpdateStatus,
  quitAndInstall,
} from "./updater";
import { refreshTrayMenu } from "./tray";
import { getSettingsWindow } from "./settings-window";

function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron ?? "unknown",
    chromeVersion: process.versions.chrome ?? "unknown",
    nodeVersion: process.versions.node ?? "unknown",
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
  };
}

/** Apply OS-level "launch at login" to match the persisted setting. */
function syncLaunchOnStartup(enabled: boolean): void {
  try {
    // Not supported on Linux via Electron's API; no-op there.
    if (process.platform === "darwin" || process.platform === "win32") {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false });
    }
  } catch (err) {
    logger.error(`Failed to set login item: ${String(err)}`);
  }
}

/** Broadcast the latest settings to every open window so UIs stay in sync. */
function broadcastSettings(settings: AppSettings): void {
  for (const win of [getMainWindow(), getSettingsWindow()]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcEvent.SettingsChanged, settings);
    }
  }
}

/** Apply the side effects implied by a settings change. */
function applySettingsEffects(
  next: AppSettings,
  prev: AppSettings,
): void {
  if (next.zoomFactor !== prev.zoomFactor) applyZoom(next.zoomFactor);
  if (next.theme !== prev.theme) applyThemeToWindow();
  if (next.launchOnStartup !== prev.launchOnStartup) {
    syncLaunchOnStartup(next.launchOnStartup);
  }
  refreshTrayMenu();
  broadcastSettings(next);
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcInvoke.GetAppInfo, () => appInfo());

  ipcMain.handle(IpcInvoke.GetSettings, () => getSettings());

  ipcMain.handle(IpcInvoke.SetSettings, (_e, patch: unknown) => {
    if (typeof patch !== "object" || patch === null) {
      return getSettings();
    }
    const prev = getSettings();
    const next = persistSettings(patch as Partial<AppSettings>);
    applySettingsEffects(next, prev);
    logger.info(`Settings updated: ${JSON.stringify(Object.keys(patch))}`);
    return next;
  });

  ipcMain.handle(IpcInvoke.ResetSettings, () => {
    const prev = getSettings();
    const next = resetSettings();
    applySettingsEffects(next, prev);
    logger.info("Settings reset to defaults.");
    return next;
  });

  ipcMain.handle(IpcInvoke.CheckForUpdates, () => checkForUpdates(true));

  ipcMain.handle(IpcInvoke.QuitAndInstallUpdate, () => {
    quitAndInstall();
  });

  ipcMain.handle(IpcInvoke.ReloadApp, () => reloadApp());

  ipcMain.handle(IpcInvoke.OpenExternal, (_e, url: unknown) => {
    if (typeof url !== "string") return false;
    return openExternal(url);
  });

  // One-way channels.
  ipcMain.on(IpcSend.RendererReady, (event) => {
    logger.info("Renderer reported ready.");
    // Push current update status to the freshly-loaded renderer.
    onUpdateStatus((status) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IpcEvent.UpdateStatus, status);
      }
    });
  });

  ipcMain.on(IpcSend.LogMessage, (_e, level: unknown, message: unknown) => {
    const msg = typeof message === "string" ? message : String(message);
    if (level === "error") logger.error(`[renderer] ${msg}`);
    else if (level === "warn") logger.warn(`[renderer] ${msg}`);
    else logger.info(`[renderer] ${msg}`);
  });

  // Bridge update-status pushes to the tray so its labels stay current.
  onUpdateStatus(() => refreshTrayMenu());

  // Ensure the OS login-item state matches persisted settings at startup.
  syncLaunchOnStartup(getSettings().launchOnStartup);
}
