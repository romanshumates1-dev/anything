import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../../../utils/logger';
import { getOrganization } from '@/lib/organization-context';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tenant-isolation fix (legacy campaigns/campaign_leads had no
  // organization_id at all — see migration 042).
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const campaignId = Number(id);
    if (!Number.isInteger(campaignId)) {
      return Response.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    const body = await request.json();
    // Accept a single leadId or an array of leadIds.
    const rawIds = Array.isArray(body.leadIds)
      ? body.leadIds
      : body.leadId != null
        ? [body.leadId]
        : [];
    const leadIds = rawIds.map((v: any) => Number(v)).filter((n: number) => Number.isInteger(n));

    if (leadIds.length === 0) {
      return Response.json({ error: 'leadId or leadIds is required' }, { status: 400 });
    }

    // IDOR fix: previously this had no organization filter at all, so any
    // authenticated user could add leads to another org's campaign just by
    // guessing its id. A foreign-org id now 404s exactly as if it didn't exist.
    const [campaign] = await sql`
      SELECT id FROM campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
      LIMIT 1
    `;
    if (!campaign) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const inserted = [];
    for (const leadId of leadIds) {
      const rows = await sql`
        INSERT INTO campaign_leads (campaign_id, lead_id, organization_id)
        VALUES (${campaignId}, ${leadId}, ${organization.id})
        ON CONFLICT (campaign_id, lead_id) DO NOTHING
        RETURNING *
      `;
      if (rows[0]) inserted.push(rows[0]);
    }

    await logEvent(
      'campaign_leads_added',
      'campaign',
      campaignId.toString(),
      { requested: leadIds.length, added: inserted.length },
      session.user.id
    );

    return Response.json({ added: inserted.length, members: inserted });
  } catch (error: any) {
    console.error('POST /api/campaigns/[id]/leads error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tenant-isolation fix (legacy campaigns/campaign_leads had no
  // organization_id at all — see migration 042).
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const campaignId = Number(id);
    if (!Number.isInteger(campaignId)) {
      return Response.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    // IDOR fix: previously this ran the join below for ANY campaign_id with
    // no ownership check at all — any authenticated user could read another
    // org's full lead roster (name/phone/email) just by guessing an id.
    const [campaign] = await sql`
      SELECT id FROM campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
      LIMIT 1
    `;
    if (!campaign) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const members = await sql`
      SELECT cl.id, cl.status, cl.created_at,
             l.id AS lead_id, l.name, l.type, l.phone, l.email
      FROM campaign_leads cl
      JOIN leads l ON l.id = cl.lead_id
      WHERE cl.campaign_id = ${campaignId}
      ORDER BY cl.created_at DESC
    `;
    return Response.json(members);
  } catch (error: any) {
    console.error('GET /api/campaigns/[id]/leads error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
