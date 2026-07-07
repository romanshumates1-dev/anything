/**
 * Ambient typing for the renderer: augments `window` with the typed bridge that
 * the preload exposes via contextBridge. Lets the settings/offline pages call
 * `window.dealflow.*` with full type-safety.
 */
import type { DesktopBridge } from "../shared/ipc";

declare global {
  interface Window {
    dealflow: DesktopBridge;
  }
}

export {};
