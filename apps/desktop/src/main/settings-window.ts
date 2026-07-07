/**
 * Standalone Settings/Preferences window.
 *
 * Loads a bundled, local-only HTML page (no remote content) through the same
 * hardened preload bridge. Kept as a modest child window; re-focuses if already
 * open rather than spawning duplicates.
 */
import { BrowserWindow, nativeTheme } from "electron";

import { IS_MAC, iconPath, paths } from "./config";
import { hardenWebContents } from "./security";
import { getMainWindow } from "./window";

let settingsWindow: BrowserWindow | null = null;

export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const parent = getMainWindow() ?? undefined;

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 480,
    minHeight: 520,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    parent: IS_MAC ? undefined : parent,
    modal: false,
    show: false,
    title: "Settings — DealFlow AI",
    icon: iconPath(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0f17" : "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });

  hardenWebContents(settingsWindow.webContents);

  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  void settingsWindow.loadFile(paths.settingsHtml);
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}
