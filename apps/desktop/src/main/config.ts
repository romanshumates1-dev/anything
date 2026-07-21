/**
 * Central configuration + environment resolution for the main process.
 *
 * Values are resolved once at startup. Environment variables allow the same
 * binary to point at local dev, staging, or production without a rebuild.
 */
import { config } from "dotenv";
import { app } from "electron";
import path from "node:path";

// Load .env file for local development (silently ignores if missing)
// This happens at module evaluation time, before any config values are read.
try {
  config({ path: path.join(__dirname, "..", "..", ".env") });
} catch {
  // .env is optional - fall back to environment or defaults
}

import type { AppSettings } from "../shared/ipc";

/** True when running the packaged (production) binary. */
export const IS_PACKAGED = app.isPackaged;
export const IS_DEV = !IS_PACKAGED;
export const IS_MAC = process.platform === "darwin";
export const IS_WINDOWS = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";

/** Custom protocol used for deep links: dealflow://path */
export const PROTOCOL = "dealflow";

/**
 * Default URL of the DealFlow AI web app.
 *
 * - In dev we point at the local Next.js dev server (`yarn dev` → port 4000).
 * - In production we default to the hosted SaaS, overridable via env at launch.
 */
export const DEFAULT_APP_URL = (
  process.env.DEALFLOW_APP_URL ??
  (IS_DEV ? "http://localhost:4000" : "https://dealswiftautomation.com")
).replace(/\/+$/, "");

/**
 * Hosts the shell is allowed to render as top-level in-window navigation.
 * Anything else opens in the user's real browser. Derived from the configured
 * app URL plus any explicit allowlist from the environment.
 */
export function buildAllowedOrigins(appUrl: string): Set<string> {
  const origins = new Set<string>();
  const push = (value: string) => {
    try {
      origins.add(new URL(value).origin);
    } catch {
      /* ignore malformed URLs */
    }
  };

  push(appUrl);
  push(DEFAULT_APP_URL);

  // Local dev conveniences.
  if (IS_DEV) {
    push("http://localhost:4000");
    push("http://127.0.0.1:4000");
  }

  // Comma-separated extra origins, e.g. auth providers or a CDN.
  const extra = process.env.DEALFLOW_ALLOWED_ORIGINS;
  if (extra) {
    for (const item of extra.split(",")) {
      const trimmed = item.trim();
      if (trimmed) push(trimmed);
    }
  }

  return origins;
}

/** Factory-default settings applied on first launch / reset. */
export const DEFAULT_SETTINGS: AppSettings = {
  appUrl: DEFAULT_APP_URL,
  minimizeToTray: !IS_MAC, // macOS keeps apps alive by convention instead.
  launchOnStartup: false,
  autoUpdate: true,
  zoomFactor: 1,
  theme: "system",
};

/** Absolute paths to bundled renderer/static assets (resolved at build time). */
export const paths = {
  preload: path.join(__dirname, "..", "preload", "preload.js"),
  rendererDir: path.join(__dirname, "..", "renderer"),
  offlineHtml: path.join(__dirname, "..", "renderer", "offline.html"),
  settingsHtml: path.join(__dirname, "..", "renderer", "settings.html"),
  assetsDir: path.join(__dirname, "..", "..", "assets"),
} as const;

/** Resolve a platform-appropriate window/tray icon path. */
export function iconPath(): string {
  if (IS_WINDOWS) return path.join(paths.assetsDir, "icon.ico");
  if (IS_MAC) return path.join(paths.assetsDir, "icon.png");
  return path.join(paths.assetsDir, "icon.png");
}

/** Minimum + default window geometry. */
export const WINDOW = {
  defaultWidth: 1440,
  defaultHeight: 900,
  minWidth: 940,
  minHeight: 600,
} as const;
