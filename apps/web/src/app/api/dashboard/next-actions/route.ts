/**
 * Dashboard Next Actions API - GET prioritized action items
 *
 * Thin wrapper around the shared slice so this endpoint and
 * `GET /api/dashboard/summary` cannot drift apart. The queries, the org scoping
 * and the defect history (contracts: defect #45) live in
 * `utils/dashboardSlices.ts`.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { getDashboardNextActions } from '@/app/api/utils/dashboardSlices';

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
    return NextResponse.json(await getDashboardNextActions(org.id));
  } catch (error: any) {
    console.error('GET /api/dashboard/next-actions error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
