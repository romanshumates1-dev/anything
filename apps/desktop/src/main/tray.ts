/**
 * System tray integration.
 *
 * Gives users quick access to open the app, jump to key sections, check for
 * updates, and quit — even when the window is hidden (minimize-to-tray). The
 * tray icon reflects the current update status via its tooltip.
 */
import { Menu, Tray, app, nativeImage } from "electron";
import path from "node:path";

import { IS_MAC, paths } from "./config";
import { logger } from "./logger";
import { checkForUpdates, getLastUpdateStatus } from "./updater";
import { navigateTo, showMainWindow } from "./window";
import { openSettingsWindow } from "./settings-window";
import { requestQuit } from "./lifecycle";

let tray: Tray | null = null;

function trayImage(): Electron.NativeImage {
  // Prefer a dedicated tray icon; fall back to the app PNG.
  const trayPng = path.join(paths.assetsDir, "trayTemplate.png");
  let image = nativeImage.createFromPath(trayPng);
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(path.join(paths.assetsDir, "icon.png"));
  }
  // macOS renders monochrome "template" images that adapt to light/dark menubar.
  if (IS_MAC) image.setTemplateImage(true);
  return image;
}

function buildContextMenu(): Menu {
  const status = getLastUpdateStatus();
  const updateLabel =
    status.kind === "downloaded"
      ? "Restart to Update"
      : status.kind === "downloading"
        ? `Downloading update… ${status.percent ?? 0}%`
        : "Check for Updates…";

  return Menu.buildFromTemplate([
    { label: "Open DealFlow AI", click: () => showMainWindow() },
    { type: "separator" },
    { label: "Dashboard", click: () => navigateTo("/") },
    { label: "Campaigns", click: () => navigateTo("/campaigns") },
    { label: "Inbox", click: () => navigateTo("/inbox") },
    { label: "Approvals", click: () => navigateTo("/approvals") },
    { type: "separator" },
    { label: "Settings…", click: () => openSettingsWindow() },
    { label: updateLabel, click: () => void checkForUpdates(true) },
    { type: "separator" },
    { label: "Quit DealFlow AI", click: () => requestQuit() },
  ]);
}

export function refreshTrayMenu(): void {
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildContextMenu());
  }
}

export function createTray(): void {
  if (tray && !tray.isDestroyed()) return;

  try {
    tray = new Tray(trayImage());
  } catch (err) {
    logger.error(`Failed to create tray: ${String(err)}`);
    return;
  }

  tray.setToolTip("DealFlow AI");
  tray.setContextMenu(buildContextMenu());

  // Single click opens the app on Windows/Linux; macOS shows the menu.
  tray.on("click", () => {
    if (!IS_MAC) showMainWindow();
  });
  tray.on("double-click", () => showMainWindow());

  logger.info("System tray created.");
}

export function setBadgeCount(count: number): void {
  if (tray && !tray.isDestroyed()) {
    // macOS dock badge, Windows taskbar overlay.
    try {
      app.setBadgeCount(count);
    } catch {
      // Not supported on all platforms — tooltip fallback is sufficient.
    }
    // Update tooltip with the pending count.
    tray.setToolTip(
      count > 0
        ? `DealFlow AI — ${count} approval${count === 1 ? "" : "s"} pending`
        : "DealFlow AI",
    );
  }
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

// Keep the tray menu label in sync when the app is quitting/relaunching.
app.on("before-quit", () => destroyTray());
