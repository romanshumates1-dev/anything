import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { getDashboardStats } from '@/app/api/utils/dashboardSlices';

/**
 * GET /api/dashboard/stats — thin wrapper around the shared slice so this
 * endpoint and `GET /api/dashboard/summary` can never drift apart. See
 * `utils/dashboardSlices.ts` for the queries and their history (defect #43).
 */
export async function GET() {
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

  try {
    return Response.json(await getDashboardStats(org.id));
  } catch (error: any) {
    console.error('GET /api/dashboard/stats error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
