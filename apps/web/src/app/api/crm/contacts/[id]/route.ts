import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * CRM contact detail: the contact + its full conversation history + any
 * negotiation price ladder + deal outcome. Conversation is matched by phone
 * (campaign_contacts.phone → leads.phone → ai_conversations.lead_id), since
 * campaign_contacts.seller_lead_id is frequently null.
 *
 * PATCH toggles a manual opt-out (sets status=OPTED_OUT + opted_out_at).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const org = (session.user as any).organizationId || 'default';
    const { id } = await params;

    const [contact] = await sql`
      SELECT cc.*, cc.status::text AS status_text, oc.name AS campaign_name
      FROM campaign_contacts cc
      LEFT JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
      WHERE cc.id = ${id} AND cc.organization_id = ${org}
    `;
    if (!contact) return Response.json({ error: 'Not found' }, { status: 404 });

    const [conv] = await sql`
      SELECT ac.history, ac.status, ac.requires_human, ac.last_message_at
      FROM ai_conversations ac
      JOIN leads l ON l.id = ac.lead_id
      WHERE l.phone = ${contact.phone}
      ORDER BY ac.last_message_at DESC NULLS LAST
      LIMIT 1
    `;
    const [range] = await sql`
      SELECT min_price, max_price, tier1_price, tier2_price, tier3_price, tier4_price, current_tier, owner_responded_at
      FROM negotiation_price_ranges
      WHERE negotiation_id = ${id} AND organization_id = ${org}
      LIMIT 1
    `;

    return Response.json({
      contact: {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        status: contact.status_text,
        campaignName: contact.campaign_name,
        followUpsSent: contact.follow_ups_sent,
        lastMessageAt: contact.last_message_at,
        lastReplyAt: contact.last_reply_at,
        optedOutAt: contact.opted_out_at,
        createdAt: contact.created_at,
      },
      conversation: conv?.history ?? [],
      conversationStatus: conv?.status ?? null,
      requiresHuman: conv?.requires_human ?? false,
      negotiation: range ?? null,
    });
  } catch (error: any) {
    console.error('GET /api/crm/contacts/[id] error', error);
    return Response.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const org = (session.user as any).organizationId || 'default';
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (body.action === 'opt_out') {
      const [updated] = await sql`
        UPDATE campaign_contacts
        SET status = 'OPTED_OUT', opted_out_at = COALESCE(opted_out_at, NOW()), updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${org}
        RETURNING id, status::text AS status
      `;
      if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json({ id: updated.id, status: updated.status });
    }
    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('PATCH /api/crm/contacts/[id] error', error);
    return Response.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}
