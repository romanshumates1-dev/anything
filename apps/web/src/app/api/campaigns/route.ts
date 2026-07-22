import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../utils/logger';
import { getOrganization } from '@/lib/organization-context';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tenant-isolation fix (legacy campaigns/campaign_leads had no
  // organization_id at all — see migration 042): every campaign must be
  // stamped with its creator's organization from the moment it's created.
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const template = typeof body.message_template === 'string' ? body.message_template.trim() : '';

    if (!name || !template) {
      return Response.json({ error: 'Name and message_template are required' }, { status: 400 });
    }

    const [campaign] = await sql`
      INSERT INTO campaigns (name, message_template, organization_id)
      VALUES (${name}, ${template}, ${organization.id})
      RETURNING *
    `;

    await logEvent(
      'campaign_created',
      'campaign',
      campaign.id.toString(),
      { name },
      session.user.id
    );

    return Response.json(campaign);
  } catch (error: any) {
    console.error('POST /api/campaigns error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Tenant-isolation fix: this route previously returned every org's
  // campaigns with no filtering at all.
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const campaigns = await sql`
      SELECT
        c.*,
        COUNT(cl.id) AS member_count,
        COUNT(cl.id) FILTER (WHERE cl.status = 'sent') AS sent_count
      FROM campaigns c
      LEFT JOIN campaign_leads cl ON cl.campaign_id = c.id
      WHERE c.organization_id = ${organization.id}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT 100
    `;
    return Response.json(campaigns);
  } catch (error: any) {
    console.error('GET /api/campaigns error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
