import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

/**
 * CSV export for leads (session-authed, org-scoped). Same data as /api/crm/contacts
 * but returns a downloadable CSV file. The export is server-side so it can stream
 * large datasets without client memory constraints.
 */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    // Return JSON error for API consumers, not redirect
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

    // Use the same query as contacts list for consistency
    const rows = await sql`
      SELECT cc.id, cc.name, cc.phone, cc.status::text AS status,
             oc.name AS campaign_name, cc.follow_ups_sent, cc.last_message_at,
             cc.last_reply_at, cc.opted_out_at, cc.created_at
      FROM campaign_contacts cc
      LEFT JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
      WHERE cc.organization_id = ${org}
        AND (${status} = '' OR cc.status::text = ${status})
        AND (${campaignId} = '' OR cc.campaign_id = ${campaignId})
        AND (${q} = '' OR cc.name ILIKE ${like} OR cc.phone ILIKE ${like})
      ORDER BY COALESCE(cc.last_message_at, cc.created_at) DESC NULLS LAST
      LIMIT 10000
    `;

    // CSV header
    const header = [
      'id',
      'name',
      'phone',
      'status',
      'campaign',
      'follow_ups_sent',
      'last_message_at',
      'last_reply_at',
      'opted_out_at',
      'created_at',
    ];

    // Escape CSV fields (quote if contains comma, quote, or newline)
    function csvEscape(value: string | null | undefined): string {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    // Build CSV content
    const csvRows = [
      header.join(','),
      ...rows.map((r: any) =>
        [
          csvEscape(r.id),
          csvEscape(r.name),
          csvEscape(r.phone),
          csvEscape(r.status),
          csvEscape(r.campaign_name),
          csvEscape(r.follow_ups_sent),
          csvEscape(r.last_message_at),
          csvEscape(r.last_reply_at),
          csvEscape(r.opted_out_at),
          csvEscape(r.created_at),
        ].join(',')
      ),
    ];

    const csvContent = csvRows.join('\n');
    const filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: any) {
    console.error('GET /api/leads/export error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}