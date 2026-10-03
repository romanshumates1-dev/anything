/**
 * Dashboard activity feed.
 *
 * Thin wrapper around the shared slice so this endpoint and
 * `GET /api/dashboard/summary` cannot drift apart. The queries (all rewritten
 * 2026-09-29 against the real schema, defect #46), their org scoping and the
 * per-source logFallback behaviour live in `utils/dashboardSlices.ts`.
 */
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { getDashboardActivity } from '@/app/api/utils/dashboardSlices';

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  try {
    return Response.json(await getDashboardActivity(org.id, limit));
  } catch (error: any) {
    // A failure that reaches here is NOT one of the per-source fallbacks above;
    // answering 200 with [] would be the defect #46 lie again.
    console.error('GET /api/dashboard/activity error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
