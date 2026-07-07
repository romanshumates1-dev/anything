/**
 * App lifecycle + deep-link orchestration.
 *
 * Centralizes "should we really quit?" logic and the parsing of dealflow://
 * deep links into in-app navigation. Kept separate from window.ts to avoid a
 * circular dependency between the tray, menu, and window modules.
 */
import { app } from "electron";

import { PROTOCOL } from "./config";
import { logger } from "./logger";
import { markQuitting, navigateTo } from "./window";

/** Perform a genuine application quit (used by tray/menu "Quit"). */
export function requestQuit(): void {
  markQuitting();
  app.quit();
}

/**
 * Convert a deep-link URL (dealflow://campaigns/123) into an app path
 * (/campaigns/123) and navigate to it. Ignores anything malformed.
 */
export function handleDeepLink(rawUrl: string): void {
  if (!rawUrl || !rawUrl.startsWith(`${PROTOCOL}://`)) return;

  try {
    const url = new URL(rawUrl);
    // host + pathname together form the in-app route.
    const host = url.hostname ? `/${url.hostname}` : "";
    const rest = url.pathname || "";
    const search = url.search || "";
    const routePath = `${host}${rest}`.replace(/\/{2,}/g, "/") || "/";
    logger.info(`Deep link → ${routePath}${search}`);
    navigateTo(`${routePath}${search}`);
  } catch (err) {
    logger.warn(`Ignored malformed deep link "${rawUrl}": ${String(err)}`);
  }
}

/**
 * Extract the first dealflow:// URL from a process argv array (Windows/Linux
 * pass deep links as launch arguments rather than an 'open-url' event).
 */
export function findDeepLinkInArgv(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
}
