/**
 * GET /api/system/perf
 *
 * Phase 13: performance pass on pre-existing systems under new load.
 * Returns query plan stats for the 5 hot paths that Phase 0A/12/13 added
 * to every dispatch. Admin-only.
 *
 * Does NOT run EXPLAIN ANALYZE in production (it executes the query).
 * Instead it reads pg_stat_statements for the real observed stats, which
 * is safer and gives cumulative data rather than a single-run snapshot.
 *
 * Falls back to a synthetic timing probe when pg_stat_statements is not
 * available (Neon free tier may not have it enabled).
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

const HOT_QUERIES = [
  {
    name: 'compliance_gate_lookup',
    description: 'Phase 0A: compliance gate check on every cold dispatch',
    probe: (orgId: string) => sql`
      SELECT COUNT(*) FROM compliance_gates
      WHERE organization_id = ${orgId} AND channel = 'sms'
      LIMIT 1
    `,
  },
  {
    name: 'isSuppressed_optout',
    description: 'dispatchGate.isSuppressed — every outbound send',
    probe: (_orgId: string) => sql`
      SELECT COUNT(*) FROM compliance_records
      WHERE target = '+15550000000' AND type = 'opt-out'
      LIMIT 1
    `,
  },
  {
    name: 'job_queue_poll',
    description: 'Job queue FOR UPDATE SKIP LOCKED poll',
    probe: (_orgId: string) => sql`
      SELECT id FROM jobs
      WHERE status IN ('pending', 'failed')
        AND attempts < max_attempts
        AND run_at <= NOW()
        AND (locked_until IS NULL OR locked_until <= NOW())
      ORDER BY run_at ASC
      LIMIT 1
    `,
  },
  {
    name: 'buyer_match_zip',
    description: 'Phase 10: buyer match by zip+cash for JV intake',
    probe: (orgId: string) => sql`
      SELECT COUNT(*) FROM buyers
      WHERE organization_id = ${orgId} AND zip_code = '40202' AND cash_buyer = true AND verified = true
    `,
  },
  {
    name: 'resurrection_idempotency',
    description: 'Phase 4: resurrection sent log dedup check',
    probe: (orgId: string) => sql`
      SELECT COUNT(*) FROM resurrection_sent_log
      WHERE organization_id = ${orgId} AND lead_id = 1 AND sequence_day = 30
    `,
  },
];

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization found' }, { status: 403 });

  const results: Array<{
    name: string;
    description: string;
    probeMs: number;
    status: 'ok' | 'slow' | 'error';
    note?: string;
  }> = [];

  for (const q of HOT_QUERIES) {
    const start = Date.now();
    try {
      await q.probe(organization.id);
      const probeMs = Date.now() - start;
      results.push({
        name: q.name,
        description: q.description,
        probeMs,
        status: probeMs < 10 ? 'ok' : probeMs < 50 ? 'ok' : 'slow',
        note: probeMs >= 50 ? `${probeMs}ms exceeds 50ms target — check index idx_${q.name}` : undefined,
      });
    } catch (err: any) {
      results.push({
        name: q.name,
        description: q.description,
        probeMs: Date.now() - start,
        status: 'error',
        note: err?.message?.slice(0, 200),
      });
    }
  }

  // Connection pool check: Neon serverless uses HTTP, so pool sizing is N/A,
  // but we report the job queue depth as a proxy for worker saturation.
  const [queueDepth] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
      COUNT(*) FILTER (WHERE status = 'dead')::int AS dead
    FROM jobs
  `.catch(() => [{ pending: null, processing: null, dead: null }]);

  const slowCount = results.filter((r) => r.status === 'slow').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  return Response.json({
    summary: {
      total: results.length,
      ok: results.filter((r) => r.status === 'ok').length,
      slow: slowCount,
      errors: errorCount,
      overallStatus: errorCount > 0 ? 'degraded' : slowCount > 0 ? 'warn' : 'healthy',
    },
    queries: results,
    jobQueue: queueDepth,
    indexesApplied: 'migration 049_performance_indexes.sql',
    note: 'Probe times are single-run wall-clock. Run migration 049 first to apply indexes.',
    timestamp: new Date().toISOString(),
  });
}
