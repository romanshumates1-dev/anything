'use client';

/**
 * Accessibility preferences: APPLY them to the document.
 *
 * WHY A SEPARATE COMPONENT (item 5 of the audit)
 * ----------------------------------------------
 * The app already respected the OS-level `prefers-reduced-motion` and
 * `prefers-contrast` media queries, but those describe ONE device. A user who
 * needs reduced motion or a dyslexic font has no way to say "always, on every
 * machine I use" - and the platform had no settings UI for it at all.
 *
 * These preferences are stored server-side in public."user".preferences
 * (migration 094), so the choice follows the user across devices.
 *
 * WHY CLASSES ON <html>, NOT INLINE STYLES
 * -----------------------------------------
 * Every rule lives in global.css keyed on a `data-*` attribute, so the browser
 * applies them with the normal cascade and the existing reduced-motion block's
 * `!important` still wins. Nothing user-supplied is interpolated into a style
 * attribute.
 *
 * FOUC / HYDRATION
 * ----------------
 * Applying these from React alone means the wrong typography renders first and
 * then snaps. `getStoredAccessibility()` is exported and read by an inline
 * script in the document head so the attributes are on <html> before first
 * paint. React then owns them from hydration onward.
 *
 * DEFAULT-ON SAFETY
 * -----------------
 * Nothing is forced globally: every unset preference is 'default', so a user
 * who never visits settings gets exactly today's appearance and motion.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/auth-client';

export interface AccessibilityPrefs {
  fontFamily: 'default' | 'dyslexic';
  fontScale: 'default' | 'large';
  reduceMotion: 'system' | 'always';
  contrast: 'default' | 'high';
  density: 'comfortable' | 'compact';
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPrefs = {
  fontFamily: 'default',
  fontScale: 'default',
  reduceMotion: 'system',
  contrast: 'default',
  density: 'comfortable',
};

/** Storage key, exported so the pre-paint inline script and this module agree. */
export const ACCESSIBILITY_STORAGE_KEY = 'dsa11y';

/**
 * Allowed values per preference, exported so the inline pre-paint script
 * validates against exactly the same list this module does. If these two
 * lists ever diverge, the pre-paint script could write a value the CSS keys on
 * differently from the one React applies - so they are declared once, here.
 */
export const ACCESSIBILITY_ALLOWED = {
  fontFamily: ['default', 'dyslexic'],
  fontScale: ['default', 'large'],
  reduceMotion: ['system', 'always'],
  contrast: ['default', 'high'],
  density: ['comfortable', 'compact'],
} as const;

const STORAGE_KEY = ACCESSIBILITY_STORAGE_KEY;
const VALID = ACCESSIBILITY_ALLOWED;

/** Coerce anything into a known-safe preference object. Never throws. */
export function sanitizeAccessibility(raw: unknown): AccessibilityPrefs {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof typeof VALID>(key: K): AccessibilityPrefs[K] => {
    const v = src[key];
    return (typeof v === 'string' && (VALID[key] as readonly string[]).includes(v)
      ? v
      : DEFAULT_ACCESSIBILITY[key]) as AccessibilityPrefs[K];
  };
  return {
    fontFamily: pick('fontFamily'),
    fontScale: pick('fontScale'),
    reduceMotion: pick('reduceMotion'),
    contrast: pick('contrast'),
    density: pick('density'),
  };
}

/**
 * Read the cached preferences for the pre-paint inline script.
 *
 * Mirrors what the server will eventually confirm. localStorage is the cache
 * (fast, synchronous, no flash); the server copy is authoritative and is
 * reconciled once it loads. Returns null when nothing is cached, so the caller
 * can leave the document untouched.
 */
export function getStoredAccessibility(): AccessibilityPrefs | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeAccessibility(JSON.parse(raw));
  } catch {
    // Private-mode / quota / malformed JSON: fall back to defaults rather than
    // blocking render on a cache read.
    return null;
  }
}

