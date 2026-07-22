/**
 * Main application window lifecycle.
 *
 * Responsibilities:
 *   - Create the BrowserWindow with a hardened webPreferences set.
 *   - Restore + persist window geometry (position, size, maximized).
 *   - Load the configured SaaS URL, falling back to a bundled offline page
 *     when the network is unreachable.
 *   - Apply persisted zoom + theme.
 *   - Show gracefully (no white flash) and honor minimize-to-tray.
 */
import { BrowserWindow, nativeTheme, screen, shell } from "electron";

import { IS_DEV, IS_MAC, WINDOW, iconPath, paths } from "./config";
import { logger } from "./logger";
import { hardenWebContents } from "./security";
import { getSettings, getWindowState, setWindowState } from "./store";

let mainWindow: BrowserWindow | null = null;
/** Set true on real quit so the close handler stops hiding-to-tray. */
let isQuitting = false;

export function markQuitting(): void {
  isQuitting = true;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Clamp a restored window rectangle to the currently-available displays. */
function isVisibleOnSomeDisplay(x: number, y: number, w: number, h: number): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const b = d.bounds;
    // Require at least a sliver of the titlebar to be on-screen.
    return x < b.x + b.width && x + w > b.x && y < b.y + b.height && y + h > b.y;
  });
}

function resolveInitialBounds(): {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
} {
  const saved = getWindowState();
  const width = saved.width > 0 ? saved.width : WINDOW.defaultWidth;
  const height = saved.height > 0 ? saved.height : WINDOW.defaultHeight;

  if (
    typeof saved.x === "number" &&
    typeof saved.y === "number" &&
    isVisibleOnSomeDisplay(saved.x, saved.y, width, height)
  ) {
    return { x: saved.x, y: saved.y, width, height, isMaximized: saved.isMaximized };
  }
  // No valid saved position → let the OS center the window.
  return { width, height, isMaximized: saved.isMaximized };
}

function persistBounds(win: BrowserWindow): void {
  if (win.isMinimized()) return;
  const isMaximized = win.isMaximized();
  // Use normal bounds so a restore from maximized keeps a sane size.
  const bounds = win.getNormalBounds();
  setWindowState({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized,
  });
}

function applyTheme(): void {
  const { theme } = getSettings();
  nativeTheme.themeSource = theme;
}

/** Build the target URL to load, honoring the configured base app URL. */
function targetUrl(): string {
  return getSettings().appUrl;
}

/** Load the SaaS; on failure, show the bundled offline page. */
async function loadApp(win: BrowserWindow): Promise<void> {
  const url = targetUrl();
  try {
    await win.loadURL(url);
    logger.info(`Loaded app URL: ${url}`);
  } catch (err) {
    logger.error(`Failed to load ${url}: ${String(err)} — showing offline page.`);
    await win.loadFile(paths.offlineHtml).catch((e) => {
      logger.error(`Failed to load offline page: ${String(e)}`);
    });
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  applyTheme();
  const bounds = resolveInitialBounds();

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false, // reveal on ready-to-show to avoid a white flash
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0f17" : "#ffffff",
    title: "DealFlow AI",
    icon: iconPath(),
    autoHideMenuBar: false,
    titleBarStyle: IS_MAC ? "hiddenInset" : "default",
    webPreferences: {
      preload: paths.preload,
      // --- Security-critical flags (Electron hardening checklist) ---
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: true,
    },
  });

  mainWindow = win;
  hardenWebContents(win.webContents);

  if (bounds.isMaximized) win.maximize();

  win.once("ready-to-show", () => {
    // Restore persisted zoom once content exists.
    const { zoomFactor } = getSettings();
    win.webContents.setZoomFactor(zoomFactor);
    win.show();
    if (IS_DEV) win.webContents.openDevTools({ mode: "detach" });
  });

  // Persist geometry (debounced by the OS event cadence).
  win.on("resize", () => persistBounds(win));
  win.on("move", () => persistBounds(win));
  win.on("close", (event) => {
    persistBounds(win);
    const { minimizeToTray } = getSettings();
    if (!isQuitting && minimizeToTray) {
      event.preventDefault();
      if (IS_MAC) {
        win.hide();
      } else {
        win.hide();
      }
      logger.info("Window hidden to tray instead of closing.");
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  // Keep the OS-browser handoff even for target=_blank inside the SaaS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  void loadApp(win);
  return win;
}

/** Re-navigate the existing window to the (possibly changed) app URL. */
export async function reloadApp(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  await loadApp(mainWindow);
}

/** Show + focus the window, creating it if it was fully closed. */
export function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Navigate the SaaS to a specific in-app path (used by deep links + menus). */
export function navigateTo(pathname: string): void {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    createMainWindow();
    return;
  }
  const base = targetUrl();
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  void win.loadURL(`${base}${clean}`).catch((e) => {
    logger.error(`navigateTo failed for ${clean}: ${String(e)}`);
  });
  showMainWindow();
}

export function applyZoom(factor: number): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(factor);
}

export function applyThemeToWindow(): void {
  applyTheme();
}
