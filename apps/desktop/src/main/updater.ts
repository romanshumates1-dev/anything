/**
 * Auto-update orchestration via electron-updater.
 *
 * In development (unpackaged) auto-update is disabled — there is no update feed
 * and electron-updater would throw. In production it checks the generic feed
 * declared in electron-builder.yml, downloads in the background, and prompts to
 * install on quit. All status transitions are pushed to the renderer + tray.
 */
import { autoUpdater } from "electron-updater";
import { dialog } from "electron";

import { IS_DEV } from "./config";
import { logger } from "./logger";
import { getSettings } from "./store";
import type { UpdateStatus } from "../shared/ipc";

type StatusListener = (status: UpdateStatus) => void;

const listeners = new Set<StatusListener>();
let wired = false;
let lastStatus: UpdateStatus = { kind: "not-available" };

export function onUpdateStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  // Replay the last known status so late subscribers are in sync.
  listener(lastStatus);
  return () => listeners.delete(listener);
}

function emit(status: UpdateStatus): void {
  lastStatus = status;
  for (const l of listeners) {
    try {
      l(status);
    } catch (err) {
      logger.error(`Update status listener threw: ${String(err)}`);
    }
  }
}

function wire(): void {
  if (wired) return;
  wired = true;

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => emit({ kind: "checking" }));
  autoUpdater.on("update-available", (info) =>
    emit({ kind: "available", version: info.version, message: "Update available" }),
  );
  autoUpdater.on("update-not-available", () =>
    emit({ kind: "not-available", message: "You're up to date" }),
  );
  autoUpdater.on("download-progress", (p) =>
    emit({ kind: "downloading", percent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => {
    emit({ kind: "downloaded", version: info.version, message: "Update ready" });
    void promptInstall(info.version);
  });
  autoUpdater.on("error", (err) => {
    logger.error(`Auto-update error: ${String(err)}`);
    emit({ kind: "error", message: String(err?.message ?? err) });
  });
}

async function promptInstall(version: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "info",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update ready",
    message: `DealFlow AI ${version} has been downloaded.`,
    detail: "Restart the app to apply the update.",
  });
  if (response === 0) quitAndInstall();
}

/** Kick off a check if auto-update is enabled + we're packaged. */
export async function checkForUpdates(userInitiated = false): Promise<UpdateStatus> {
  if (IS_DEV) {
    logger.info("Auto-update skipped (development build).");
    const status: UpdateStatus = {
      kind: "disabled",
      message: "Updates are disabled in development.",
    };
    emit(status);
    return status;
  }

  if (!getSettings().autoUpdate && !userInitiated) {
    const status: UpdateStatus = {
      kind: "disabled",
      message: "Automatic updates are turned off.",
    };
    emit(status);
    return status;
  }

  wire();
  try {
    await autoUpdater.checkForUpdates();
    return lastStatus;
  } catch (err) {
    logger.error(`checkForUpdates failed: ${String(err)}`);
    const status: UpdateStatus = { kind: "error", message: String(err) };
    emit(status);
    return status;
  }
}

export function quitAndInstall(): void {
  if (IS_DEV) return;
  try {
    autoUpdater.quitAndInstall();
  } catch (err) {
    logger.error(`quitAndInstall failed: ${String(err)}`);
  }
}

/** Schedule periodic background checks (every 6 hours) in production. */
export function startPeriodicUpdateChecks(): void {
  if (IS_DEV) return;
  void checkForUpdates(false);
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(() => void checkForUpdates(false), SIX_HOURS).unref();
}

export function getLastUpdateStatus(): UpdateStatus {
  return lastStatus;
}
