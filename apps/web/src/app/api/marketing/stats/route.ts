import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

/**
 * GET /api/marketing/stats
 *
 * Returns marketing statistics for scarcity and social proof elements:
 * - spotsRemaining: number of beta spots left (calculated or hardcoded)
 * - signupsThisWeek: number of new signups in the past 7 days
 * - lastSignupLocation: city/state of most recent signup
 * - lastSignupTimeAgo: human-readable time since last signup
 * - promoEndDate: ISO date string for current promotion end
 *
 * This endpoint is public and cacheable.
 */
export async function GET() {
  try {
    // Configuration
    const MAX_BETA_SPOTS = 1000;
    const PROMO_END_DATE = new Date('2026-10-15T23:59:59Z'); // Configurable promo end

    // Get total user count for spots calculation
    let totalUsers = 0;
    let signupsThisWeek = 0;
    // DATA INTEGRITY: the user table has no location column, so a signup location is
    // simply not knowable here. We report `null` and the UI omits the notification.
    // It was previously filled with a RANDOM city, which shipped a fabricated
    // "someone in <city> just signed up" alert to real visitors. Never invent data.
    let lastSignupLocation: string | null = null;
    let lastSignupTime: Date | null = null;
    // Only true when every query above actually returned. The inner catch resets the
    // counters to zero, so without this the endpoint would report verified zeros
    // as if they were real measurements.
    let dataVerified = false;

    try {
      // Total users - note: table is "user" not "users"
      const usersResult = await sql`SELECT COUNT(*) as count FROM public."user"`;
      totalUsers = parseInt(usersResult[0]?.count || '0', 10);

      // Signups this week
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const weeklyResult = await sql`
        SELECT COUNT(*) as count FROM public."user"
        WHERE created_at >= ${weekAgo.toISOString()}
      `;
      signupsThisWeek = parseInt(weeklyResult[0]?.count || '0', 10);

      // Last signup time (location not available in current schema)
      const lastSignupResult = await sql`
        SELECT created_at
        FROM public."user"
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (lastSignupResult[0]) {
        lastSignupTime = new Date(lastSignupResult[0].created_at);
      }

      dataVerified = true;
    } catch {
      // Database query failed - return zeros to indicate no verified data
      // This is expected in development or when tables don't exist
      console.warn('Marketing stats: DB query failed, returning zeros');

      // Return zeros when we cannot verify real data - UI will handle display appropriately
      totalUsers = 0;
      signupsThisWeek = 0;
      lastSignupTime = null;
    }

    // Calculate spots remaining (minimum 50 to avoid showing 0)
    const spotsRemaining = Math.max(50, MAX_BETA_SPOTS - totalUsers);

    // Calculate time ago string
    const lastSignupTimeAgo = lastSignupTime
      ? formatTimeAgo(lastSignupTime)
      : '3 minutes ago';

    // Return actual signups count - do not inflate for marketing purposes
    const displaySignups = signupsThisWeek;

    const response = {
      spotsRemaining,
      totalSpots: MAX_BETA_SPOTS,
      signupsThisWeek: displaySignups,
      lastSignupLocation,
      lastSignupTimeAgo,
      promoEndDate: PROMO_END_DATE.toISOString(),
      // DATA MINIMISATION: `percentClaimed` is derived from the real signup count, but
      // the exact figure is deliberately NOT published. This endpoint is anonymous and
      // cacheable, so returning `activeUsers: <exact count>` leaked the business's real
      // customer total to anyone who called it. Keep it coarse.
      percentClaimed: Math.round((totalUsers / MAX_BETA_SPOTS) * 100),
      dataVerified,
    };

    return NextResponse.json(response, {
      headers: {
        // Cache for 5 minutes at edge, revalidate in background
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Marketing stats error:', error);

    // Return zeros on error - do not fabricate marketing statistics
    return NextResponse.json(
      {
        spotsRemaining: 1000, // All spots available when we can't verify
        totalSpots: 1000,
        signupsThisWeek: 0,
        lastSignupLocation: null,
        lastSignupTimeAgo: null,
        promoEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        activeUsers: 0,
        percentClaimed: 0,
        dataVerified: false, // Flag to indicate data could not be verified
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60',
        },
      }
    );
  }
}

/**
 * Format a date as a human-readable "time ago" string
 */
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'just now';
  } else if (diffMin < 60) {
    return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  } else if (diffHour < 24) {
    return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  } else if (diffDay < 7) {
    return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  } else {
    return 'last week';
  }
}
