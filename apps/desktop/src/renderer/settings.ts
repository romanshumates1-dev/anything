/**
 * Settings page logic. Renders the current settings, persists edits through the
 * typed bridge, and reflects live update-status. All persistence + validation
 * happens in the main process; this file only reads/writes via window.dealflow.
 */
import type { AppInfo, AppSettings, UpdateStatus } from "../shared/ipc";

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function asInput(id: string): HTMLInputElement | null {
  const el = $(id);
  return el instanceof HTMLInputElement ? el : null;
}

function asSelect(id: string): HTMLSelectElement | null {
  const el = $(id);
  return el instanceof HTMLSelectElement ? el : null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced persist so rapid edits (e.g. typing a URL) don't thrash disk. */
function scheduleSave(patch: Partial<AppSettings>, immediate = false): void {
  const commit = () => {
    void window.dealflow.setSettings(patch);
  };
  if (immediate) {
    commit();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, 400);
}

function renderSettings(s: AppSettings): void {
  const appUrl = asInput("appUrl");
  if (appUrl && document.activeElement !== appUrl) appUrl.value = s.appUrl;

  const minimizeToTray = asInput("minimizeToTray");
  if (minimizeToTray) minimizeToTray.checked = s.minimizeToTray;

  const launchOnStartup = asInput("launchOnStartup");
  if (launchOnStartup) launchOnStartup.checked = s.launchOnStartup;

  const autoUpdate = asInput("autoUpdate");
  if (autoUpdate) autoUpdate.checked = s.autoUpdate;

  const theme = asSelect("theme");
  if (theme) theme.value = s.theme;

  const zoom = asSelect("zoom");
  if (zoom) zoom.value = String(s.zoomFactor);
}

function renderAppInfo(info: AppInfo): void {
  const el = $("appInfo");
  if (!el) return;
  el.textContent = `Version ${info.version} · Electron ${info.electronVersion} · ${info.platform}/${info.arch}`;
}

function renderUpdateStatus(status: UpdateStatus): void {
  const el = $("updateStatus");
  if (!el) return;
  const map: Record<UpdateStatus["kind"], string> = {
    checking: "Checking for updates…",
    available: `Update available${status.version ? ` (${status.version})` : ""}`,
    "not-available": "You're up to date.",
    downloading: `Downloading… ${status.percent ?? 0}%`,
    downloaded: `Update ready${status.version ? ` (${status.version})` : ""} — restart to apply.`,
    error: `Update error: ${status.message ?? "unknown"}`,
    disabled: status.message ?? "Updates are disabled.",
  };
  el.textContent = map[status.kind];

  const installBtn = $("installUpdate");
  if (installBtn) {
    installBtn.style.display = status.kind === "downloaded" ? "inline-flex" : "none";
  }
}

async function init(): Promise<void> {
  const [settings, info] = await Promise.all([
    window.dealflow.getSettings(),
    window.dealflow.getAppInfo(),
  ]);
  renderSettings(settings);
  renderAppInfo(info);

  // --- Wire inputs ---
  asInput("appUrl")?.addEventListener("input", (e) => {
    const value = (e.target as HTMLInputElement).value.trim();
    scheduleSave({ appUrl: value });
  });
  asInput("appUrl")?.addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).value.trim();
    scheduleSave({ appUrl: value }, true);
  });

  asInput("minimizeToTray")?.addEventListener("change", (e) => {
    scheduleSave({ minimizeToTray: (e.target as HTMLInputElement).checked }, true);
  });

  asInput("launchOnStartup")?.addEventListener("change", (e) => {
    scheduleSave({ launchOnStartup: (e.target as HTMLInputElement).checked }, true);
  });

  asInput("autoUpdate")?.addEventListener("change", (e) => {
    scheduleSave({ autoUpdate: (e.target as HTMLInputElement).checked }, true);
  });

  asSelect("theme")?.addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value as AppSettings["theme"];
    scheduleSave({ theme: value }, true);
  });

  asSelect("zoom")?.addEventListener("change", (e) => {
    const value = Number((e.target as HTMLSelectElement).value);
    scheduleSave({ zoomFactor: value }, true);
  });

  $("checkUpdates")?.addEventListener("click", () => {
    void window.dealflow.checkForUpdates();
  });

  $("installUpdate")?.addEventListener("click", () => {
    void window.dealflow.quitAndInstallUpdate();
  });

  $("reload")?.addEventListener("click", () => {
    void window.dealflow.reloadApp();
  });

  $("reset")?.addEventListener("click", async () => {
    const next = await window.dealflow.resetSettings();
    renderSettings(next);
  });

  // --- Live subscriptions ---
  window.dealflow.onSettingsChanged(renderSettings);
  window.dealflow.onUpdateStatus(renderUpdateStatus);

  window.dealflow.rendererReady();
}

void init();
