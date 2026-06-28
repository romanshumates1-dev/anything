import sql from '@/app/api/utils/sql';
import { logEvent } from '../../utils/logger';
import { recordRun } from '../../utils/execution-ledger';

/**
 * Inbound SMS webhook. Secret-gated (NOT session-gated) since the provider
 * calls it. Provider-agnostic: in Phase 1 it accepts a simple { from, text }
 * body and is verified by a shared secret. A real provider's signature check
 * would slot in at the same boundary.
 */
export async function POST(request: Request) {
  const secret = process.env.SMS_INBOUND_SECRET;
  const provided = request.headers.get('x-sms-secret');
  if (!secret || provided !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const from = typeof body.from === 'string' ? body.from.trim() : '';
    const text = typeof body.text === 'string' ? body.text : '';

    if (!from || !text.trim()) {
      return Response.json({ error: '`from` and `text` are required' }, { status: 400 });
    }

    const [lead] = await sql`SELECT * FROM leads WHERE phone = ${from} LIMIT 1`;
    if (!lead) {
      // Return 200 so the provider does not retry-storm an unmatched number.
      await logEvent('sms_inbound_unmatched', 'sms', from, { text });
      return Response.json({ status: 'ignored', reason: 'no_matching_lead' });
    }

    // Get-or-create the conversation.
    const [conv] = await sql`
      INSERT INTO ai_conversations (lead_id, channel, history)
      VALUES (${lead.id}, 'sms', '[]'::jsonb)
      ON CONFLICT (lead_id) DO UPDATE SET last_message_at = NOW()
      RETURNING *
    `;

    // Append the inbound reply and flag for human review.
    await sql`
      UPDATE ai_conversations
      SET history = history || ${JSON.stringify([{ role: 'user', content: text }])}::jsonb,
          requires_human = true,
          status = 'needs_review',
          last_message_at = NOW()
      WHERE id = ${conv.id}
    `;

    await logEvent('sms_inbound', 'conversation', conv.id.toString(), {
      leadId: lead.id,
      from,
    });

    await recordRun({
      task: 'inbound_reply',
      flow: 'campaign_lifecycle',
      step: 'inbound_reply',
      status: 'pass',
      passed: true,
      detail: `inbound reply recorded for lead ${lead.id}`,
      dbAssertion: "ai_conversations.requires_human=true AND status='needs_review'",
      logAssertion: "audit_logs.action='sms_inbound'",
    });

    return Response.json({ status: 'recorded', leadId: lead.id });
  } catch (error: any) {
    console.error('POST /api/sms/inbound error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
