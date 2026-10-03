/**
 * Credits API - GET balance and costs
 *
 * Returns the organization's current credit balance and
 * tier-specific costs for all actions.
 *
 * Thin wrapper around the shared credits slice, which the batched
 * `GET /api/dashboard/summary` also calls (one React Query key, one payload, so
 * the dashboard card and the inline header balance cannot disagree).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { getCredits, type CreditsPayload } from '@/app/api/utils/dashboardSlices';

/** Re-exported so components keep importing the response type from here. */
export type CreditsResponse = CreditsPayload;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  const url = new URL(req.url);
  const includeHistory = url.searchParams.get('history') === 'true';
  const historyLimit = parseInt(url.searchParams.get('limit') || '20', 10);

  try {
    return NextResponse.json(
      await getCredits(organization.id, { includeHistory, historyLimit })
    );
  } catch (error: any) {
    console.error('[CREDITS] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch credits' }, { status: 500 });
  }
}
