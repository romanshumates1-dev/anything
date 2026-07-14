import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * App-facing approvals queue (session-authed, org-scoped).
 *
 * Ghost-feature note (verification sprint 2026-07): the /approvals page shipped
 * calling /api/approvals + /api/approvals/[id], neither of which existed. This
 * is the money queue — every owner-range reply and contract approval routes
 * through it. Returns a bare array (the page expects that shape), unioning:
 *   - owner_range_requests  -> type 'owner_range' with {address, ai_min, ai_max}
 *   - human_approvals       -> contract/other approvals as-is
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = (session.user as any).organizationId || 'default';

    const ranges = await sql`
      SELECT id, negotiation_id, direction, property_context, status, requested_at
      FROM owner_range_requests
      WHERE organization_id = ${org}
      ORDER BY requested_at DESC
      LIMIT 100
    `;
    const contracts = await sql`
      SELECT id, type, negotiation_id, contract_id, context, status, created_at
      FROM human_approvals
      WHERE organization_id = ${org}
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const mappedRanges = ranges.map((r: any) => ({
      id: r.id,
      type: 'owner_range',
      negotiation_id: r.negotiation_id,
      status: r.status,
      context: {
        address: r.property_context?.address ?? null,
        ai_min: r.property_context?.ai_min ?? null,
        ai_max: r.property_context?.ai_max ?? null,
      },
      created_at: r.requested_at,
    }));
    const mappedContracts = contracts.map((c: any) => ({
      id: c.id,
      type: c.type,
      negotiation_id: c.negotiation_id,
      contract_id: c.contract_id,
      status: c.status,
      context: c.context ?? {},
      created_at: c.created_at,
    }));

    const combined = [...mappedRanges, ...mappedContracts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return Response.json(combined);
  } catch (error: any) {
    console.error('GET /api/approvals error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
