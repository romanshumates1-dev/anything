/**
 * Desktop notification bridge.
 *
 * Provides the main-process handler for OS-level notifications triggered
 * by the SaaS web app (via the preload bridge). The renderer calls
 * `window.dealflow.showNotification(title, body)` when approvals arrive,
 * updates are available, or other important events occur.
 */
import { Notification } from "electron";
import { logger } from "./logger";

export interface NotificationPayload {
  title: string;
  body: string;
  /** Optional URL to navigate to when the notification is clicked. */
  onClickUrl?: string;
}

/**
 * Show a system notification. Called via IPC from the renderer.
 */
export function showNotification(payload: NotificationPayload): void {
  if (!payload?.title) {
    logger.warn("showNotification called without a title — ignoring.");
    return;
  }

  const notif = new Notification({
    title: payload.title,
    body: payload.body ?? "",
    silent: false,
  });

  if (payload.onClickUrl) {
    notif.on("click", () => {
      // Focus the main window when the notification is clicked.
      const { getMainWindow } = require("./window");
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
  }

  notif.show();
  logger.info(`Notification shown: "${payload.title}" — "${payload.body}"`);
}