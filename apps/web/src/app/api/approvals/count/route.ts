import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * Pending-approvals count for the sidebar badge (session-authed, org-scoped).
 *
 * The Shell polls GET /api/approvals/count expecting `{ count }`. Before this
 * route existed the request fell through to /api/approvals/[id] (id="count"),
 * which only handles POST → every authenticated page logged a 405. This static
 * segment resolves before the dynamic [id] segment, so the badge now works.
 *
 * Count = pending owner-range requests + pending human approvals (the two
 * queues surfaced on /approvals).
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const org = (session.user as any).organizationId || 'default';
    const [{ count }] = await sql`
      SELECT (
        (SELECT COUNT(*) FROM owner_range_requests WHERE organization_id = ${org} AND status = 'PENDING')
        + (SELECT COUNT(*) FROM human_approvals WHERE organization_id = ${org} AND status = 'PENDING')
      ) AS count
    `;
    return Response.json({ count: Number(count) });
  } catch (error: any) {
    console.error('GET /api/approvals/count error', error);
    return Response.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}
