import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

/**
 * In-app Event Log (admin) — newest first, filterable by integration.
 *
 * Reads the EXISTING `audit_logs` (written by logEvent) so integrations get
 * visibility for free: flip a beta flag → act → watch the log. No console-digging.
 *
 * Phone numbers in payloads are MASKED here (Phase 5 rule: never surface raw
 * numbers), and the payload is size-capped so one huge row can't wreck the panel.
 */
const INTEGRATION_PREFIX: Record<string, string> = {
  speedToLead: 'speed_to_lead',
  voiceEscalation: 'voice_',
  localPresence: 'number_pool',
  cadenceEngine: 'cadence_',
};

/** +15025550123 → +1502***0123 ; leaves short/non-phone strings alone. */
function maskPhones(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/(\+?\d{1,2}?\d{3})(\d{3})(\d{4})/g, (_m, a, _b, d) => `${a}***${d}`);
  }
  if (Array.isArray(value)) return value.map(maskPhones);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskPhones(v);
    return out;
  }
  return value;
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const url = new URL(request.url);
    const integration = url.searchParams.get('integration');
    const limit = Math.min(200, Number(url.searchParams.get('limit') || 50) || 50);
    const prefix = integration ? INTEGRATION_PREFIX[integration] : null;

    const rows = await sql`
      SELECT id, action, target_type, target_id, payload, created_at
      FROM audit_logs
      WHERE (${prefix}::text IS NULL OR action LIKE ${prefix ? prefix + '%' : null})
      ORDER BY id DESC
      LIMIT ${limit}
    `;

    const events = (rows as any[]).map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      payload: maskPhones(r.payload),
      createdAt: r.created_at,
    }));

    return Response.json({ events, integrations: Object.keys(INTEGRATION_PREFIX) });
  } catch (error: any) {
    console.error('GET /api/system/event-log error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
