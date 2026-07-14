import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function GET(
  request: NextRequest,
  { params }: { params: { leadId: string } }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const leadId = params.leadId;
    const orgId = (session.user as any).organizationId || 'default';

    const messages = await sql`
      SELECT 
        me.id,
        me.direction,
        me.status,
        me.provider,
        me.metadata,
        me.created_at,
        cc.phone as to_phone
      FROM message_events me
      JOIN campaign_contacts cc ON cc.id = me.contact_id
      WHERE me.contact_id IN (
        SELECT id FROM campaign_contacts 
        WHERE lead_id = ${leadId} AND organization_id = ${orgId}
      )
      ORDER BY me.created_at ASC
      LIMIT 100
    `;

    return NextResponse.json(messages);
  } catch (error: any) {
    console.error('GET /api/conversations/thread error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}