import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';
import { registerOptOut } from '@/app/api/utils/compliance';
import { isOptOutMessage } from '@/app/api/services/optOutDetection';
import { stripQuotedReply } from '@/app/api/utils/emailReply';

/**
 * POST /api/email/inbound — an inbound email reply enters the SAME conversation
 * thread the SMS path uses, so the AI negotiator handles it identically.
 *
 * This is the "one downstream machine" requirement: email is a new INPUT, not a
 * parallel pipeline. It writes to ai_conversations exactly as
 * /api/sms/inbound does (append user turn, requires_human, needs_review,
 * enqueue ai_reply) — the negotiator, ladder, approvals and contracts see no
 * difference between a texted reply and an emailed one.
 *
 * OPT-OUT RUNS FIRST, always. An emailed "unsubscribe" is honoured with the
 * same keyword detector as SMS STOP and routed through registerOptOut, so it
 * fans out across every channel for that lead. A reply saying "stop emailing
 * me" must also stop the postcards.
 *
 * Secret-gated like the other inbound webhooks: an inbound-email provider
 * (SES receipt rule -> SNS/Lambda, Postmark, Cloudflare Email Routing) posts
 * the parsed message here. Without the gate, anyone could inject a reply into
 * a prospect's thread.
 *
 * Body: { from, to?, subject?, text, messageId? }
 */
export async function POST(request: Request) {
  const secret = process.env.SMS_INBOUND_SECRET;
  const url = new URL(request.url);
  const provided = url.searchParams.get('s') || request.headers.get('x-sms-secret');
  if (!secret || provided !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const from = typeof body?.from === 'string' ? body.from.trim().toLowerCase() : '';
  const rawText = typeof body?.text === 'string' ? body.text : '';
  if (!from || !from.includes('@')) {
    return Response.json({ error: 'from (email address) is required' }, { status: 400 });
  }

  // Strip the quoted original before anything reads the message. A reply that
  // quotes our own outbound would otherwise carry our words into the thread as
  // if the prospect had written them — and would make keyword detection fire on
  // OUR footer ("reply STOP to opt out"), opting people out for replying.
  const text = stripQuotedReply(rawText).trim();

  try {
    // ── 1. OPT-OUT GATE — must run first, on the STRIPPED text.
    if (isOptOutMessage(text)) {
      await registerOptOut(from, 'email', { reason: 'email_unsubscribe_reply', source: 'inbound_email' });
      await logEvent('email_inbound_optout', 'compliance', from, { reason: 'unsubscribe_reply' });
      return Response.json({ status: 'opted_out', target: from });
    }

    // ── 2. Match the sender to a lead. Email is the key here; the SMS path
    // keys on phone. Same table, same downstream.
    const [lead] = await sql`
      SELECT id, ai_paused, organization_id
      FROM leads
      WHERE LOWER(email) = ${from}
      ORDER BY id DESC
      LIMIT 1
    `;
    if (!lead) {
      // Not an error: a reply from an unknown address is simply not ours to
      // thread. Acknowledged so the provider does not retry forever.
      return Response.json({ status: 'ignored', reason: 'no_matching_lead' });
    }

    if (!text) {
      // An empty body after stripping (e.g. a pure quote or an auto-reply with
      // no new content) must not create a blank conversation turn.
      return Response.json({ status: 'ignored', reason: 'empty_after_quote_strip', leadId: lead.id });
    }

    // ── 3. Same conversation thread the SMS path writes to.
    const [conv] = await sql`
      INSERT INTO ai_conversations (lead_id, channel, history)
      VALUES (${lead.id}, 'email', '[]'::jsonb)
      ON CONFLICT (lead_id) DO UPDATE SET last_message_at = NOW()
      RETURNING *
    `;

    await sql`
      UPDATE ai_conversations
      SET history = history || ${JSON.stringify([{ role: 'user', content: text }])}::jsonb,
          requires_human = true,
          status = 'needs_review',
          last_message_at = NOW()
      WHERE id = ${conv.id}
    `;

    // ── 4. Hand to the negotiator exactly as SMS does. A paused lead parks the
    // message for a human with no AI job — same rule, not a special case.
    let aiQueued = false;
    if (!lead.ai_paused) {
      await enqueueJob('ai_reply', { leadId: lead.id, conversationId: conv.id });
      aiQueued = true;
    }

    await logEvent('email_inbound', 'conversation', String(conv.id), {
      leadId: lead.id,
      aiQueued,
      chars: text.length,
    });

    return Response.json({ status: 'recorded', leadId: lead.id, conversationId: conv.id, aiQueued });
  } catch (error: any) {
    console.error('POST /api/email/inbound error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
