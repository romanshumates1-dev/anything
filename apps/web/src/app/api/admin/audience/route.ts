import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/admin/audience
 * Get aggregate questionnaire analytics for admin dashboard
 */
export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check admin role
  const [user] = await sql`SELECT role FROM "user" WHERE id = ${session.userId} LIMIT 1`;
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Get overall stats
    const [stats] = await sql`
      SELECT
        COUNT(*) as total_responses,
        COUNT(*) FILTER (WHERE completed_at IS NOT NULL) as completed,
        COUNT(*) FILTER (WHERE skipped_at IS NOT NULL) as skipped,
        COUNT(*) FILTER (WHERE completed_at IS NULL AND skipped_at IS NULL) as in_progress
      FROM public.user_questionnaire_responses
    `;

    // Experience level distribution
    const experienceDistribution = await sql`
      SELECT
        experience_level as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses
      WHERE experience_level IS NOT NULL
      GROUP BY experience_level
      ORDER BY
        CASE experience_level
          WHEN 'BEGINNER' THEN 1
          WHEN 'INTERMEDIATE' THEN 2
          WHEN 'ADVANCED' THEN 3
          WHEN 'EXPERT' THEN 4
        END
    `;

    // Deals per month distribution
    const dealsDistribution = await sql`
      SELECT
        deals_per_month as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses
      WHERE deals_per_month IS NOT NULL
      GROUP BY deals_per_month
      ORDER BY
        CASE deals_per_month
          WHEN '0' THEN 1
          WHEN '1-2' THEN 2
          WHEN '3-5' THEN 3
          WHEN '6-10' THEN 4
          WHEN '10+' THEN 5
        END
    `;

    // Team size distribution
    const teamSizeDistribution = await sql`
      SELECT
        team_size as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses
      WHERE team_size IS NOT NULL
      GROUP BY team_size
      ORDER BY
        CASE team_size
          WHEN 'solo' THEN 1
          WHEN '2-5' THEN 2
          WHEN '6-10' THEN 3
          WHEN '10+' THEN 4
        END
    `;

    // Primary market distribution
    const marketDistribution = await sql`
      SELECT
        primary_market as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses
      WHERE primary_market IS NOT NULL
      GROUP BY primary_market
      ORDER BY value DESC
    `;

    // Biggest challenge distribution
    const challengeDistribution = await sql`
      SELECT
        biggest_challenge as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses
      WHERE biggest_challenge IS NOT NULL
      GROUP BY biggest_challenge
      ORDER BY value DESC
    `;

    // Acquisition source distribution
    const sourceDistribution = await sql`
      SELECT
        how_heard_about_us as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses
      WHERE how_heard_about_us IS NOT NULL
      GROUP BY how_heard_about_us
      ORDER BY value DESC
    `;

    // Budget range distribution
    const budgetDistribution = await sql`
      SELECT
        budget_range as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses
      WHERE budget_range IS NOT NULL
      GROUP BY budget_range
      ORDER BY
        CASE budget_range
          WHEN 'bootstrap' THEN 1
          WHEN '50-200' THEN 2
          WHEN '200-500' THEN 3
          WHEN '500+' THEN 4
        END
    `;

    // Current tools breakdown (unnest the array)
    const toolsDistribution = await sql`
      SELECT
        tool as label,
        COUNT(*) as value
      FROM public.user_questionnaire_responses,
        LATERAL unnest(current_tools) as tool
      WHERE current_tools IS NOT NULL
      GROUP BY tool
      ORDER BY value DESC
      LIMIT 10
    `;

    // Recent responses (last 10)
    const recentResponses = await sql`
      SELECT
        q.id,
        u.email,
        u.name,
        q.experience_level,
        q.deals_per_month,
        q.biggest_challenge,
        q.how_heard_about_us,
        q.completed_at,
        q.created_at
      FROM public.user_questionnaire_responses q
      JOIN "user" u ON q.user_id = u.id
      ORDER BY q.created_at DESC
      LIMIT 10
    `;

    // Completion rate over time (last 30 days)
    const completionTrend = await sql`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE completed_at IS NOT NULL) as completed
      FROM public.user_questionnaire_responses
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    return NextResponse.json({
      stats: {
        totalResponses: parseInt(stats?.total_responses) || 0,
        completed: parseInt(stats?.completed) || 0,
        skipped: parseInt(stats?.skipped) || 0,
        inProgress: parseInt(stats?.in_progress) || 0,
        completionRate: stats?.total_responses > 0
          ? Math.round((parseInt(stats?.completed) / parseInt(stats?.total_responses)) * 100)
          : 0,
      },
      distributions: {
        experience: experienceDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
        dealsPerMonth: dealsDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
        teamSize: teamSizeDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
        market: marketDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
        challenge: challengeDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
        source: sourceDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
        budget: budgetDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
        tools: toolsDistribution.map(r => ({ label: r.label, value: parseInt(r.value) })),
      },
      recentResponses: recentResponses.map(r => ({
        id: r.id,
        email: r.email,
        name: r.name,
        experienceLevel: r.experience_level,
        dealsPerMonth: r.deals_per_month,
        biggestChallenge: r.biggest_challenge,
        howHeardAboutUs: r.how_heard_about_us,
        completedAt: r.completed_at,
        createdAt: r.created_at,
      })),
      completionTrend: completionTrend.map(r => ({
        date: r.date,
        total: parseInt(r.total),
        completed: parseInt(r.completed),
      })),
    });
  } catch (error) {
    console.error('[ADMIN/AUDIENCE] Error fetching analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
