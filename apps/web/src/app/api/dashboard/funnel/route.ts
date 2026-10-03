/**
 * Dashboard Funnel API - GET lead funnel statistics
 *
 * Thin wrapper around the shared slice so this endpoint and
 * `GET /api/dashboard/summary` cannot drift apart. The queries, the org scoping
 * and the defect history (defects #37/#44) live in `utils/dashboardSlices.ts`.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { getDashboardFunnel } from '@/app/api/utils/dashboardSlices';

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    return NextResponse.json(await getDashboardFunnel(org.id));
  } catch (error: any) {
    console.error('GET /api/dashboard/funnel error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
