import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../../../utils/logger';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
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

    const [campaign] = await sql`SELECT id FROM campaigns WHERE id = ${campaignId} LIMIT 1`;
    if (!campaign) {
      return Response.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const inserted = [];
    for (const leadId of leadIds) {
      const rows = await sql`
        INSERT INTO campaign_leads (campaign_id, lead_id)
        VALUES (${campaignId}, ${leadId})
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

  try {
    const { id } = await params;
    const campaignId = Number(id);
    if (!Number.isInteger(campaignId)) {
      return Response.json({ error: 'Invalid campaign id' }, { status: 400 });
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
