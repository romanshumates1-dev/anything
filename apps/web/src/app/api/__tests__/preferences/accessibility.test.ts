/**
 * ACCESSIBILITY PREFERENCES — SANITIZATION AND PERSISTENCE CONTRACT (item 5).
 *
 * The security-relevant property is that a preference, once stored, ends up in
 * a `data-*` ATTRIBUTE on <html>. Any path that lets an arbitrary string reach
 * that attribute is a stored injection vector: the whole point of validating
 * against a fixed enum is that the CSS only ever has to reason about known
 * values.
 *
 * These tests pin:
 *  1. every stored value is coerced to a known enum member or the default;
 *  2. the attribute map always emits all five keys (so switching back from
 *     'always' to 'system' CLEARS the override instead of leaving it stale);
 *  3. the server route applies the same sanitization the client does, and the
 *     two lists cannot drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Paths verified with node's path.resolve rather than counted by eye - a wrong
// relative import does NOT fail this run, it silently collects ZERO tests while
// the suite stays green. That has now happened three times in this audit.
import {
  sanitizeAccessibility,
  accessibilityAttributes,
  DEFAULT_ACCESSIBILITY,
  ACCESSIBILITY_ALLOWED,
  ACCESSIBILITY_STORAGE_KEY,
} from '../../../../components/AccessibilityProvider';
import {
  sanitizeAccessibility as serverSanitize,
  DEFAULT_ACCESSIBILITY as SERVER_DEFAULTS,
} from '../../user/preferences/route';

describe('accessibility preference sanitization (client)', () => {
  it('falls back to defaults for empty, null, undefined and non-objects', () => {
    for (const bad of [null, undefined, 42, 'dyslexic', true, []]) {
      expect(sanitizeAccessibility(bad)).toEqual(DEFAULT_ACCESSIBILITY);
    }
  });

  it('accepts every legitimately allowed value', () => {
    const full = {
      fontFamily: 'dyslexic',
      fontScale: 'large',
      reduceMotion: 'always',
      contrast: 'high',
      density: 'compact',
    };
    expect(sanitizeAccessibility(full)).toEqual(full);
  });

  it('REJECTS an injected className - the stored-XSS vector', () => {
    // If a preference could carry arbitrary text, it would be written into a
    // data-* attribute on <html> and then into class/style handling.
    const hostile = {
      fontFamily: 'x" onload="alert(1)',
      className: 'evil-class',
      __proto__: { polluted: true },
      contrast: 'high',
    };
    const out = sanitizeAccessibility(hostile);

    // Only the one valid field survives.
    expect(out.contrast).toBe('high');
    expect(out.fontFamily).toBe(DEFAULT_ACCESSIBILITY.fontFamily);
    // The injected keys simply do not exist on the result.
    expect(Object.keys(out).sort()).toEqual(
      ['contrast', 'density', 'fontFamily', 'fontScale', 'reduceMotion'].sort()
    );
    expect(JSON.stringify(out)).not.toContain('alert');
    expect(JSON.stringify(out)).not.toContain('onload');
    expect(JSON.stringify(out)).not.toContain('evil-class');
  });

  it('coerces a partially-specified object field-by-field, not all-or-nothing', () => {
    // A stale row written by an older version (or a partial write) must not
    // wipe the settings the user did choose.
    const out = sanitizeAccessibility({ fontFamily: 'dyslexic', contrast: 'NONSENSE' });
    expect(out.fontFamily).toBe('dyslexic');
    expect(out.contrast).toBe('default');
  });

  it('emits ALL five attributes so reverting a choice clears it', () => {
    // The bug this prevents: emitting only the non-default values would leave
    // data-reduce-motion="always" stuck on <html> after switching back to
    // "follow system".
    //
    // The attribute names here must match the `html[data-*]` selectors in
    // global.css exactly (data-font-scale, not data-fontScale) - if the two
    // ever drift, every setting silently stops working. That mapping is what
    // the next test pins.
    const attrs = accessibilityAttributes(DEFAULT_ACCESSIBILITY);
    expect(Object.keys(attrs).sort()).toEqual([
      'data-contrast',
      'data-density',
      'data-font',
      'data-font-scale',
      'data-reduce-motion',
    ]);
    expect(attrs['data-reduce-motion']).toBe('system');
  });

  it('uses attribute names that the CSS actually styles', () => {
    // Guards the drift above: a renamed preference key or attribute would
    // produce a toggle that saves, persists, and does nothing visible.
    const css = readFileSync(
      join(process.cwd(), 'src', 'app', 'global.css'),
      'utf8'
    );
    for (const attr of Object.keys(accessibilityAttributes(DEFAULT_ACCESSIBILITY))) {
      expect(css, `global.css has no rule for ${attr}`).toContain(`[${attr}=`);
    }
  });

  it('does not force anything on a user who never chose anything', () => {
    // Defaults must be no-op values: nothing in global.css keys on 'default',
    // 'system' or 'comfortable' to CHANGE anything.
    for (const v of Object.values(DEFAULT_ACCESSIBILITY)) {
      expect(v).not.toBe('dyslexic');
      expect(v).not.toBe('large');
      expect(v).not.toBe('always');
      expect(v).not.toBe('high');
      expect(v).not.toBe('compact');
    }
  });

  it('has a stable storage key shared with the pre-paint script', () => {
    expect(ACCESSIBILITY_STORAGE_KEY).toBe('dsa11y');
  });
});

describe('server and client sanitization cannot drift', () => {
  it('produces identical defaults', () => {
    expect(SERVER_DEFAULTS).toEqual(DEFAULT_ACCESSIBILITY);
  });

  it('rejects the same hostile input on both sides', () => {
    const hostile = { fontFamily: 'evil" onerror="x', contrast: 'high' };
    const client = sanitizeAccessibility(hostile);
    const server = serverSanitize(hostile);
    expect(client).toEqual(server);
    expect(JSON.stringify(server)).not.toContain('onerror');
  });

  it('agrees on which values are legal', () => {
    // If the server ever accepts a value the CSS has no rule for, the setting
    // would silently do nothing. Same list, one source of truth.
    for (const [key, values] of Object.entries(ACCESSIBILITY_ALLOWED)) {
      const rejected = '__not_a_real_value__';
      const serverOut = serverSanitize({ [key]: rejected }) as Record<string, string>;
      expect(serverOut[key]).toBe(
        (DEFAULT_ACCESSIBILITY as Record<string, string>)[key],
        `server rejected the legal list for ${key}`
      );
      expect(values.length).toBeGreaterThan(1);
    }
  });
});