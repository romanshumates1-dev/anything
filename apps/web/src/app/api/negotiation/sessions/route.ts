import { requireAdmin } from '@/app/api/utils/authz';
import sql from '@/app/api/utils/sql';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { startSession } from '@/app/api/utils/negotiationSession';

/**
 * Phase A — bounded-negotiation sessions (admin, flag-gated).
 * POST start: ALL preconditions enforced server-side (flag + owner-approved
 * range + assignability/thin-override confirmed by the caller's approval id).
 * GET: sessions for a lead (?leadId=) — powers the timeline UI.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!(await isBetaFlagOn('boundedNegotiation'))) {
    return Response.json({ error: 'boundedNegotiation flag is off' }, { status: 403 });
  }
  const leadId = new URL(request.url).searchParams.get('leadId');
  if (!leadId) return Response.json({ error: 'leadId required' }, { status: 400 });
  const sessions = await sql`
    SELECT * FROM negotiation_sessions WHERE lead_id = ${Number(leadId)} ORDER BY created_at DESC LIMIT 20
  `;
  return Response.json({ sessions });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;

  // Owner approval: the caller must reference a real APPROVED owner_range_requests
  // row for this lead — the range the owner actually granted.
  const approvalId = typeof body.approvalId === 'string' ? body.approvalId : null;
  let ownerApproved = false;
  let approvedMinCents = 0;
  let approvedMaxCents = 0;
  if (approvalId) {
    const [appr] = await sql`
      SELECT * FROM owner_range_requests WHERE id = ${approvalId} AND status = 'ANSWERED'
    `;
    if (appr?.min_price != null && appr?.max_price != null) {
      ownerApproved = true;
      approvedMinCents = Math.round(Number(appr.min_price) * 100);
      approvedMaxCents = Math.round(Number(appr.max_price) * 100);
    }
  }

  const side = body.side === 'buyer' ? 'buyer' : 'seller';
  const result = await startSession({
    organizationId: admin.userId,
    leadId: Number(body.leadId),
    side,
    openerCents: Number(body.openerCents),
    clampCents: side === 'seller' ? approvedMaxCents : approvedMinCents,
    approvedMinCents,
    approvedMaxCents,
    ownerApproved,
    contractId: typeof body.contractId === 'string' ? body.contractId : undefined,
  });
  if ('error' in result) return Response.json(result, { status: 400 });
  return Response.json(result, { status: 201 });
}
