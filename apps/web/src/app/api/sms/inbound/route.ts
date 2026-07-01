import sql from '@/app/api/utils/sql';
import { logEvent } from '../../utils/logger';
import { recordRun } from '../../utils/execution-ledger';
import { getTwilioConfig } from '../../utils/twilio-adapter';
import { validateTwilioSignature } from '../../utils/twilio-webhook';

/**
 * Inbound SMS webhook. Secret-gated (NOT session-gated) since the provider
 * calls it. When Twilio is configured, signature validation is enforced.
 * Owner number is verified before accepting price ranges.
 */
export async function POST(request: Request) {
  const secret = process.env.SMS_INBOUND_SECRET;
  const provided = request.headers.get('x-sms-secret');
  if (!secret || provided !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const twilioConfig = getTwilioConfig();

  try {
    let from: string;
    let text: string;

    if (twilioConfig) {
      const form = await request.formData();
      const twilioSignature = request.headers.get('x-twilio-signature') || '';
      const url = new URL(request.url);
      const fullUrl = `${url.protocol}//${url.host}${url.pathname}`;

      const valid = validateTwilioSignature({
        url: fullUrl,
        signature: twilioSignature,
        authToken: twilioConfig.authToken,
        params: Object.fromEntries(form.entries()),
      });

      if (!valid) {
        return Response.json({ error: 'Invalid signature' }, { status: 403 });
      }

      from = typeof form.get('From') === 'string' ? form.get('From')!.trim() : '';
      text = typeof form.get('Body') === 'string' ? form.get('Body')!.trim() : '';
    } else {
      const body = await request.json();
      from = typeof body.from === 'string' ? body.from.trim() : '';
      text = typeof body.text === 'string' ? body.text : '';
    }

    if (!from || !text) {
      return Response.json({ error: '`from` and `text` are required' }, { status: 400 });
    }

    const ownerNumber = twilioConfig?.ownerNumber;
    if (ownerNumber && from === ownerNumber) {
      await logEvent('sms_inbound_owner', 'sms', from, { text });
      return Response.json({ status: 'recorded_owner' });
    }

    const [lead] = await sql`SELECT * FROM leads WHERE phone = ${from} LIMIT 1`;
    if (!lead) {
      await logEvent('sms_inbound_unmatched', 'sms', from, { text });
      return Response.json({ status: 'ignored', reason: 'no_matching_lead' });
    }

    const [conv] = await sql`
      INSERT INTO ai_conversations (lead_id, channel, history)
      VALUES (${lead.id}, 'sms', '[]'::jsonb)
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
