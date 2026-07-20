import sql from '@/app/api/utils/sql';
import { getTwilioConfig } from '@/app/api/utils/twilio-adapter';
import { validateTwilioSignature, twilioStatusCallbackUrl } from '@/app/api/utils/twilio-webhook';
import { logEvent } from '@/app/api/utils/logger';
import type { DeliveryStatus } from '@/app/api/gateway/providers';

/**
 * Twilio delivery-status callback (Gap G-1 fix).
 *
 * Twilio POSTs `MessageStatus` transitions (queued→sent→delivered, or
 * failed/undelivered) here for every outbound message when the send set a
 * `statusCallback` URL (TwilioAdapter does this when PUBLIC_WEBHOOK_URL /
 * TWILIO_STATUS_CALLBACK_URL is configured). This is the ONLY place
 * `message_events` advances past 'dispatched'.
 *
 * Security: the X-Twilio-Signature is verified with the same HMAC-SHA1 util the
 * inbound route uses, over the SAME canonical URL the adapter told Twilio to
 * call (`twilioStatusCallbackUrl()`) — tampered/unsigned → 403.
 *
 * Ordering: Twilio delivers at-least-once and can arrive out of order. We rank
 * statuses and never downgrade a terminal/higher status (delivered won't revert
 * to sent), which also makes replays idempotent.
 */
export const runtime = 'nodejs';

const STATUS_MAP: Record<string, DeliveryStatus> = {
  queued: 'queued',
  sending: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'undelivered',
  failed: 'failed',
  read: 'delivered',
};

// Higher wins; terminal states share the top rank so they don't get overwritten.
const RANK: Record<string, number> = {
  queued: 1,
  dispatched: 1,
  sent: 2,
  delivered: 3,
  undelivered: 3,
  failed: 3,
  bounced: 3,
};

export async function POST(request: Request) {
  const twilioConfig = getTwilioConfig();
  if (!twilioConfig?.authToken) {
    return Response.json(
      { error: { code: 'SMS_UNCONFIGURED', message: 'Twilio not configured; cannot verify callback' } },
      { status: 503 }
    );
  }

  const form = await request.formData();
  const params = Object.fromEntries(form.entries()) as Record<string, string>;

  const url = new URL(request.url);
  const fullUrl = twilioStatusCallbackUrl() || `${url.protocol}//${url.host}${url.pathname}`;
  const valid = validateTwilioSignature({
    url: fullUrl,
    signature: request.headers.get('x-twilio-signature') || '',
    authToken: twilioConfig.authToken,
    params,
  });
  if (!valid) {
    return Response.json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature' } }, { status: 403 });
  }

  const messageSid = (form.get('MessageSid') || form.get('SmsSid') || '').toString().trim();
  const rawStatus = (form.get('MessageStatus') || form.get('SmsStatus') || '').toString().trim().toLowerCase();
  const errorCode = (form.get('ErrorCode') || '').toString().trim() || null;
  const mapped = STATUS_MAP[rawStatus];

  if (!messageSid || !mapped) {
    // Acknowledge so Twilio stops retrying, but record that we couldn't apply it.
    await logEvent('message_status_callback_ignored', 'message', messageSid || 'unknown', {
      rawStatus,
      reason: !messageSid ? 'no_sid' : 'unmapped_status',
    });
    return Response.json({ received: true, applied: false });
  }

  // Match the gateway's message_events row: id=our uuid, providerMessageId=SM… in metadata.
  const rows = (await sql`
    SELECT id, status FROM message_events
    WHERE metadata->>'providerMessageId' = ${messageSid} OR id = ${messageSid}
    ORDER BY created_at DESC LIMIT 1
  `) as { id: string; status: string }[];

  if (rows.length === 0) {
    await logEvent('message_status_callback_unmatched', 'message', messageSid, { rawStatus, mapped });
    return Response.json({ received: true, applied: false });
  }

  const current = rows[0];
  const currentRank = RANK[current.status] ?? 0;
  const nextRank = RANK[mapped] ?? 0;
  if (nextRank < currentRank) {
    // Out-of-order or duplicate lower status — don't downgrade.
    await logEvent('message_status_callback_stale', 'message', messageSid, {
      from: current.status,
      to: mapped,
    });
    return Response.json({ received: true, applied: false, reason: 'stale' });
  }

  await sql`
    UPDATE message_events
    SET status = ${mapped},
        metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
          deliveryStatus: mapped,
          errorCode,
          statusUpdatedAt: new Date().toISOString(),
        })}::jsonb
    WHERE id = ${current.id}
  `;
  await logEvent('message_status_callback', 'message', messageSid, {
    messageEventId: current.id,
    from: current.status,
    to: mapped,
    errorCode,
  });

  return Response.json({ received: true, applied: true, status: mapped });
}
