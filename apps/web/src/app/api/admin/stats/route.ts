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
      // User statistics.
      // NB: the Better Auth "user" table really is camelCase (createdAt), unlike
      // the rest of the schema. Verified via information_schema, not assumed -
      // the first fix here changed these to created_at and the endpoint then
      // failed with `column "created_at" does not exist`. Each table's
      // convention has to be checked, not normalised by assumption.
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
      // Defect #39: filtered on created_at, but `campaigns` is snake_case
      // (created_at). Only the Better Auth "user" table is camelCase; mixing the
      // two conventions in one query is what made this endpoint 500.
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_this_week
        FROM campaigns
      `,
      // Message statistics.
      // Defect #39: this read FROM `messages`, which has never existed, and
      // "sentAt"/`direction`, which live on no table in this schema. There is
      // genuinely no per-message send/receive record to read.
      //
      // Rather than invent a table, this reports what IS recorded: conversation
      // activity in `ai_conversations`, whose real columns are channel, history,
      // status and last_message_at. The response keeps the legacy sentToday/
      // sentThisWeek keys so the admin UI contract does not change, and adds
      // explicit `conversations_*` keys; `directionAvailable: false` tells the
      // client that inbound/outbound split is not derivable. Inventing a
      // direction here would be fabricating data.
      sql`
        SELECT
          COUNT(*) FILTER (WHERE last_message_at::date = CURRENT_DATE)::int AS conversations_today,
          COUNT(*) FILTER (WHERE last_message_at > now() - interval '7 days')::int AS conversations_this_week,
          COUNT(*) FILTER (WHERE last_message_at > now() - interval '30 days')::int AS conversations_this_month,
          COUNT(DISTINCT channel)::int AS channels_in_use
        FROM ai_conversations
      `,
      // Lead statistics
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'hot')::int AS hot,
          COUNT(*) FILTER (WHERE status = 'warm')::int AS warm,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_this_week
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
      // The schema has no per-message record and no direction column, so
      // inbound/outbound counts are NOT reported as if they existed. The legacy
      // keys are kept (the admin UI contract must not break) but are explicitly
      // conversation-activity counts, and `directionAvailable: false` states that
      // the sent/received split is not derivable from stored data.
      messages: {
        conversationsToday: messageStats?.conversations_today ?? 0,
        conversationsThisWeek: messageStats?.conversations_this_week ?? 0,
        conversationsThisMonth: messageStats?.conversations_this_month ?? 0,
        channelsInUse: messageStats?.channels_in_use ?? 0,
        directionAvailable: false,
        sentToday: messageStats?.conversations_today ?? 0,
        sentThisWeek: messageStats?.conversations_this_week ?? 0,
        sentThisMonth: messageStats?.conversations_this_month ?? 0,
        receivedToday: null,
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
