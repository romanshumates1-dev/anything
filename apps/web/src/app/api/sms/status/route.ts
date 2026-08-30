import sql from '@/app/api/utils/sql';
import { logEvent } from '../../utils/logger';
import { getTwilioConfig } from '../../utils/twilio-adapter';
import { validateTwilioSignature } from '../../utils/twilio-webhook';

/**
 * Twilio delivery-status callback receiver (BREAKAGE_TABLE #33).
 *
 * Nothing wired StatusCallback on the outbound send (providers.ts TwilioAdapter
 * now sets it — see PUBLIC_WEBHOOK_URL), and no route ever received it, so
 * message_events rows written at dispatch time could never advance past their
 * initial status. Real Twilio auth: form-encoded body + X-Twilio-Signature,
 * verified with the same validateTwilioSignature helper /api/sms/inbound uses
 * (HMAC-SHA1 over the public URL + sorted params — genuinely cryptographic,
 * unlike TwilioAdapter.validateWebhook which is dead/non-crypto — see
 * providers.ts).
 *
 * Twilio's MessageStatus vocabulary: queued -> sending -> sent -> delivered
 * (or undelivered/failed). We map 1:1 into message_events.status.
 */
const STATUS_MAP: Record<string, string> = {
  queued: 'queued',
  sending: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'undelivered',
  failed: 'failed',
};

function twiml200() {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  });
}

export async function POST(request: Request) {
  const twilioConfig = getTwilioConfig();
  const contentType = request.headers.get('content-type') || '';
  const isTwilioWebhook =
    contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');

  if (!isTwilioWebhook || !twilioConfig) {
    return Response.json({ error: 'Unsupported request' }, { status: 400 });
  }

  try {
    const form = await request.formData();
    const twilioSignature = request.headers.get('x-twilio-signature') || '';

    const publicUrl = process.env.PUBLIC_WEBHOOK_URL;
    const url = new URL(request.url);
    const fullUrl = publicUrl ? `${publicUrl.replace(/\/$/, '')}/api/sms/status` : `${url.protocol}//${url.host}${url.pathname}`;

    const formObj = Object.fromEntries(form.entries()) as Record<string, string>;
    const valid = validateTwilioSignature({
      url: fullUrl,
      signature: twilioSignature,
      authToken: twilioConfig.authToken,
      params: formObj,
    });

    if (!valid) {
      console.warn('[sms/status] Twilio signature validation FAILED', { url: fullUrl, hasSignature: !!twilioSignature });
      return Response.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const messageSid = (formObj.MessageSid || formObj.SmsSid || '').trim();
    const rawStatus = (formObj.MessageStatus || formObj.SmsStatus || '').trim().toLowerCase();
    const errorCode = formObj.ErrorCode || null;
    const errorMessage = formObj.ErrorMessage || null;

    if (!messageSid || !rawStatus) {
      return twiml200(); // malformed/irrelevant callback — ack so Twilio doesn't retry
    }

    const status = STATUS_MAP[rawStatus] || rawStatus;

    const updated = await sql`
      UPDATE message_events
      SET status = ${status},
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ twilioStatus: rawStatus, errorCode, errorMessage })}::jsonb
      WHERE provider_message_id = ${messageSid}
      RETURNING id
    `;

    if (updated.length === 0) {
      // No matching row (message sent before this receiver existed, or a
      // provider_message_id mismatch) — log for visibility, still ack 200 so
      // Twilio doesn't retry a callback we simply can't correlate.
      console.warn('[sms/status] no message_events row for MessageSid', messageSid);
    } else {
      await logEvent('sms_status_callback', 'message_event', updated[0].id, {
        messageSid, status, errorCode, errorMessage,
      });
    }

    return twiml200();
  } catch (error: any) {
    console.error('POST /api/sms/status error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
