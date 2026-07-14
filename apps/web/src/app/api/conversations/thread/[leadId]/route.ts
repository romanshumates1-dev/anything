import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * Conversation thread for a lead.
 *
 * Ghost-feature note (verification sprint 2026-07): this route previously read
 * `message_events` joined to `campaign_contacts.lead_id`, but (a) inbound replies
 * are stored in `ai_conversations.history`, not message_events, and (b) the
 * wizard never sets campaign_contacts.lead_id — so the thread rendered nothing.
 * It now returns the actual conversation history mapped to the shape the inbox
 * thread page expects: user turns are inbound, assistant turns are outbound.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { leadId: leadIdRaw } = await params;
    const leadId = Number(leadIdRaw);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 });
    }

    const [conv] = await sql`
      SELECT id, lead_id, history, status, last_message_at
      FROM ai_conversations
      WHERE lead_id = ${leadId}
      LIMIT 1
    `;
    const [lead] = await sql`SELECT phone FROM leads WHERE id = ${leadId} LIMIT 1`;

    const phone = lead?.phone ?? null;
    const history: Array<{ role: string; content: string }> = conv?.history ?? [];
    const ts = conv?.last_message_at ?? new Date().toISOString();

    const messages = history.map((m, i) => ({
      id: `${conv?.id ?? 'c'}-${i}`,
      direction: m.role === 'assistant' ? 'outbound' : 'inbound',
      status: conv?.status ?? 'active',
      text: m.content,
      created_at: ts,
      to_phone: phone,
    }));

    return NextResponse.json(messages);
  } catch (error: any) {
    console.error('GET /api/conversations/thread error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
