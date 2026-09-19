/**
 * Pipeline Runs API
 *
 * GET /api/pipeline/runs - Get recent pipeline run history
 */

import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 100);

  try {
    const runs = await sql`
      SELECT
        id,
        started_at,
        completed_at,
        status,
        stage_stats,
        leads_processed,
        messages_sent,
        responses_handled,
        deals_advanced,
        contracts_generated,
        human_actions_created,
        errors
      FROM pipeline_runs
      WHERE organization_id = ${organization.id}
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({ runs });
  } catch (error: unknown) {
    console.error('[pipeline/runs] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline runs' },
      { status: 500 }
    );
  }
}
