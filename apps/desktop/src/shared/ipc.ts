/**
 * Shared IPC contract between the Electron main process and the renderer.
 *
 * Keeping channel names and payload shapes in one file guarantees the preload
 * bridge, the main-process handlers, and any renderer code all agree. Any
 * mismatch becomes a compile-time error rather than a silent runtime bug.
 */

/** Channels the renderer can INVOKE (request/response via ipcRenderer.invoke). */
export const IpcInvoke = {
  GetAppInfo: "app:get-info",
  GetSettings: "settings:get",
  SetSettings: "settings:set",
  ResetSettings: "settings:reset",
  CheckForUpdates: "updater:check",
  QuitAndInstallUpdate: "updater:quit-and-install",
  ReloadApp: "app:reload",
  OpenExternal: "app:open-external",
} as const;

/** Channels the renderer can SEND one-way (fire-and-forget via ipcRenderer.send). */
export const IpcSend = {
  RendererReady: "renderer:ready",
  LogMessage: "app:log",
} as const;

/** Channels the main process PUSHES to the renderer (via webContents.send). */
export const IpcEvent = {
  ConnectivityChanged: "app:connectivity-changed",
  UpdateStatus: "updater:status",
  SettingsChanged: "settings:changed",
} as const;

export type IpcInvokeChannel = (typeof IpcInvoke)[keyof typeof IpcInvoke];
export type IpcSendChannel = (typeof IpcSend)[keyof typeof IpcSend];
export type IpcEventChannel = (typeof IpcEvent)[keyof typeof IpcEvent];

/** Persisted, user-configurable application settings. */
export interface AppSettings {
  /** Base URL of the DealFlow AI web app the shell loads. */
  appUrl: string;
  /** Minimize to the system tray instead of quitting when the window closes. */
  minimizeToTray: boolean;
  /** Launch the app automatically when the OS starts. */
  launchOnStartup: boolean;
  /** Automatically download and apply updates when available. */
  autoUpdate: boolean;
  /** Persisted zoom factor for the web content (1 = 100%). */
  zoomFactor: number;
  /** Preferred color scheme forwarded to the web app / native chrome. */
  theme: "system" | "light" | "dark";
}

/** Read-only app metadata surfaced to the renderer. */
export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
}

export type UpdateStatusKind =
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "disabled";

export interface UpdateStatus {
  kind: UpdateStatusKind;
  /** Version string when known (available/downloaded). */
  version?: string;
  /** Download progress percentage (0–100) while downloading. */
  percent?: number;
  /** Human-readable message for display/logging. */
  message?: string;
}

export interface ConnectivityStatus {
  online: boolean;
}

/** The typed API exposed to the renderer via contextBridge (window.dealflow). */
export interface DesktopBridge {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  resetSettings(): Promise<AppSettings>;
  checkForUpdates(): Promise<UpdateStatus>;
  quitAndInstallUpdate(): Promise<void>;
  reloadApp(): Promise<void>;
  openExternal(url: string): Promise<boolean>;
  rendererReady(): void;
  log(level: "info" | "warn" | "error", message: string): void;
  onConnectivityChanged(cb: (status: ConnectivityStatus) => void): () => void;
  onUpdateStatus(cb: (status: UpdateStatus) => void): () => void;
  onSettingsChanged(cb: (settings: AppSettings) => void): () => void;
}
