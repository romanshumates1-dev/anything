import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { buildWhere } from '@/app/api/utils/sqlFragments';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import { recordComplianceAction } from '@/app/api/utils/compliance-audit';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }
    const organizationId = organization.id;
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    // Defect #32: this branch was `${sql`AND campaign_id = $n`} : sql`AND campaign_id IS NULL`}`.
    // Both branches are boolean-position fragments, so GET /api/compliance/audit
    // returned 500 for EVERY caller - observed failing in a real browser, not just
    // in review. The compliance audit page was entirely unreachable.
    const scope = buildWhere()
      .eq('organization_id', organizationId)
      .when(campaignId, (w) => w.eq('campaign_id', campaignId))
      .raw(campaignId ? 'TRUE' : 'campaign_id IS NULL')
      .build();

    const rows = await sql(
      `SELECT * FROM compliance_audit
       WHERE ${scope.text}
       ORDER BY created_at DESC
       LIMIT 100`,
      scope.params as never[]
    );

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error('GET /api/compliance/audit error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, campaignId, confirmationText, ip, userAgent } = body;

    if (!action || !['DNC_SCRUB_DISABLED', 'DNC_SCRUB_ENABLED', 'LITIGATOR_SCRUB_DISABLED', 'LITIGATOR_SCRUB_ENABLED'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }
    const organizationId = organization.id;
    const userId = session.user.id;

    await recordComplianceAction({
      organizationId,
      campaignId: campaignId || undefined,
      userId,
      action,
      metadata: {
        confirmationText: confirmationText || '',
        ip: ip || request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: userAgent || request.headers.get('user-agent') || 'unknown',
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('POST /api/compliance/audit error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}