import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';

/**
 * Contracts list for the /contracts page (session-authed, org-scoped).
 *
 * Phase P1: includes esign_status and esign_events for the signing timeline.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }
    const org = organization.id;
    const rows = await sql`
      SELECT id, direction, status, signed_at, created_at,
             inspection_days, assigned_at, esign_status
      FROM contracts
      WHERE organization_id = ${org}
      ORDER BY created_at DESC
      LIMIT 100
    `;

    // Fetch esign events for each contract (batched)
    if (rows.length > 0) {
      const contractIds = rows.map((r: any) => r.id);
      const events = await sql`
        SELECT id, contract_id, event_type, event_data, created_at
        FROM esign_events
        WHERE contract_id = ANY(${contractIds}::text[])
        ORDER BY created_at ASC
      `;

      // Attach events to their contracts
      const eventsByContract: Record<string, any[]> = {};
      for (const evt of events) {
        if (!eventsByContract[evt.contract_id]) eventsByContract[evt.contract_id] = [];
        eventsByContract[evt.contract_id].push(evt);
      }

      for (const row of rows) {
        (row as any).esign_events = eventsByContract[row.id] || [];
      }
    }

    return Response.json(rows);
  } catch (error: any) {
    console.error('GET /api/contracts error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
