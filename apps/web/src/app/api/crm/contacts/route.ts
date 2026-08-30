import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

/**
 * CRM contact list (session-authed, org-scoped). A filterable view over the
 * EXISTING campaign_contacts data — no new lead system. Supports optional
 * ?status=, ?campaignId=, ?q= (name/phone search) filters and returns the
 * campaign names + status set so the UI can build filter dropdowns.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }
    const org = organization.id;
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || '';
    const campaignId = url.searchParams.get('campaignId') || '';
    const q = (url.searchParams.get('q') || '').trim();
    const like = `%${q}%`;

    const rows = await sql`
      SELECT cc.id, cc.name, cc.phone, cc.status::text AS status, cc.campaign_id,
             oc.name AS campaign_name,
             cc.last_message_at, cc.last_reply_at, cc.opted_out_at, cc.follow_ups_sent, cc.created_at
      FROM campaign_contacts cc
      LEFT JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
      WHERE cc.organization_id = ${org}
        AND (${status} = '' OR cc.status::text = ${status})
        AND (${campaignId} = '' OR cc.campaign_id = ${campaignId})
        AND (${q} = '' OR cc.name ILIKE ${like} OR cc.phone ILIKE ${like})
      ORDER BY COALESCE(cc.last_message_at, cc.created_at) DESC NULLS LAST
      LIMIT 500
    `;
    const statuses = await sql`
      SELECT DISTINCT status::text AS status FROM campaign_contacts WHERE organization_id = ${org} ORDER BY 1
    `;
    const campaigns = await sql`
      SELECT id, name FROM outreach_campaigns WHERE organization_id = ${org} ORDER BY created_at DESC LIMIT 100
    `;

    return Response.json({
      contacts: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        status: r.status,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        followUpsSent: r.follow_ups_sent,
        lastMessageAt: r.last_message_at,
        lastReplyAt: r.last_reply_at,
        optedOutAt: r.opted_out_at,
        createdAt: r.created_at,
      })),
      statuses: statuses.map((s: any) => s.status),
      campaigns: campaigns.map((c: any) => ({ id: c.id, name: c.name })),
    });
  } catch (error: any) {
    console.error('GET /api/crm/contacts error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
