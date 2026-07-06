import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { authenticateApiKey, checkScope } from '../auth/utils';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;
  if (!checkScope(authResult.scopes, 'read:analytics')) {
    return NextResponse.json({ error: 'Forbidden - missing scope read:analytics' }, { status: 403 });
  }

  try {
    const organizationId = authResult.organizationId!;

    const [funnel] = await sql`
      SELECT 
        COUNT(DISTINCT CASE WHEN cc.status IN ('sent', 'followed_up', 'engaged', 'negotiating', 'deal_agreed', 'contract_sent', 'contract_signed') THEN cc.id END) as sent,
        COUNT(DISTINCT CASE WHEN cc.status IN ('engaged', 'negotiating', 'deal_agreed', 'contract_sent', 'contract_signed') THEN cc.id END) as engaged,
        COUNT(DISTINCT CASE WHEN cc.status IN ('negotiating', 'deal_agreed', 'contract_sent', 'contract_signed') THEN cc.id END) as negotiated,
        COUNT(DISTINCT CASE WHEN cc.status IN ('deal_agreed', 'contract_sent', 'contract_signed') THEN cc.id END) as contracted
      FROM campaign_contacts cc
      JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
      WHERE oc.organization_id = ${organizationId}
    `;

    const [cost] = await sql`
      SELECT 
        COALESCE(SUM(segment_count * 2), 0) as sms_cents,
        COALESCE(SUM(ai_cost_cents), 0) as ai_cents,
        COALESCE(SUM(cost_cents), 0) as scrub_cents
      FROM message_events me
      JOIN outreach_campaigns oc ON oc.id = me.campaign_id
      WHERE oc.organization_id = ${organizationId}
    `;

    return NextResponse.json({
      funnel: {
        sent: Number(funnel?.sent || 0),
        delivered: Number(funnel?.sent || 0), // simplified
        replied: Number(funnel?.engaged || 0),
        engaged: Number(funnel?.engaged || 0),
        negotiated: Number(funnel?.negotiated || 0),
        contracted: Number(funnel?.contracted || 0),
      },
      smsCostCents: Number(cost?.sms_cents || 0),
      aiCostCents: Number(cost?.ai_cents || 0),
      scrubCostCents: Number(cost?.scrub_cents || 0),
      totalCostCents: Number((cost?.sms_cents || 0) + (cost?.ai_cents || 0) + (cost?.scrub_cents || 0)),
    });
  } catch (error: any) {
    console.error('GET /api/v1/analytics error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}