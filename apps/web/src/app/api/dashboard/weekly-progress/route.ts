/**
 * Weekly progress summary.
 *
 * Thin wrapper around the shared slice so this endpoint and
 * `GET /api/dashboard/summary` cannot drift apart. The queries (all rewritten
 * 2026-09-29 against the real schema, defect #47), their org scoping and the
 * per-counter logFallback behaviour live in `utils/dashboardSlices.ts`.
 */
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { getDashboardWeeklyProgress } from '@/app/api/utils/dashboardSlices';

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
    return Response.json(await getDashboardWeeklyProgress(org.id));
  } catch (error: any) {
    // Failures reaching here are not covered by the per-counter fallbacks;
    // a 200 full of zeros would be the defect #47 lie again.
    console.error('GET /api/dashboard/weekly-progress error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
