/**
 * Main process entry point.
 *
 * Boot sequence:
 *   1. Enforce a single instance (focus the existing window on re-launch,
 *      forwarding any deep link passed on the second instance's argv).
 *   2. Register the dealflow:// protocol as the default handler.
 *   3. Harden the default session + global process crash guards.
 *   4. On 'ready': register IPC, build the menu, create the window + tray,
 *      begin update checks, and monitor connectivity.
 *   5. Handle macOS 'activate' + 'open-url', and honour minimize-to-tray on
 *      window-all-closed.
 */
import { app, BrowserWindow, net, powerMonitor } from "electron";

import { IS_MAC, PROTOCOL } from "./config";
import { initLogger, logger } from "./logger";
import { hardenSession } from "./security";
import { registerIpcHandlers } from "./ipc";
import { installApplicationMenu } from "./menu";
import { createTray, refreshTrayMenu } from "./tray";
import { startPeriodicUpdateChecks } from "./updater";
import {
  createMainWindow,
  getMainWindow,
  markQuitting,
  showMainWindow,
} from "./window";
import {
  findDeepLinkInArgv,
  handleDeepLink,
} from "./lifecycle";
import { getSettings } from "./store";
import { IpcEvent } from "../shared/ipc";
import type { ConnectivityStatus } from "../shared/ipc";

initLogger();

// ---------------------------------------------------------------------------
// Single-instance lock — critical for deep links + tray UX.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.info("Another instance is already running. Quitting this one.");
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    logger.info("second-instance event received.");
    showMainWindow();
    const deepLink = findDeepLinkInArgv(argv);
    if (deepLink) handleDeepLink(deepLink);
  });

  bootstrap();
}

// ---------------------------------------------------------------------------
// Protocol registration (deep links: dealflow://...).
// ---------------------------------------------------------------------------
function registerProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    // When running from source in dev, pass the script path so relaunch works.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      require("node:path").resolve(process.argv[1]!),
    ]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

// ---------------------------------------------------------------------------
// Connectivity monitoring — informs the renderer/offline UX.
// ---------------------------------------------------------------------------
let lastOnline: boolean | null = null;

function pushConnectivity(): void {
  const online = net.isOnline();
  if (online === lastOnline) return;
  lastOnline = online;
  const status: ConnectivityStatus = { online };
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcEvent.ConnectivityChanged, status);
  }
  logger.info(`Connectivity changed: ${online ? "online" : "offline"}`);
}

function startConnectivityMonitor(): void {
  pushConnectivity();
  setInterval(pushConnectivity, 15_000).unref();
  powerMonitor.on("resume", () => pushConnectivity());
}

// ---------------------------------------------------------------------------
// Global crash guards — never let an unhandled error take down the process
// silently; log it so the file transport captures a breadcrumb.
// ---------------------------------------------------------------------------
function installProcessGuards(): void {
  process.on("uncaughtException", (err) => {
    logger.error(`uncaughtException: ${err?.stack ?? String(err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(`unhandledRejection: ${String(reason)}`);
  });
}

// ---------------------------------------------------------------------------
// Boot.
// ---------------------------------------------------------------------------
function bootstrap(): void {
  installProcessGuards();
  registerProtocol();

  // Disable insecure Chromium features not needed by a SaaS shell.
  app.enableSandbox();

  app.on("web-contents-created", (_event, contents) => {
    // Late-created web contents (e.g. from any source) are hardened too.
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });

  app.whenReady().then(onReady).catch((err) => {
    logger.error(`Failed during app ready: ${String(err)}`);
  });

  app.on("activate", () => {
    // macOS: re-create/show the window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindow();
    }
  });

  app.on("window-all-closed", () => {
    // macOS convention: apps stay resident with no windows until Cmd+Q.
    if (IS_MAC) return;

    // On Windows/Linux: when minimize-to-tray is ON, a normal close hides the
    // window to the tray (the close handler prevents destruction), so this
    // event won't fire on that path. When minimize-to-tray is OFF, closing the
    // last window means the user wants to exit — quit rather than leaving a
    // headless, resident process behind.
    if (!getSettings().minimizeToTray) {
      logger.info("Last window closed with tray disabled — quitting.");
      markQuitting();
      app.quit();
    }
  });

  app.on("before-quit", () => markQuitting());

  // macOS deep-link entry point.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

function onReady(): void {
  logger.info("App ready — initializing.");
  hardenSession();
  registerIpcHandlers();
  installApplicationMenu();
  createMainWindow();
  createTray();
  refreshTrayMenu();
  startPeriodicUpdateChecks();
  startConnectivityMonitor();

  // Handle a deep link used to launch the app (Windows/Linux argv path).
  const launchDeepLink = findDeepLinkInArgv(process.argv);
  if (launchDeepLink) handleDeepLink(launchDeepLink);
}
