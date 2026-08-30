import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

/**
 * Admin system statistics - overview metrics for the admin dashboard.
 * Returns counts for users, campaigns, messages, and system health indicators.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    // Execute all stat queries in parallel
    const [
      [userStats],
      [campaignStats],
      [messageStats],
      [leadStats],
      [apiKeyStats],
      [recentActivity],
    ] = await Promise.all([
      // User statistics
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE role = 'ADMIN')::int AS admins,
          COUNT(*) FILTER (WHERE banned = true OR (suspended_until IS NOT NULL AND suspended_until > now()))::int AS banned_suspended,
          COUNT(*) FILTER (WHERE "createdAt" > now() - interval '7 days')::int AS new_this_week,
          COUNT(*) FILTER (WHERE "createdAt" > now() - interval '30 days')::int AS new_this_month
        FROM "user"
      `,
      // Campaign statistics
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE "createdAt" > now() - interval '7 days')::int AS new_this_week
        FROM campaigns
      `,
      // Message statistics (sent today and this week)
      sql`
        SELECT
          COUNT(*) FILTER (WHERE "sentAt"::date = CURRENT_DATE)::int AS sent_today,
          COUNT(*) FILTER (WHERE "sentAt" > now() - interval '7 days')::int AS sent_this_week,
          COUNT(*) FILTER (WHERE "sentAt" > now() - interval '30 days')::int AS sent_this_month,
          COUNT(*) FILTER (WHERE direction = 'inbound' AND "sentAt"::date = CURRENT_DATE)::int AS received_today
        FROM messages
      `,
      // Lead statistics
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'hot')::int AS hot,
          COUNT(*) FILTER (WHERE status = 'warm')::int AS warm,
          COUNT(*) FILTER (WHERE "createdAt" > now() - interval '7 days')::int AS new_this_week
        FROM leads
      `,
      // API key usage
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE revoked = false)::int AS active,
          COALESCE(SUM(usage_count), 0)::int AS total_usage
        FROM api_keys
      `,
      // Recent admin activity
      sql`
        SELECT COUNT(*)::int AS entries_today
        FROM admin_audit_log
        WHERE created_at::date = CURRENT_DATE
      `,
    ]);

    // Check system health indicators
    const systemHealth = await checkSystemHealth();

    return Response.json({
      users: {
        total: userStats?.total ?? 0,
        admins: userStats?.admins ?? 0,
        bannedSuspended: userStats?.banned_suspended ?? 0,
        newThisWeek: userStats?.new_this_week ?? 0,
        newThisMonth: userStats?.new_this_month ?? 0,
      },
      campaigns: {
        total: campaignStats?.total ?? 0,
        active: campaignStats?.active ?? 0,
        paused: campaignStats?.paused ?? 0,
        completed: campaignStats?.completed ?? 0,
        newThisWeek: campaignStats?.new_this_week ?? 0,
      },
      messages: {
        sentToday: messageStats?.sent_today ?? 0,
        sentThisWeek: messageStats?.sent_this_week ?? 0,
        sentThisMonth: messageStats?.sent_this_month ?? 0,
        receivedToday: messageStats?.received_today ?? 0,
      },
      leads: {
        total: leadStats?.total ?? 0,
        hot: leadStats?.hot ?? 0,
        warm: leadStats?.warm ?? 0,
        newThisWeek: leadStats?.new_this_week ?? 0,
      },
      apiKeys: {
        total: apiKeyStats?.total ?? 0,
        active: apiKeyStats?.active ?? 0,
        totalUsage: apiKeyStats?.total_usage ?? 0,
      },
      activity: {
        adminActionsToday: recentActivity?.entries_today ?? 0,
      },
      systemHealth,
    });
  } catch (error) {
    console.error('GET /api/admin/stats error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Check various system health indicators
 */
async function checkSystemHealth() {
  const checks: Record<string, { status: 'healthy' | 'degraded' | 'down'; latency?: number }> = {};

  // Database health check
  const dbStart = Date.now();
  try {
    await sql`SELECT 1`;
    checks.database = { status: 'healthy', latency: Date.now() - dbStart };
  } catch {
    checks.database = { status: 'down', latency: Date.now() - dbStart };
  }

  // Check AI provider status (via settings)
  try {
    const [setting] = await sql`
      SELECT value FROM app_settings WHERE key = 'ai_provider' LIMIT 1
    `;
    checks.aiProvider = { status: setting ? 'healthy' : 'degraded' };
  } catch {
    checks.aiProvider = { status: 'degraded' };
  }

  // Check for any stalled jobs
  try {
    const [{ stalled }] = await sql`
      SELECT COUNT(*)::int AS stalled
      FROM jobs
      WHERE status = 'processing'
        AND started_at < now() - interval '30 minutes'
    `;
    checks.jobQueue = { status: Number(stalled) > 0 ? 'degraded' : 'healthy' };
  } catch {
    checks.jobQueue = { status: 'healthy' }; // Assume healthy if jobs table doesn't exist
  }

  // Calculate overall status
  const statuses = Object.values(checks).map((c) => c.status);
  const overallStatus = statuses.includes('down')
    ? 'down'
    : statuses.includes('degraded')
    ? 'degraded'
    : 'healthy';

  return {
    status: overallStatus,
    checks,
    checkedAt: new Date().toISOString(),
  };
}
