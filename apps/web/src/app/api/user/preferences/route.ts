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
const ALLOWED_KEYS = [
  'onboarding_completed',
  'onboarding_checklist',
  'tutorial_progress',
  'notification_preferences',
  'theme',
  'sidebar_collapsed',
  'dashboard_layout',
];

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
      if (ALLOWED_KEYS.includes(key)) {
        updates[key] = body[key];
      }
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
      if (ALLOWED_KEYS.includes(key)) {
        preferences[key] = body[key];
      }
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
