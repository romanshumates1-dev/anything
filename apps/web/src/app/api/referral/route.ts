import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

/**
 * GET /api/referral — list partners + recent handoffs.
 * POST /api/referral — create a partner or log a handoff.
 *
 * Phase 9: referral-out monetization.
 * Retail-intent signals (classified as REFERRAL by the AI) route here.
 * Owner manually marks "closed, fee received" to update the debrief ledger.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const [partners, handoffs] = await Promise.all([
    sql`
      SELECT * FROM referral_partners
      WHERE organization_id = ${organization.id}
      ORDER BY name ASC
    `,
    sql`
      SELECT rh.*, rp.name as partner_name, l.name as lead_name, l.phone as lead_phone
      FROM referral_handoffs rh
      LEFT JOIN referral_partners rp ON rp.id = rh.partner_id
      LEFT JOIN leads l ON l.id = rh.lead_id
      WHERE rh.organization_id = ${organization.id}
      ORDER BY rh.created_at DESC
      LIMIT 50
    `,
  ]);

  return Response.json({ partners, handoffs });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as any;

  // Create a referral partner
  if (body.action === 'create_partner') {
    const { name, contact, serviceAreas, referralFeePct, notes } = body;
    if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

    const [partner] = await sql`
      INSERT INTO referral_partners
        (organization_id, name, contact, service_areas, referral_fee_pct, notes)
      VALUES
        (${organization.id}, ${name}, ${contact ?? null},
         ${serviceAreas ?? []}, ${referralFeePct ?? 25}, ${notes ?? null})
      RETURNING id, name
    `;
    return Response.json({ partner }, { status: 201 });
  }

  // Log a referral handoff
  if (body.action === 'handoff') {
    const { leadId, partnerId, notes } = body;
    if (!leadId || !partnerId) {
      return Response.json({ error: 'leadId and partnerId are required' }, { status: 400 });
    }

    // Verify lead belongs to this org
    const [lead] = await sql`
      SELECT id FROM leads WHERE id = ${Number(leadId)} AND organization_id = ${organization.id} LIMIT 1
    `;
    if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });

    const [handoff] = await sql`
      INSERT INTO referral_handoffs
        (organization_id, lead_id, partner_id, status, notes)
      VALUES
        (${organization.id}, ${Number(leadId)}, ${Number(partnerId)}, 'sent', ${notes ?? null})
      RETURNING id
    `;

    // Update contract origination_type if a contract exists for this lead
    await sql`
      UPDATE contracts SET origination_type = 'REFERRAL_OUT', updated_at = now()
      WHERE organization_id = ${organization.id}
        AND seller_lead_id = ${Number(leadId)}
        AND origination_type = 'OWN_ORIGINATED'
    `.catch(() => {});

    await logEvent('referral_handoff_created', 'lead', String(leadId), {
      partnerId, handoffId: handoff.id,
    }, organization.id);

    return Response.json({ handoffId: handoff.id }, { status: 201 });
  }

  // Mark a handoff as closed with fee received
  if (body.action === 'close') {
    const { handoffId, feeReceivedCents } = body;
    if (!handoffId) return Response.json({ error: 'handoffId is required' }, { status: 400 });

    await sql`
      UPDATE referral_handoffs
      SET status = 'fee_received', fee_received_cents = ${feeReceivedCents ?? null},
          closed_at = now(), updated_at = now()
      WHERE id = ${Number(handoffId)} AND organization_id = ${organization.id}
    `;

    return Response.json({ ok: true });
  }

  return Response.json({ error: 'unknown action' }, { status: 400 });
}
