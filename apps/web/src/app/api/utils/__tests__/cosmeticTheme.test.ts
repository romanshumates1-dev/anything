/**
 * Tests for the cosmetic → theme mapping — the pure, auditable core that makes
 * an equipped "dashboard skin" / "sidebar theme" cosmetic GENUINELY affect the
 * app instead of being a decorative control.
 *
 * INVARIANTS
 * ----------
 *   * Only `sidebar-theme:*` and `dashboard-theme:*` cosmetics map to a theme.
 *     Frames and badges are profile-only and return null (no global effect).
 *   * The mapping is deterministic and total over the theme cosmetics defined
 *     in `crates.ts` — every theme key resolves, so no equipped skin silently
 *     does nothing.
 *   * Every returned value is a non-empty CSS custom property (`--...`).
 */
import { describe, it, expect } from 'vitest';
import { COSMETICS } from '../crates';
import { themeForCosmetic, themeVarStyle } from '../cosmeticTheme';

const THEME_KEYS = Object.keys(COSMETICS).filter(
  (k) => k.startsWith('sidebar-theme:') || k.startsWith('dashboard-theme:'),
);
const NON_THEME_KEYS = Object.keys(COSMETICS).filter(
  (k) => !k.startsWith('sidebar-theme:') && !k.startsWith('dashboard-theme:'),
);

describe('cosmeticTheme — theme mapping', () => {
  it('maps every theme cosmetic to a scope and CSS variables', () => {
    expect(THEME_KEYS.length).toBeGreaterThan(0);
    for (const key of THEME_KEYS) {
      const theme = themeForCosmetic(key);
      expect(theme, `expected a theme for ${key}`).not.toBeNull();
      expect(['sidebar', 'dashboard']).toContain(theme!.scope);
      const keys = Object.keys(theme!.vars);
      expect(keys.length).toBeGreaterThan(0);
      for (const v of keys) expect(v.startsWith('--')).toBe(true);
      for (const v of Object.values(theme!.vars)) {
        expect(typeof v).toBe('string');
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });

  it('returns null for non-theme cosmetics (frames, badges)', () => {
    expect(NON_THEME_KEYS.length).toBeGreaterThan(0);
    for (const key of NON_THEME_KEYS) {
      expect(themeForCosmetic(key), `${key} should not map to a theme`).toBeNull();
    }
  });

  it('returns null for an unknown or empty key', () => {
    expect(themeForCosmetic('nope:missing')).toBeNull();
    expect(themeForCosmetic('')).toBeNull();
  });

  it('is deterministic — same key, same vars', () => {
    const a = themeForCosmetic('dashboard-theme:nebula');
    const b = themeForCosmetic('dashboard-theme:nebula');
    expect(a).toEqual(b);
  });
});

describe('cosmeticTheme — themeVarStyle', () => {
  it('returns an empty style for a non-theme key', () => {
    expect(themeVarStyle('avatar-frame:gold')).toEqual({});
    expect(themeVarStyle('')).toEqual({});
  });

  it('returns CSS custom properties usable as a React style object', () => {
    const style = themeVarStyle('sidebar-theme:crimson') as Record<string, string>;
    const keys = Object.keys(style);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith('--')).toBe(true);
  });
});

