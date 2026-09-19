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
    // Try to get preferences from user metadata or a dedicated preferences table
    // For now, we'll use a simple approach with a JSONB column
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
    // If preferences column doesn't exist, return empty
    console.error('[PREFERENCES] Error fetching preferences:', error);
    return NextResponse.json({
      preferences: {},
    });
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

    // Try to update preferences JSONB column
    // If the column doesn't exist, we'll silently succeed
    // (preferences are primarily stored in localStorage)
    try {
      await sql`
        UPDATE "user"
        SET preferences = COALESCE(preferences, '{}'::jsonb) || ${JSON.stringify(updates)}::jsonb,
            "updatedAt" = NOW()
        WHERE id = ${session.userId}
      `;
    } catch (dbError: unknown) {
      // Column might not exist - that's okay, we use localStorage as primary
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (!errorMessage.includes('column "preferences" does not exist')) {
        console.error('[PREFERENCES] Database error:', dbError);
      }
    }

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

    try {
      await sql`
        UPDATE "user"
        SET preferences = ${JSON.stringify(preferences)}::jsonb,
            "updatedAt" = NOW()
        WHERE id = ${session.userId}
      `;
    } catch (dbError: unknown) {
      // Column might not exist - that's okay
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (!errorMessage.includes('column "preferences" does not exist')) {
        console.error('[PREFERENCES] Database error:', dbError);
      }
    }

    return NextResponse.json({
      success: true,
      preferences,
    });
  } catch (error) {
    console.error('[PREFERENCES] Error setting preferences:', error);
    return NextResponse.json({ error: 'Failed to set preferences' }, { status: 500 });
  }
}
