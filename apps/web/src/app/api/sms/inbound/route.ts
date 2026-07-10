import sql from '@/app/api/utils/sql';
import { logEvent } from '../../utils/logger';
import { recordRun } from '../../utils/execution-ledger';
import { getTwilioConfig } from '../../utils/twilio-adapter';
import { validateTwilioSignature } from '../../utils/twilio-webhook';
import { enqueueJob } from '../../utils/jobs';

/**
 * Inbound SMS webhook.
 *
 * Two auth paths (content-type switch):
 *   1. Twilio branch (application/x-www-form-urlencoded): validated via
 *      X-Twilio-Signature (HMAC-SHA1 over PUBLIC_WEBHOOK_URL + sorted params).
 *      This is the REAL production path — Twilio cannot send custom headers.
 *   2. Simulator branch (application/json): gated by x-sms-secret header.
 *      Used by curl/tests/simulator only.
 *
 * Owner number is verified before accepting price ranges.
 * MessageSid dedup: Twilio delivers at-least-once; we skip duplicates.
 */
export async function POST(request: Request) {
  const twilioConfig = getTwilioConfig();
  const contentType = request.headers.get('content-type') || '';

  try {
    let from: string;
    let text: string;
    let messageSid: string | null = null;
    const isTwilioWebhook = contentType.includes('application/x-www-form-urlencoded')
      || contentType.includes('multipart/form-data');

    if (isTwilioWebhook && twilioConfig) {
      // ── TWILIO BRANCH: real webhook from Twilio ──
      // Parse form-encoded body (Twilio POSTs From, Body, To, MessageSid, etc.)
      const form = await request.formData();
      const twilioSignature = request.headers.get('x-twilio-signature') || '';

      // Use PUBLIC_WEBHOOK_URL for signature validation because behind ngrok
      // (or any reverse proxy) request.url is the internal localhost URL,
      // but Twilio signs with the public-facing URL it POSTs to.
      const publicUrl = process.env.PUBLIC_WEBHOOK_URL;
      const url = new URL(request.url);
      const fullUrl = publicUrl || `${url.protocol}//${url.host}${url.pathname}`;

      const formObj = Object.fromEntries(form.entries());
      const valid = validateTwilioSignature({
        url: fullUrl,
        signature: twilioSignature,
        authToken: twilioConfig.authToken,
        params: formObj as Record<string, string>,
      });

      if (!valid) {
        console.warn('[sms/inbound] Twilio signature validation FAILED', {
          url: fullUrl,
          hasSignature: !!twilioSignature,
        });
        return Response.json({ error: 'Invalid signature' }, { status: 403 });
      }

      const fromVal = form.get('From');
      const textVal = form.get('Body');
      const sidVal = form.get('MessageSid');
      from = typeof fromVal === 'string' ? fromVal.trim() : '';
      text = typeof textVal === 'string' ? textVal.trim() : '';
      messageSid = typeof sidVal === 'string' ? sidVal.trim() : null;

      // Dedup: Twilio delivers at-least-once. If we already processed this
      // MessageSid, return 200 immediately so Twilio doesn't retry.
      if (messageSid) {
        const [existing] = await sql`
          SELECT id FROM audit_logs
          WHERE action = 'sms_inbound' AND metadata->>'messageSid' = ${messageSid}
          LIMIT 1
        `;
        if (existing) {
          console.log('[sms/inbound] Duplicate MessageSid, skipping:', messageSid);
          return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
            status: 200,
            headers: { 'Content-Type': 'application/xml' },
          });
        }
      }

      console.log('[sms/inbound] Twilio webhook received', {
        from,
        messageSid,
        signatureValid: true,
      });
    } else {
      // ── SIMULATOR BRANCH: JSON body + x-sms-secret header ──
      // Used by curl, tests, and the SMS simulator. NOT reachable by Twilio.
      const secret = process.env.SMS_INBOUND_SECRET;
      const provided = request.headers.get('x-sms-secret');
      if (!secret || provided !== secret) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await request.json();
      from = typeof body.from === 'string' ? body.from.trim() : '';
      text = typeof body.text === 'string' ? body.text : '';
    }

    if (!from || !text) {
      return Response.json({ error: '`from` and `text` are required' }, { status: 400 });
    }

    // Normalize owner number to E.164 for comparison (Twilio sends +prefix)
    const ownerNumber = twilioConfig?.ownerNumber;
    const ownerE164 = ownerNumber
      ? (ownerNumber.startsWith('+') ? ownerNumber : `+${ownerNumber}`)
      : null;
    const fromE164 = from.startsWith('+') ? from : `+${from}`;
    if (ownerE164 && fromE164 === ownerE164) {
      await logEvent('sms_inbound_owner', 'sms', from, { text });
      // Twilio expects TwiML response; simulator gets JSON
      if (isTwilioWebhook) {
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        });
      }
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
      ...(messageSid ? { messageSid } : {}),
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

    // pause-AI: only draft an automatic AI reply when the lead is NOT paused.
    // A paused lead parks the inbound message for a human with no AI job.
    let aiQueued = false;
    if (!lead.ai_paused) {
      await enqueueJob('ai_reply', { leadId: lead.id, conversationId: conv.id });
      aiQueued = true;
    }

    // Twilio expects TwiML; simulator/tests get JSON
    if (isTwilioWebhook) {
      return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      });
    }
    return Response.json({ status: 'recorded', leadId: lead.id, aiQueued });
  } catch (error: any) {
    console.error('POST /api/sms/inbound error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
