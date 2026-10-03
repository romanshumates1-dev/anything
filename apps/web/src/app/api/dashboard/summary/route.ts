/**
 * GET /api/dashboard/summary — every dashboard card payload in ONE invocation.
 *
 * WHY (measured 2026-10-03): the dashboard is a client component whose cost is
 * the sum of its fetches. Ten separate card endpoints meant ten Worker
 * invocations, each with its own cold start and round trip, for one page.
 * `wrangler tail` measured the slices at 13-23ms CPU each, so the ~9.4s page was
 * round-trip COUNT, not query cost. This endpoint runs the same slices
 * concurrently — same SQL, same shapes, same org scoping — and returns them
 * together.
 *
 * A failing slice is omitted from the payload (and named in `errors`); the card
 * that reads it then falls back to its own endpoint. Partial failure degrades one
 * card, never the page.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { buildDashboardSummary } from '@/app/api/utils/dashboardSlices';

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
    const payload = await buildDashboardSummary(org.id);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error('GET /api/dashboard/summary error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
