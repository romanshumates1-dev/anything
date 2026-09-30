import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';

/**
 * User preferences API
 * Handles storing and retrieving user-specific preferences like:
 * - Onboarding completion status
 * - Tutorial progress
 * - Notification settings
 * - UI preferences
 */

// Allowed preference keys to prevent arbitrary data storage
//
// ACCESSIBILITY KEYS (2026-09-30): the app already honoured the OS-level
// `prefers-reduced-motion` / `prefers-contrast` media queries, so a user who
// needs less motion or more contrast on ONE device got it on that device only -
// there was no way to express "always do this for me" and no way to carry the
// choice to another machine. These keys persist that choice server-side.
//
// The values are validated in the settings component AND sanitised here: only
// the known enum members are honoured, so a hand-rolled PATCH cannot inject an
// arbitrary class name or stylesheet reference into the rendered page.
const ALLOWED_KEYS = [
  'onboarding_completed',
  'onboarding_checklist',
  'tutorial_progress',
  'notification_preferences',
  'theme',
  'sidebar_collapsed',
  'dashboard_layout',
  'accessibility',
];

/**
 * Permitted shapes for the `accessibility` preference.
 *
 * Anything outside these enums is DROPPED rather than stored. `className` in
 * particular is never accepted from the client: it would let a stored
 * preference inject an arbitrary class into <html>, which is a stored-XSS
 * vector if a preference row can ever be written by anyone but its owner.
 */
const ACCESSIBILITY_ENUMS = {
  fontFamily: ['default', 'dyslexic'] as const,
  fontScale: ['default', 'large'] as const,
  reduceMotion: ['system', 'always'] as const,
  contrast: ['default', 'high'] as const,
  density: ['comfortable', 'compact'] as const,
} as const;

type AccessibilityPrefs = {
  fontFamily: (typeof ACCESSIBILITY_ENUMS.fontFamily)[number];
  fontScale: (typeof ACCESSIBILITY_ENUMS.fontScale)[number];
  reduceMotion: (typeof ACCESSIBILITY_ENUMS.reduceMotion)[number];
  contrast: (typeof ACCESSIBILITY_ENUMS.contrast)[number];
  density: (typeof ACCESSIBILITY_ENUMS.density)[number];
};

export const DEFAULT_ACCESSIBILITY: AccessibilityPrefs = {
  fontFamily: 'default',
  fontScale: 'default',
  reduceMotion: 'system',
  contrast: 'default',
  density: 'comfortable',
};

/**
 * Coerce an untrusted `accessibility` payload into a known-safe object.
 *
 * Every field falls back to its default, so a partially-written or hand-crafted
 * value can never leave the page in an undefined state. Returns null only when
 * the payload is not an object at all.
 */
export function sanitizeAccessibility(input: unknown): AccessibilityPrefs | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const src = input as Record<string, unknown>;
  const pick = <K extends keyof typeof ACCESSIBILITY_ENUMS>(key: K): AccessibilityPrefs[K] => {
    const allowed = ACCESSIBILITY_ENUMS[key] as readonly string[];
    const v = src[key];
    return (typeof v === 'string' && allowed.includes(v)
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

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Backed by public."user".preferences (jsonb) — added in migration 094.
    const [result] = await sql`
      SELECT preferences
      FROM "user"
      WHERE id = ${session.userId}
      LIMIT 1
    `;

    // Return preferences or empty object
    return NextResponse.json({
      preferences: result?.preferences || {},
    });
  } catch (error) {
    // A failed read must not masquerade as "no preferences stored": log the
    // cause and fail the request so callers can tell empty from broken.
    console.error('[PREFERENCES] Error fetching preferences:', error);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Validate that only allowed keys are being set
    const updates: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      // Accessibility values are enum-checked, not passed through verbatim, so
      // a hand-crafted PATCH cannot persist an arbitrary value that the client
      // would later place into a class attribute on <html>.
      if (key === 'accessibility') {
        const safe = sanitizeAccessibility(body[key]);
        if (safe) updates[key] = safe;
        continue;
      }
      updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No valid preferences to update',
      });
    }

    // Persist to public."user".preferences (jsonb, migration 094). Failures
    // propagate to the catch below — a write that did not happen must never
    // be reported as success.
    await sql`
      UPDATE "user"
      SET preferences = COALESCE(preferences, '{}'::jsonb) || ${JSON.stringify(updates)}::jsonb,
          "updatedAt" = NOW()
      WHERE id = ${session.userId}
    `;

    return NextResponse.json({
      success: true,
      updated: Object.keys(updates),
    });
  } catch (error) {
    console.error('[PREFERENCES] Error updating preferences:', error);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  // PUT replaces all preferences, PATCH merges
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Validate that only allowed keys are being set
    const preferences: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      if (key === 'accessibility') {
        const safe = sanitizeAccessibility(body[key]);
        if (safe) preferences[key] = safe;
        continue;
      }
      preferences[key] = body[key];
    }

    // Same as PATCH: propagate real failures instead of claiming success.
    await sql`
      UPDATE "user"
      SET preferences = ${JSON.stringify(preferences)}::jsonb,
          "updatedAt" = NOW()
      WHERE id = ${session.userId}
    `;

    return NextResponse.json({
      success: true,
      preferences,
    });
  } catch (error) {
    console.error('[PREFERENCES] Error setting preferences:', error);
    return NextResponse.json({ error: 'Failed to set preferences' }, { status: 500 });
  }
}
