import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '@/app/api/utils/logger';
import { parseContactList, dedupeContacts, ParsedContact } from '@/app/api/utils/contactImport';

// --- Campaign creation ---

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      direction,
      name,
      dailyVolumeMax,
      durationDays,
      openingMessage,
      followUps = [],
      contacts,
      linkedSellerLeadId,
    } = body as {
      direction: 'SELLER' | 'BUYER';
      name: string;
      dailyVolumeMax: number;
      durationDays: number;
      openingMessage: string;
      followUps?: { delayHours: number; body: string }[];
      contacts?: { name: string; phone: string }[];
      linkedSellerLeadId?: string;
    };

    // --- Validation ---
    if (!['SELLER', 'BUYER'].includes(direction)) {
      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 });
    }
    if (typeof name !== 'string' || name.trim().length < 3) {
      return NextResponse.json({ error: 'Name must be at least 3 characters' }, { status: 400 });
    }
    if (typeof dailyVolumeMax !== 'number' || !Number.isInteger(dailyVolumeMax)) {
      return NextResponse.json({ error: 'dailyVolumeMax must be an integer' }, { status: 400 });
    }
    if (typeof durationDays !== 'number' || !Number.isInteger(durationDays) || durationDays < 1) {
      return NextResponse.json({ error: 'durationDays must be a positive integer' }, { status: 400 });
    }

    if (direction === 'SELLER') {
      if (dailyVolumeMax < 50 || dailyVolumeMax > 5000) {
        return NextResponse.json({ error: 'Seller campaign daily volume must be 50-5000' }, { status: 400 });
      }
      if (durationDays > 120) {
        return NextResponse.json({ error: 'Seller campaign max duration is 120 days' }, { status: 400 });
      }
    } else {
      if (dailyVolumeMax < 50 || dailyVolumeMax > 1000) {
        return NextResponse.json({ error: 'Buyer campaign daily volume must be 50-1000' }, { status: 400 });
      }
      if (durationDays > 30) {
        return NextResponse.json({ error: 'Buyer campaign max duration is 30 days' }, { status: 400 });
      }
      if (!linkedSellerLeadId) {
        return NextResponse.json({ error: 'Buyer campaign must link to a signed seller contract' }, { status: 400 });
      }
    }

    if (typeof openingMessage !== 'string' || openingMessage.trim().length < 10) {
      return NextResponse.json({ error: 'Opening message must be at least 10 characters' }, { status: 400 });
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json({ error: 'At least one contact is required' }, { status: 400 });
    }

    // --- Parse & dedupe contacts ---
    const rawText = contacts.map(c => `${c.name}, ${c.phone}`).join('\n');
    const parsed = parseContactList(rawText);
    const deduped = dedupeContacts(parsed);
    const invalidRows = deduped.filter(c => !c.valid);
    const validContacts = deduped.filter(c => c.valid);

    if (validContacts.length === 0) {
      return NextResponse.json({ error: 'No valid contacts after parsing', failures: invalidRows }, { status: 400 });
    }

    const organizationId = (session.user as any).organizationId || 'default';
    const campaignId = crypto.randomUUID();
    const openingMessageId = crypto.randomUUID();

    // Insert campaign + opening message in a transaction
    const result = await sql.transaction([
      sql`INSERT INTO outreach_campaigns (id, organization_id, direction, name, status, daily_volume_max, duration_days, opening_message_id, linked_seller_lead_id)
          VALUES (${campaignId}, ${organizationId}, ${direction}, ${name.trim()}, 'DRAFT', ${dailyVolumeMax}, ${durationDays}, ${openingMessageId}, ${linkedSellerLeadId || null})`,
      sql`INSERT INTO campaign_message_templates (id, organization_id, kind, body, sequence_order, delay_hours)
          VALUES (${openingMessageId}, ${organizationId}, 'OPENING', ${openingMessage}, 0, 0)`,
      ...followUps.map((fu, idx) => {
        const fuId = crypto.randomUUID();
        return sql`INSERT INTO campaign_message_templates (id, organization_id, campaign_id, kind, body, sequence_order, delay_hours)
                   VALUES (${fuId}, ${organizationId}, ${campaignId}, 'FOLLOW_UP', ${fu.body}, ${idx + 1}, ${fu.delayHours})`;
      }),
      ...validContacts.flatMap((c, idx) => {
        const contactId = crypto.randomUUID();
        return [
          sql`INSERT INTO campaign_contacts (id, campaign_id, organization_id, name, phone, status)
              VALUES (${contactId}, ${campaignId}, ${organizationId}, ${c.name}, ${c.phone}, 'QUEUED')`,
        ];
      }),
    ]);

    await logEvent('campaign_created', 'campaign', campaignId, { name, direction, contactsCount: validContacts.length }, session.user.id);

    return NextResponse.json({
      id: campaignId,
      name,
      direction,
      dailyVolumeMax,
      durationDays,
      status: 'DRAFT',
      contactsImported: validContacts.length,
      failures: invalidRows.length,
      failureDetails: invalidRows,
    });
  } catch (error: any) {
    console.error('POST /api/outreach/campaigns error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}

// --- List campaigns ---

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const organizationId = (session.user as any).organizationId || 'default';
    const rows = await sql`
      SELECT 
        oc.*,
        (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.campaign_id = oc.id) AS total_contacts,
        (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.campaign_id = oc.id AND cc.status IN ('ENGAGED', 'NEGOTIATING')) AS engaged_count,
        (SELECT COUNT(*) FROM campaign_contacts cc WHERE cc.campaign_id = oc.id AND cc.status = 'OPTED_OUT') AS opted_out_count
      FROM outreach_campaigns oc
      WHERE oc.organization_id = ${organizationId}
      ORDER BY oc.created_at DESC
      LIMIT 100
    `;
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error('GET /api/outreach/campaigns error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}