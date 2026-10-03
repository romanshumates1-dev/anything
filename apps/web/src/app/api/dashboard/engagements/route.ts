/**
 * Dashboard Engagements API - GET recent responses and engagement
 *
 * Thin wrapper around the shared slice so this endpoint and
 * `GET /api/dashboard/summary` cannot drift apart. The query, the org scoping
 * and the corrected field mapping (see the slice's defect note) live in
 * `utils/dashboardSlices.ts`.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { getDashboardEngagements } from '@/app/api/utils/dashboardSlices';

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
    return NextResponse.json(await getDashboardEngagements(org.id));
  } catch (error: any) {
    console.error('GET /api/dashboard/engagements error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
