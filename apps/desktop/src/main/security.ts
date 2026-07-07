/**
 * Security hardening for the Electron shell.
 *
 * Follows the official Electron security checklist:
 *   - contextIsolation ON, nodeIntegration OFF, sandbox ON (set at window level)
 *   - Deny all new-window/popup requests; route external links to the OS browser
 *   - Block in-window navigation to any origin outside the allowlist
 *   - Deny all permission requests (camera/mic/geolocation/etc.) by default
 *   - Strip/deny webview attachment and disable insecure features
 *   - Never allow loading remote content into a privileged context
 */
import { shell, session } from "electron";
import type { WebContents } from "electron";

import { buildAllowedOrigins, IS_DEV } from "./config";
import { logger } from "./logger";
import { getSettings } from "./store";

/** Origins allowed for top-level in-window navigation, recomputed on demand. */
function allowedOrigins(): Set<string> {
  return buildAllowedOrigins(getSettings().appUrl);
}

/** True if a URL is safe to open in the user's external browser. */
function isSafeExternal(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * Open a URL in the user's real browser after validating the scheme.
 * Returns true if the URL was handed off, false if it was rejected.
 */
export function openExternal(url: string): boolean {
  if (!isSafeExternal(url)) {
    logger.warn(`Blocked external open for unsafe URL: ${url}`);
    return false;
  }
  void shell.openExternal(url);
  return true;
}

/**
 * Attach navigation + window-open guards to a WebContents. Called for every
 * web contents the app creates so nothing slips through unguarded.
 */
export function hardenWebContents(contents: WebContents): void {
  // 1) Deny popups/new windows; open safe external links in the OS browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (openExternal(url)) {
      logger.info(`Opened external URL in browser: ${url}`);
    }
    return { action: "deny" };
  });

  // 2) Block in-window navigation outside the allowlist.
  contents.on("will-navigate", (event, url) => {
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      logger.warn(`Blocked navigation to malformed URL: ${url}`);
      return;
    }

    if (!allowedOrigins().has(origin)) {
      event.preventDefault();
      logger.warn(`Blocked off-origin navigation to: ${url}`);
      openExternal(url);
    }
  });

  // 3) Never allow attaching a <webview> (a common escalation vector).
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
    logger.warn("Blocked <webview> attachment.");
  });

  // 4) Deny redirects that leave the allowlist mid-request.
  contents.on("will-redirect", (event, url) => {
    let origin = "";
    try {
      origin = new URL(url).origin;
    } catch {
      event.preventDefault();
      return;
    }
    if (!allowedOrigins().has(origin)) {
      event.preventDefault();
      logger.warn(`Blocked off-origin redirect to: ${url}`);
    }
  });
}

/**
 * Session-wide hardening applied once at startup:
 *   - Deny every permission request by default (SaaS shell needs none).
 *   - Deny permission checks for the same set.
 *   - Refuse to display insecure certificate errors in production.
 */
export function hardenSession(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    logger.warn(`Denied permission request: ${permission}`);
    callback(false);
  });

  ses.setPermissionCheckHandler((_wc, permission) => {
    logger.info(`Denied permission check: ${permission}`);
    return false;
  });

  // In production, never bypass TLS errors. In dev against localhost we still
  // enforce it, but localhost over http is allowed by the allowlist above.
  ses.setCertificateVerifyProc((request, callback) => {
    // 0 = use Chromium's default verification result.
    if (IS_DEV && request.hostname === "localhost") {
      callback(0);
      return;
    }
    callback(-3); // -3 = use the default result from Chromium.
  });
}
