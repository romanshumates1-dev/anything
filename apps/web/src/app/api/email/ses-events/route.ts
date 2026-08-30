import { registerOptOut } from '@/app/api/utils/compliance';
import { logEvent } from '@/app/api/utils/logger';
import { classifySesEvent, parseSnsEnvelope } from '@/app/api/utils/sesEvents';
import sql from '@/app/api/utils/sql';
import { recordEmailBounce, recordEmailComplaint } from '@/app/api/utils/emailWarmup';

/**
 * POST /api/email/ses-events — Amazon SES bounce/complaint feedback, delivered
 * via SNS.
 *
 * A permanent bounce or a complaint suppresses the address through the SAME
 * registerOptOut path as an SMS STOP, so it fans out across every channel for
 * that lead (suppressLeadAllChannels) — a person who complained about an email
 * must not then receive a postcard or a text. Transient bounces are NOT
 * suppressed: a full mailbox is a reachable lead.
 *
 * SECURITY: secret-gated with the same shared-secret model as the other
 * inbound webhooks (SMS_INBOUND_SECRET / x-sms-secret). SNS cannot send custom
 * headers on an HTTP subscription, so the secret rides in the path query and
 * the subscription URL is configured as
 *   https://<host>/api/email/ses-events?s=<SMS_INBOUND_SECRET>
 * This prevents an anonymous POST from suppressing arbitrary addresses — the
 * exact concern the opt-out route guards. SNS message-signature verification is
 * the stronger production control and is left as a documented follow-up
 * (BLOCKED-ON-OWNER: needs a live SNS topic + signing cert to verify against);
 * the secret gate is the boundary consistent with the rest of this codebase.
 *
 * SubscriptionConfirmation is acknowledged but NOT auto-confirmed: its
 * SubscribeURL arrives inside an untrusted webhook body, and auto-visiting a
 * URL supplied by observed content must stay a human action. The URL is logged
 * for the owner to confirm.
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

  const envelope = parseSnsEnvelope(body);

  if (envelope.type === 'SubscriptionConfirmation') {
    // Do not fetch SubscribeURL — owner confirms it. Record it so the owner
    // has the exact URL without it being buried in provider logs.
    await logEvent('ses_subscription_confirmation', 'compliance', 'sns', {
      subscribeUrl: envelope.subscribeUrl ?? null,
    });
    return Response.json({
      status: 'subscription_pending_owner_confirmation',
      message: 'Owner must visit the SubscribeURL to activate this SNS subscription.',
    });
  }

  if (envelope.type !== 'Notification' || !envelope.message) {
    // Unknown/unsubscribe envelopes: acknowledge so SNS does not retry, act on
    // nothing.
    return Response.json({ status: 'ignored', type: envelope.type });
  }

  const decision = classifySesEvent(envelope.message);

  // Suppress permanent bounces + complaints; fan-out is handled inside
  // registerOptOut. Transient bounces fall through with an empty suppress list.
  for (const email of decision.suppress) {
    await registerOptOut(email, 'email', {
      reason: decision.eventType === 'Complaint' ? 'ses_complaint' : 'ses_permanent_bounce',
      source: 'ses',
    });
  }

  // Feed warmup counters so auto-pause fires before provider suspension.
  // Org context: look up which org sent to these recipients recently.
  if (decision.suppress.length > 0) {
    const orgRows = await sql`
      SELECT DISTINCT payload->>'organizationId' as org_id
      FROM jobs
      WHERE type = 'send_email'
        AND payload->>'to' = ANY(${decision.suppress})
        AND status = 'completed'
      ORDER BY org_id
      LIMIT 5
    `;
    for (const { org_id } of orgRows) {
      if (!org_id) continue;
      if (decision.eventType === 'Complaint') {
        await recordEmailComplaint(org_id);
      } else {
        await recordEmailBounce(org_id);
      }
    }
  }

  await logEvent('ses_feedback', 'compliance', decision.eventType, {
    suppressed: decision.suppress.length,
    spared: decision.spared.length,
    reason: decision.reason,
  });

  return Response.json({
    status: 'processed',
    eventType: decision.eventType,
    suppressed: decision.suppress.length,
    spared: decision.spared.length,
  });
}
