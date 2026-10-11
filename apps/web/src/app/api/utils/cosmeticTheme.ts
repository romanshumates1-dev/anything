/**
 * REQUIREMENT SET V3 — cosmetic → theme mapping.
 *
 * roman.agent.md 1275 asks for "dashboard skins" and 1276 for "optional
 * crates/rewards". The crate economy drops `sidebar-theme:*` and
 * `dashboard-theme:*` cosmetics. Without this module, equipping one is a
 * DECORATIVE control: the "Equipped" badge flips but nothing on screen changes.
 *
 * This is the pure, auditable core that turns an equipped theme cosmetic into
 * concrete CSS custom properties. It imports only the client-safe `crates.ts`
 * definitions (no DB, no server-only module) so the Shell/dashboard can apply
 * the theme in the browser without pulling in the Neon driver.
 *
 * Only accent variables are overridden. They are already consumed app-wide
 * (`var(--accent-blue)`, `var(--accent-purple)` drive buttons, icons, active
 * nav and highlights), so a theme is genuinely visible everywhere.
 */
import { COSMETICS } from './crates';

export type ThemeScope = 'sidebar' | 'dashboard';

export interface CosmeticTheme {
  scope: ThemeScope;
  vars: Record<string, string>;
}

/**
 * Theme definitions keyed by cosmetic key. Every `sidebar-theme:*` and
 * `dashboard-theme:*` cosmetic in `COSMETICS` MUST have an entry here — the
 * test suite asserts that totality so an equipped skin can never silently do
 * nothing.
 */
const THEMES: Record<string, CosmeticTheme> = {
  'sidebar-theme:copper': {
    scope: 'sidebar',
    vars: { '--accent-blue': '#b87333', '--accent-purple': '#d89a5a' },
  },
  'sidebar-theme:silver': {
    scope: 'sidebar',
    vars: { '--accent-blue': '#9ca3af', '--accent-purple': '#cbd5e1' },
  },
  'sidebar-theme:crimson': {
    scope: 'sidebar',
    vars: { '--accent-blue': '#dc2626', '--accent-purple': '#f87171' },
  },
  'sidebar-theme:obsidian': {
    scope: 'sidebar',
    vars: { '--accent-blue': '#4b5563', '--accent-purple': '#9ca3af' },
  },
  'sidebar-theme:stellar': {
    scope: 'sidebar',
    vars: { '--accent-blue': '#6366f1', '--accent-purple': '#8b5cf6' },
  },
  'dashboard-theme:twilight': {
    scope: 'dashboard',
    vars: { '--accent-blue': '#6d28d9', '--accent-purple': '#4c1d95' },
  },
  'dashboard-theme:nebula': {
    scope: 'dashboard',
    vars: { '--accent-blue': '#7c3aed', '--accent-purple': '#db2777' },
  },
  'dashboard-theme:aurora': {
    scope: 'dashboard',
    vars: { '--accent-blue': '#10b981', '--accent-purple': '#06b6d4' },
  },
  'dashboard-theme:prismatic': {
    scope: 'dashboard',
    vars: { '--accent-blue': '#ec4899', '--accent-purple': '#8b5cf6' },
  },
};

/**
 * Resolve an equipped cosmetic key to a theme, or null when the cosmetic is not
 * a theme (frames/badges are profile-only) or is unknown/empty.
 */
export function themeForCosmetic(key: string): CosmeticTheme | null {
  if (!key) return null;
  if (!(key in COSMETICS)) return null;
  return THEMES[key] ?? null;
}

/**
 * Convenience: the theme's CSS variables as a React style object. Returns an
 * empty object for non-theme cosmetics so callers can spread it unconditionally.
 */
export function themeVarStyle(key: string): Record<string, string> {
  const theme = themeForCosmetic(key);
  return theme ? { ...theme.vars } : {};
}
