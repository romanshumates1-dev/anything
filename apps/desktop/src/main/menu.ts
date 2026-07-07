/**
 * Native application menu.
 *
 * Provides the standard platform menu layout plus DealFlow-specific navigation
 * shortcuts (Dashboard, Campaigns, Inbox, Approvals, …) that drive the SaaS via
 * the window's navigateTo helper. On macOS the first submenu is the app menu.
 */
import { Menu, app, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";

import { IS_MAC } from "./config";
import { checkForUpdates } from "./updater";
import {
  applyZoom,
  getMainWindow,
  navigateTo,
  reloadApp,
} from "./window";
import { getSettings, setSettings } from "./store";
import { openSettingsWindow } from "./settings-window";

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;

function changeZoom(delta: number | "reset"): void {
  const current = getSettings().zoomFactor;
  const next =
    delta === "reset"
      ? 1
      : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((current + delta).toFixed(2))));
  setSettings({ zoomFactor: next });
  applyZoom(next);
}

export function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [];

  if (IS_MAC) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates…",
          click: () => void checkForUpdates(true),
        },
        { type: "separator" },
        {
          label: "Preferences…",
          accelerator: "Cmd+,",
          click: () => openSettingsWindow(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  // File
  template.push({
    label: "File",
    submenu: [
      {
        label: "New Campaign",
        accelerator: "CmdOrCtrl+N",
        click: () => navigateTo("/campaigns/wizard"),
      },
      { type: "separator" },
      ...(!IS_MAC
        ? ([
            {
              label: "Settings…",
              accelerator: "CmdOrCtrl+,",
              click: () => openSettingsWindow(),
            } as MenuItemConstructorOptions,
            { type: "separator" } as MenuItemConstructorOptions,
          ])
        : []),
      IS_MAC ? { role: "close" } : { role: "quit" },
    ],
  });

  // Edit
  template.push({
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  });

  // Go — DealFlow navigation
  template.push({
    label: "Go",
    submenu: [
      {
        label: "Dashboard",
        accelerator: "CmdOrCtrl+1",
        click: () => navigateTo("/"),
      },
      {
        label: "Campaigns",
        accelerator: "CmdOrCtrl+2",
        click: () => navigateTo("/campaigns"),
      },
      {
        label: "Inbox",
        accelerator: "CmdOrCtrl+3",
        click: () => navigateTo("/inbox"),
      },
      {
        label: "Approvals",
        accelerator: "CmdOrCtrl+4",
        click: () => navigateTo("/approvals"),
      },
      {
        label: "Leads",
        accelerator: "CmdOrCtrl+5",
        click: () => navigateTo("/leads"),
      },
      {
        label: "Analytics",
        accelerator: "CmdOrCtrl+6",
        click: () => navigateTo("/analytics"),
      },
      {
        label: "Contracts",
        accelerator: "CmdOrCtrl+7",
        click: () => navigateTo("/contracts"),
      },
      { type: "separator" },
      {
        label: "Settings",
        click: () => navigateTo("/settings"),
      },
    ],
  });

  // View
  template.push({
    label: "View",
    submenu: [
      {
        label: "Reload",
        accelerator: "CmdOrCtrl+R",
        click: () => void reloadApp(),
      },
      {
        label: "Force Reload",
        accelerator: "CmdOrCtrl+Shift+R",
        click: () => {
          const win = getMainWindow();
          win?.webContents.reloadIgnoringCache();
        },
      },
      { type: "separator" },
      {
        label: "Zoom In",
        accelerator: "CmdOrCtrl+Plus",
        click: () => changeZoom(ZOOM_STEP),
      },
      {
        label: "Zoom Out",
        accelerator: "CmdOrCtrl+-",
        click: () => changeZoom(-ZOOM_STEP),
      },
      {
        label: "Actual Size",
        accelerator: "CmdOrCtrl+0",
        click: () => changeZoom("reset"),
      },
      { type: "separator" },
      { role: "togglefullscreen" },
      {
        label: "Toggle Developer Tools",
        accelerator: IS_MAC ? "Alt+Cmd+I" : "Ctrl+Shift+I",
        click: () => getMainWindow()?.webContents.toggleDevTools(),
      },
    ],
  });

  // Window
  template.push({
    label: "Window",
    role: "windowMenu",
  });

  // Help
  template.push({
    role: "help",
    submenu: [
      {
        label: "DealFlow AI Documentation",
        click: () => void shell.openExternal("https://docs.dealflow.ai"),
      },
      {
        label: "Support",
        click: () => void shell.openExternal("https://support.dealflow.ai"),
      },
      { type: "separator" },
      {
        label: "Check for Updates…",
        click: () => void checkForUpdates(true),
      },
      ...(!IS_MAC
        ? ([
            { type: "separator" } as MenuItemConstructorOptions,
            { role: "about" } as MenuItemConstructorOptions,
          ])
        : []),
    ],
  });

  return Menu.buildFromTemplate(template);
}

export function installApplicationMenu(): void {
  Menu.setApplicationMenu(buildMenu());
}
