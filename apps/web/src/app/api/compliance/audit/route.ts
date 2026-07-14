import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { recordComplianceAction } from '@/app/api/utils/compliance-audit';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organizationId = (session.user as any).organizationId || 'default';
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    const rows = await sql`
      SELECT * FROM compliance_audit
      WHERE organization_id = ${organizationId}
      ${campaignId ? sql`AND campaign_id = ${campaignId}` : sql`AND campaign_id IS NULL`}
      ORDER BY created_at DESC
      LIMIT 100
    `;

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

    const organizationId = (session.user as any).organizationId || 'default';
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