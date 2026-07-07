/**
 * Application logging. Wraps electron-log so logs go to a rotating file in the
 * OS-standard location AND to the console during development.
 *
 * File locations (electron-log defaults):
 *   Windows: %USERPROFILE%\AppData\Roaming\<app>\logs\main.log
 *   macOS:   ~/Library/Logs/<app>/main.log
 *   Linux:   ~/.config/<app>/logs/main.log
 */
import log from "electron-log/main";

import { IS_DEV } from "./config";

let initialized = false;

export function initLogger(): void {
  if (initialized) return;
  initialized = true;

  // Route renderer console + errors through the same pipeline.
  log.initialize();

  log.transports.file.level = "info";
  log.transports.console.level = IS_DEV ? "debug" : "warn";
  // 5 MB rotation keeps disk usage bounded on long-running installs.
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

  // Capture otherwise-fatal errors so a crash always leaves a breadcrumb.
  log.errorHandler.startCatching({ showDialog: false });

  log.info("──────── DealFlow AI desktop starting ────────");
}

export const logger = log;
export default log;
