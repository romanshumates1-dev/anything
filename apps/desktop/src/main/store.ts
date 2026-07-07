/**
 * Persistent settings + window-state storage backed by electron-store.
 *
 * All reads go through validation so a corrupted or hand-edited config file can
 * never crash the app or inject an unexpected type. Writes are normalized and
 * clamped to safe ranges.
 */
import Store from "electron-store";

import type { AppSettings } from "../shared/ipc";
import { DEFAULT_SETTINGS } from "./config";

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

interface Schema {
  settings: AppSettings;
  windowState: WindowState;
}

const store = new Store<Schema>({
  name: "dealflow-config",
  defaults: {
    settings: DEFAULT_SETTINGS,
    windowState: {
      width: 0,
      height: 0,
      isMaximized: false,
    },
  },
  // Bump when the schema shape changes to trigger a migration on upgrade.
  schemaVersion: 1,
});

const THEMES: ReadonlyArray<AppSettings["theme"]> = ["system", "light", "dark"];

function clampZoom(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  // Match Chromium's practical zoom bounds.
  return Math.min(3, Math.max(0.5, n));
}

function normalizeUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

/** Coerce whatever is on disk into a valid, fully-populated settings object. */
function sanitizeSettings(raw: Partial<AppSettings> | undefined): AppSettings {
  const r = raw ?? {};
  return {
    appUrl: normalizeUrl(r.appUrl, DEFAULT_SETTINGS.appUrl),
    minimizeToTray:
      typeof r.minimizeToTray === "boolean"
        ? r.minimizeToTray
        : DEFAULT_SETTINGS.minimizeToTray,
    launchOnStartup:
      typeof r.launchOnStartup === "boolean"
        ? r.launchOnStartup
        : DEFAULT_SETTINGS.launchOnStartup,
    autoUpdate:
      typeof r.autoUpdate === "boolean" ? r.autoUpdate : DEFAULT_SETTINGS.autoUpdate,
    zoomFactor: clampZoom(r.zoomFactor),
    theme: THEMES.includes(r.theme as AppSettings["theme"])
      ? (r.theme as AppSettings["theme"])
      : DEFAULT_SETTINGS.theme,
  };
}

export function getSettings(): AppSettings {
  return sanitizeSettings(store.get("settings"));
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = sanitizeSettings({ ...getSettings(), ...patch });
  store.set("settings", next);
  return next;
}

export function resetSettings(): AppSettings {
  store.set("settings", DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export function getWindowState(): WindowState {
  const state = store.get("windowState");
  return {
    x: typeof state?.x === "number" ? state.x : undefined,
    y: typeof state?.y === "number" ? state.y : undefined,
    width: typeof state?.width === "number" && state.width > 0 ? state.width : 0,
    height: typeof state?.height === "number" && state.height > 0 ? state.height : 0,
    isMaximized: Boolean(state?.isMaximized),
  };
}

export function setWindowState(state: WindowState): void {
  store.set("windowState", state);
}

export type { WindowState };
