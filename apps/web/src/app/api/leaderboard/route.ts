import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'month';
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    // Get leaderboard with user stats
    // Note: user_stats table needs to be populated by background jobs tracking user activity
    const leaderboard = await sql`
      SELECT
        u.id,
        u.name,
        UPPER(LEFT(COALESCE(u.name, u.email), 1) ||
          COALESCE(SUBSTRING(u.name FROM POSITION(' ' IN u.name) + 1 FOR 1), '')) as avatar,
        COALESCE(s.points, 0) as points,
        COALESCE(s.deals_count, 0) as deals,
        COALESCE(s.total_revenue, 0) as revenue,
        COALESCE(s.response_rate, 0) as response_rate,
        COALESCE(s.current_streak, 0) as streak,
        COALESCE(s.rank_change, 0) as rank_change,
        CASE
          WHEN s.rank_change > 0 THEN 'up'
          WHEN s.rank_change < 0 THEN 'down'
          ELSE 'same'
        END as trend,
        (u.id = ${session.userId}) as is_current_user
      FROM "user" u
      LEFT JOIN user_stats s ON s.user_id = u.id
      WHERE u.banned IS NOT TRUE
      ORDER BY COALESCE(s.points, 0) DESC, u."createdAt" ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Get current user's rank if not in top results
    const [currentUserRank] = await sql`
      WITH ranked AS (
        SELECT
          user_id,
          ROW_NUMBER() OVER (ORDER BY points DESC) as rank
        FROM user_stats
      )
      SELECT rank FROM ranked WHERE user_id = ${session.userId}
    `;

    // Get total user count
    const [{ count: totalUsers }] = await sql`
      SELECT COUNT(*)::int as count FROM "user" WHERE banned IS NOT TRUE
    `;

    return NextResponse.json({
      leaderboard: leaderboard.map((entry, idx) => ({
        ...entry,
        rank: offset + idx + 1,
        revenue: parseFloat(entry.revenue) || 0,
        response_rate: parseFloat(entry.response_rate) || 0,
      })),
      currentUserRank: currentUserRank?.rank || null,
      totalUsers,
      period,
    });
  } catch (error) {
    console.error('[LEADERBOARD] Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}