/** Map prefs -> the data attributes the CSS keys on. Pure, so it is testable. */
export function accessibilityAttributes(prefs: AccessibilityPrefs): Record<string, string> {
  // Both motion/contrast values are always emitted rather than one being
  // omitted, so switching from 'always' back to 'system' CLEARS the attribute
  // instead of leaving a stale value behind.
  return {
    'data-font': prefs.fontFamily,
    'data-font-scale': prefs.fontScale,
    'data-density': prefs.density,
    'data-reduce-motion': prefs.reduceMotion,
    'data-contrast': prefs.contrast,
  };
}

/** Apply prefs to <html>. No-ops when there is no document (SSR). */
export function applyAccessibility(prefs: AccessibilityPrefs): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(accessibilityAttributes(prefs))) {
    root.setAttribute(key, value);
  }
}

interface AccessibilityContextValue {
  prefs: AccessibilityPrefs;
  /** True until the cached value has been adopted. */
  loading: boolean;
  setPref: <K extends keyof AccessibilityPrefs>(key: K, value: AccessibilityPrefs[K]) => void;
  reset: () => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    throw new Error('useAccessibility must be used inside <AccessibilityProvider>');
  }
  return ctx;
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(DEFAULT_ACCESSIBILITY);
  const [loading, setLoading] = useState(true);

  // Pre-paint: adopt the cache immediately so React's first render matches what
  // the inline head script already applied to <html>.
  useEffect(() => {
    const cached = getStoredAccessibility();
    const initial = cached ?? DEFAULT_ACCESSIBILITY;
    setPrefs(initial);
    applyAccessibility(initial);
    setLoading(cached === null);
  }, []);

  // The server copy is authoritative and wins whenever it actually carries a
  // stored value. If it does not (signed-out visitor, or a user who never set
  // anything) the cached/default value stands.
  //
  // WHY THE SESSION GATE (C4 console-error fix): this fetch used to fire for
  // EVERY visitor. For an anonymous one /api/user/preferences answers 401, and
  // the browser logs a 401 response as a console error
  // ("Failed to load resource: the server responded with a status of 401").
  // It was showing up on every public page load - /, /dashboard, /reviews.
  // A signed-out visitor has no stored preferences to reconcile, so the only
  // correct fix is to not ask. The cached/default values still apply, which is
  // exactly the pre-existing behaviour for that visitor.
  const { data: session } = useSession();

  useEffect(() => {
    // Still resolving the session: wait rather than firing a request whose
    // answer we would only have to discard a moment later.
    if (!session) {
      // A signed-out visitor has nothing stored server-side to reconcile, so
      // "loading" is over for them. Stating it explicitly keeps `loading`
      // honest for any future caller instead of leaving it stuck at true.
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/user/preferences');
        if (!res.ok) return;
        const body = await res.json();
        const server = sanitizeAccessibility(body?.preferences?.accessibility);
        if (!cancelled) {
          setPrefs(server);
          applyAccessibility(server);
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(server));
          } catch {
            /* cache write is best-effort */
          }
        }
      } catch {
        // Offline / unauthenticated: keep the cached value. A settings screen
        // that wipes itself on a network hiccup is worse than one showing a
        // briefly stale value.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const persist = (next: AccessibilityPrefs) => {
    setPrefs(next);
    applyAccessibility(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* best-effort */
    }
    // Fire-and-forget: the UI updates from local state regardless, and a failed
    // save must not roll the user's choice back or block the page.
    void fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessibility: next }),
    }).catch(() => {
      /* the next load reconciles from the server */
    });
  };

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      prefs,
      loading,
      setPref: (key, val) => persist({ ...prefs, [key]: val }),
      reset: () => persist(DEFAULT_ACCESSIBILITY),
    }),
    [prefs, loading]
  );

  return <AccessibilityContext.Provider value={value}>{children}</AccessibilityContext.Provider>;
}