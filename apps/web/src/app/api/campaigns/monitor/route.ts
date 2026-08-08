/**
 * GET /api/campaigns/monitor
 *
 * Real-time campaign monitoring data for the dashboard.
 * Returns job stats, queue status, email metrics, quality gates, and health status.
 */
import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return Response.json({ error: 'DATABASE_URL not configured' }, { status: 500 });
    }

    const sql = neon(process.env.DATABASE_URL);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Run all queries in parallel for speed
    const [
      jobStats,
      queueStats,
      emailStats,
      warmupConfig,
      recentErrors,
      hourlyVolume,
      regionalBreakdown,
      healthStatus,
    ] = await Promise.all([
      // Job status breakdown
      sql`
        SELECT
          status,
          COUNT(*)::int as count,
          COUNT(*) FILTER (WHERE type = 'execute_campaign_sends')::int as send_jobs,
          COUNT(*) FILTER (WHERE type = 'pipeline_health_check')::int as health_jobs,
          COUNT(*) FILTER (WHERE type LIKE '%email%')::int as email_jobs
        FROM jobs
        GROUP BY status
      `.catch(() => []),

      // Queue status
      sql`
        SELECT
          status,
          COUNT(*)::int as count,
          COALESCE(SUM(expected_value), 0)::bigint as total_value,
          COALESCE(AVG(touch_number), 0)::float as avg_touch
        FROM campaign_lead_queue
        GROUP BY status
      `.catch(() => []),

      // Email stats (today)
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'sent')::int as sent,
          COUNT(*) FILTER (WHERE status = 'delivered')::int as delivered,
          COUNT(*) FILTER (WHERE status = 'opened')::int as opened,
          COUNT(*) FILTER (WHERE status = 'clicked')::int as clicked,
          COUNT(*) FILTER (WHERE status = 'bounced')::int as bounced,
          COUNT(*) FILTER (WHERE status = 'complained')::int as complained,
          COUNT(*) FILTER (WHERE status = 'unsubscribed')::int as unsubscribed,
          COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
          COUNT(*)::int as total
        FROM message_events
        WHERE channel = 'email'
          AND direction = 'outbound'
          AND created_at >= ${todayStart.toISOString()}
      `.catch(() => [{ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0, failed: 0, total: 0 }]),

      // Warmup config
      sql`
        SELECT
          daily_limit,
          paused,
          paused_reason,
          updated_at
        FROM email_warmup_config
        LIMIT 1
      `.catch(() => []),

      // Recent errors (last 10)
      sql`
        SELECT
          id,
          type,
          error_message,
          attempts,
          max_attempts,
          updated_at
        FROM jobs
        WHERE status IN ('failed', 'dead')
        ORDER BY updated_at DESC
        LIMIT 10
      `.catch(() => []),

      // Hourly send volume (last 24h)
      sql`
        SELECT
          date_trunc('hour', created_at) as hour,
          COUNT(*)::int as count
        FROM message_events
        WHERE channel = 'email'
          AND direction = 'outbound'
          AND created_at > now() - interval '24 hours'
        GROUP BY date_trunc('hour', created_at)
        ORDER BY hour DESC
        LIMIT 24
      `.catch(() => []),

      // Regional breakdown (if metadata has state)
      sql`
        SELECT
          COALESCE(l.metadata->>'state', 'Unknown') as state,
          COUNT(*)::int as count,
          AVG(clq.expected_value)::bigint as avg_value
        FROM campaign_lead_queue clq
        JOIN leads l ON l.id = clq.lead_id
        WHERE clq.status IN ('queued', 'sent', 'completed')
        GROUP BY l.metadata->>'state'
        ORDER BY count DESC
        LIMIT 10
      `.catch(() => []),

      // Health engine status
      sql`
        SELECT
          type,
          status,
          payload,
          updated_at
        FROM jobs
        WHERE type = 'pipeline_health_check'
        ORDER BY updated_at DESC
        LIMIT 1
      `.catch(() => []),
    ]);

    // Calculate quality metrics
    const stats = emailStats[0] || { sent: 0, bounced: 0, complained: 0, unsubscribed: 0, total: 0 };
    const totalSent = stats.sent || 1;
    const qualityMetrics = {
      bounceRate: ((stats.bounced / totalSent) * 100).toFixed(2),
      complaintRate: ((stats.complained / totalSent) * 100).toFixed(3),
      unsubRate: ((stats.unsubscribed / totalSent) * 100).toFixed(2),
      deliveryRate: ((stats.delivered / totalSent) * 100).toFixed(1),
      openRate: stats.delivered > 0 ? ((stats.opened / stats.delivered) * 100).toFixed(1) : '0.0',
      clickRate: stats.opened > 0 ? ((stats.clicked / stats.opened) * 100).toFixed(1) : '0.0',
    };

    // Quality gate status
    const warmup = warmupConfig[0] || { daily_limit: 0, paused: false };
    const qualityGates = {
      bounce: { threshold: 5, current: parseFloat(qualityMetrics.bounceRate), status: parseFloat(qualityMetrics.bounceRate) < 5 ? 'ok' : 'warning' },
      complaint: { threshold: 0.1, current: parseFloat(qualityMetrics.complaintRate), status: parseFloat(qualityMetrics.complaintRate) < 0.1 ? 'ok' : 'warning' },
      unsub: { threshold: 2, current: parseFloat(qualityMetrics.unsubRate), status: parseFloat(qualityMetrics.unsubRate) < 2 ? 'ok' : 'warning' },
    };

    // Calculate totals
    const jobTotals = jobStats.reduce((acc: any, j: any) => {
      acc[j.status] = j.count;
      acc.total = (acc.total || 0) + j.count;
      return acc;
    }, {});

    const queueTotals = queueStats.reduce((acc: any, q: any) => {
      acc[q.status] = q.count;
      acc.total = (acc.total || 0) + q.count;
      return acc;
    }, {});

    return Response.json({
      timestamp: now.toISOString(),
      campaign: {
        status: warmup.paused ? 'PAUSED' : 'ACTIVE',
        dailyTarget: 150000,
        dailySent: stats.sent,
        progress: ((stats.sent / 150000) * 100).toFixed(1),
        feeRange: { min: 5000, max: 30000 },
      },
      jobs: {
        ...jobTotals,
        breakdown: jobStats,
      },
      queue: {
        ...queueTotals,
        breakdown: queueStats,
      },
      emails: {
        today: stats,
        quality: qualityMetrics,
        gates: qualityGates,
      },
      warmup: {
        dailyLimit: warmup.daily_limit,
        paused: warmup.paused,
        pausedReason: warmup.paused_reason,
        updatedAt: warmup.updated_at,
      },
      health: {
        lastCheck: healthStatus[0]?.updated_at || null,
        status: healthStatus[0]?.status || 'unknown',
        interval: 'exponential (1-2-4-8h)',
      },
      errors: recentErrors.map((e: any) => ({
        id: e.id,
        type: e.type,
        message: (e.error_message || '').slice(0, 100),
        attempts: `${e.attempts}/${e.max_attempts}`,
        when: e.updated_at,
      })),
      hourlyVolume: hourlyVolume,
      regional: regionalBreakdown,
    });
  } catch (error: any) {
    console.error('GET /api/campaigns/monitor error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
