import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getRollingP95 } from '@/app/api/utils/sla';

const START_TIME = Date.now();

export async function GET() {
  // AI/SMS/error aggregates are admin-only. This route sits in the middleware's
  // /api/system exemption, so it must gate itself.
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const [aiAgg] = await sql`
      SELECT count(*)::int AS total
      FROM audit_logs
      WHERE action LIKE 'ai_%'
    `;

    const [smsAgg] = await sql`
      SELECT
        count(*) FILTER (WHERE action = 'message_sent') AS sent,
        count(*) FILTER (WHERE action = 'message_failed') AS failed
      FROM audit_logs
    `;

    const [errorAgg] = await sql`
      SELECT count(*)::int AS total
      FROM audit_logs
      WHERE action LIKE '%error%' OR action LIKE '%failed%'
    `;

    // INT-1: rolling P95 latency (reply_received → ai_dispatched)
    const p95 = await getRollingP95();

    return Response.json({
      aiCalls: parseInt(aiAgg?.total || '0', 10),
      smsSent: parseInt(smsAgg?.sent || '0', 10),
      smsFailed: parseInt(smsAgg?.failed || '0', 10),
      errors: parseInt(errorAgg?.total || '0', 10),
      uptimeSec: Math.floor((Date.now() - START_TIME) / 1000),
      // INT-1: environment-agnostic SLA metrics (null when no data = honest, not hidden)
      sla: p95 ?? { p95Ms: null, completed: 0, pending: 0, latestInbound: null, computedAt: null },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return Response.json({
      error: error?.message || 'unknown',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}
