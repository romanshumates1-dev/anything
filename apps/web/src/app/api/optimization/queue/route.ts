import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/optimization/queue
 * Query: ?limit=50
 *
 * Returns prioritized action queue (pending actions sorted by priority DESC)
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));

    const actions = await sql`
      SELECT
        la.id,
        la.lead_id,
        la.action,
        la.priority,
        la.reason,
        la.created_at,
        l.name,
        l.phone,
        l.metadata->>'address' as address
      FROM lead_actions la
      JOIN leads l ON l.id = la.lead_id
      WHERE l.organization_id = ${organization.id}
        AND la.status = 'pending'
      ORDER BY la.priority DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      actions: actions.map(a => ({
        id: a.id,
        leadId: a.lead_id,
        leadName: a.name,
        address: a.address,
        action: a.action,
        priority: Number(a.priority),
        reason: a.reason,
        createdAt: a.created_at
      })),
      count: actions.length
    });
  } catch (error: any) {
    console.error('GET /api/optimization/queue error', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
