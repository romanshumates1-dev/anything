import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';
import { authenticateApiKey, checkScope } from '../auth/utils';

export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;

  try {
    const organizationId = authResult.organizationId!;
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 100);
    const offset = Number(searchParams.get('offset')) || 0;

    const campaigns = await sql`
      SELECT 
        oc.id, oc.name, oc.direction, oc.status, oc.daily_volume_max, oc.duration_days,
        oc.test_mode, oc.dnc_scrub_enabled, oc.ai_negotiation_enabled, oc.created_at, oc.updated_at,
        (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.campaign_id = oc.id) AS total_contacts
      FROM outreach_campaigns oc
      WHERE oc.organization_id = ${organizationId}
      ORDER BY oc.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return NextResponse.json({ data: campaigns, limit, offset });
  } catch (error: any) {
    console.error('GET /api/v1/campaigns error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;
  if (!checkScope(authResult.scopes, 'write:campaigns')) {
    return NextResponse.json({ error: 'Forbidden - missing scope write:campaigns' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const {
      direction,
      name,
      dailyVolumeMax,
      durationDays,
      openingMessage,
      contacts,
    } = body as {
      direction: 'SELLER' | 'BUYER';
      name: string;
      dailyVolumeMax: number;
      durationDays: number;
      openingMessage: string;
      contacts?: { name: string; phone: string }[];
    };

    if (!name || !direction || !dailyVolumeMax || !durationDays || !openingMessage) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const organizationId = authResult.organizationId!;
    const campaignId = crypto.randomUUID();
    const openingMessageId = crypto.randomUUID();

    await sql.transaction([
      sql`INSERT INTO outreach_campaigns (id, organization_id, direction, name, status, daily_volume_max, duration_days, opening_message_id)
          VALUES (${campaignId}, ${organizationId}, ${direction}, ${name.trim()}, 'DRAFT', ${dailyVolumeMax}, ${durationDays}, ${openingMessageId})`,
      sql`INSERT INTO campaign_message_templates (id, organization_id, kind, body, sequence_order, delay_hours)
          VALUES (${openingMessageId}, ${organizationId}, 'OPENING', ${openingMessage}, 0, 0)`,
      ...(Array.isArray(contacts) && contacts.length > 0
        ? contacts.map((c) => {
            const contactId = crypto.randomUUID();
            return sql`INSERT INTO campaign_contacts (id, campaign_id, organization_id, name, phone, status)
                       VALUES (${contactId}, ${campaignId}, ${organizationId}, ${c.name}, ${c.phone}, 'QUEUED')`;
          })
        : []),
    ]);

    return NextResponse.json({ id: campaignId, name, direction, status: 'DRAFT' }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/v1/campaigns error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}