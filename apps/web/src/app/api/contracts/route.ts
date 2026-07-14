import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * Contracts list for the /contracts page (session-authed, org-scoped).
 *
 * The page shipped calling GET /api/contracts, which did not exist → 404 on
 * every visit. The `contracts` table exists (migration/base schema); this
 * returns a bare array in the shape the page maps over: { id, direction,
 * status, created_at, signed_at }.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = (session.user as any).organizationId || 'default';
    const rows = await sql`
      SELECT id, direction, status, signed_at, created_at
      FROM contracts
      WHERE organization_id = ${org}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return Response.json(rows);
  } catch (error: any) {
    console.error('GET /api/contracts error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
