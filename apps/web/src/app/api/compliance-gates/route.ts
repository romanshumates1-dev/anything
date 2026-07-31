import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import {
  upsertComplianceGate,
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
} from '@/app/api/utils/complianceGate';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/compliance-gates — list all gates for the org.
 * POST /api/compliance-gates — upsert a gate (admin).
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const gates = await sql`
    SELECT * FROM compliance_gates
    WHERE organization_id = ${organization.id}
    ORDER BY jurisdiction, channel
  `;

  const killActive = await isKillSwitchActive(organization.id);

  return Response.json({ gates, killSwitchActive: killActive });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as any;

  // Kill-switch actions
  if (body.action === 'kill') {
    await activateKillSwitch(organization.id, body.reason || 'manual', admin.userId || 'admin');
    return Response.json({ killSwitchActive: true });
  }
  if (body.action === 'restore') {
    await deactivateKillSwitch(organization.id, admin.userId || 'admin');
    return Response.json({ killSwitchActive: false });
  }

  // Gate upsert
  const { jurisdiction, channel, attorneyReviewed, reviewedDate, reviewedBy, sourceTermsConfirmed, notes } = body;
  if (!jurisdiction || !channel) {
    return Response.json({ error: 'jurisdiction and channel are required' }, { status: 400 });
  }

  await upsertComplianceGate({
    organizationId: organization.id,
    jurisdiction,
    channel,
    attorneyReviewed: Boolean(attorneyReviewed),
    reviewedDate: reviewedDate ?? null,
    reviewedBy: reviewedBy ?? null,
    sourceTermsConfirmed: Boolean(sourceTermsConfirmed),
    notes: notes ?? null,
  });

  return Response.json({ ok: true, jurisdiction, channel, attorneyReviewed: Boolean(attorneyReviewed) });
}
