/**
 * Inbound SMS Webhook Handler
 *
 * Processes incoming SMS replies from Twilio/other providers
 * Routes to negotiation engine and updates lead status
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';

// Twilio signature validation
function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => key + params[key])
    .join('');

  const data = url + sortedParams;
  const expectedSignature = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64');

  return signature === expectedSignature;
}

// Classify inbound message sentiment
function classifySentiment(message: string): string {
  const lower = message.toLowerCase().trim();

  // Opt-out keywords
  const optOutKeywords = ['stop', 'unsubscribe', 'remove', 'quit', 'cancel', 'optout', 'opt out'];
  if (optOutKeywords.some(k => lower.includes(k))) {
    return 'opt_out';
  }

  // Positive signals
  const positiveKeywords = ['yes', 'interested', 'call me', 'sounds good', 'deal', 'lets do it', 'send contract'];
  if (positiveKeywords.some(k => lower.includes(k))) {
    return 'positive';
  }

  // Negative signals
  const negativeKeywords = ['no', 'not interested', 'dont want', 'stop calling', 'leave me alone'];
  if (negativeKeywords.some(k => lower.includes(k))) {
    return 'negative';
  }

  // Price discussion
  const priceKeywords = ['price', 'offer', 'how much', '$', 'dollars', 'money', 'pay', 'cost'];
  if (priceKeywords.some(k => lower.includes(k))) {
    return 'price_inquiry';
  }

  // Questions
  if (lower.includes('?') || lower.startsWith('what') || lower.startsWith('how') || lower.startsWith('when')) {
    return 'question';
  }

  return 'neutral';
}

export async function POST(req: NextRequest) {
  // Get raw body for signature validation
  const contentType = req.headers.get('content-type') || '';

  let body: Record<string, string>;

  if (contentType.includes('application/x-www-form-urlencoded')) {
    // Twilio sends form data
    const text = await req.text();
    body = Object.fromEntries(new URLSearchParams(text));
  } else {
    // JSON from other providers
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }
  }

  const {
    From: from,
    To: to,
    Body: message,
    MessageSid: messageSid,
    AccountSid: accountSid,
  } = body;

  if (!from || !message) {
    return Response.json({ error: 'Missing From or Body' }, { status: 400 });
  }

  // Validate Twilio signature if configured
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioSignature = req.headers.get('x-twilio-signature');

  if (twilioAuthToken && twilioSignature) {
    const url = req.url;
    if (!validateTwilioSignature(twilioAuthToken, twilioSignature, url, body)) {
      console.error('[INBOUND-SMS] Invalid Twilio signature');
      return Response.json({ error: 'Invalid signature' }, { status: 403 });
    }
  }

  try {
    const phone = from.replace(/\D/g, '');
    const sentiment = classifySentiment(message);

    console.log(`[INBOUND-SMS] From: ${phone.slice(-4)} | Sentiment: ${sentiment} | Message: ${message.substring(0, 50)}...`);

    // Find lead by phone number
    const [lead] = await sql`
      SELECT id, organization_id, name, status, metadata
      FROM leads
      WHERE phone = ${phone} OR phone = ${'+1' + phone} OR phone = ${'+' + phone}
      ORDER BY created_at DESC
      LIMIT 1
    `.catch(() => [null]);

    if (!lead) {
      console.log(`[INBOUND-SMS] No lead found for phone ${phone.slice(-4)}`);
      // Could create a new lead here if desired
      return Response.json({ received: true, lead: null });
    }

    // Handle opt-out immediately
    if (sentiment === 'opt_out') {
      await sql`
        UPDATE leads SET status = 'OPTED_OUT', updated_at = NOW()
        WHERE id = ${lead.id}
      `;

      await sql`
        INSERT INTO suppression_list (lead_id, phone, reason, created_at)
        VALUES (${lead.id}, ${phone}, 'sms_opt_out', NOW())
        ON CONFLICT DO NOTHING
      `.catch(() => {});

      console.log(`[INBOUND-SMS] Lead ${lead.id} opted out`);

      // Send confirmation (required by TCPA)
      // In production: trigger outbound confirmation SMS
      return Response.json({
        received: true,
        action: 'opted_out',
        leadId: lead.id,
        response: 'You have been unsubscribed. Reply START to resubscribe.',
      });
    }

    // Log the inbound message
    await sql`
      INSERT INTO message_events (
        id, organization_id, lead_id, direction, channel, provider,
        content, metadata, created_at
      ) VALUES (
        ${crypto.randomUUID()}, ${lead.organization_id}, ${lead.id},
        'inbound', 'sms', 'twilio',
        ${message}, ${JSON.stringify({ messageSid, from, to, sentiment })}, NOW()
      )
    `.catch(console.error);

    // Update campaign lead queue if exists
    await sql`
      UPDATE campaign_lead_queue
      SET reply_sentiment = ${sentiment},
          last_reply_at = NOW(),
          status = CASE
            WHEN ${sentiment} = 'positive' THEN 'engaged'
            WHEN ${sentiment} = 'negative' THEN 'closed_lost'
            ELSE status
          END
      WHERE lead_id = ${lead.id}
    `.catch(() => {});

    // Update lead status based on sentiment
    let newStatus = lead.status;
    if (sentiment === 'positive' && ['NEW', 'CONTACTED'].includes(lead.status)) {
      newStatus = 'ENGAGED';
    } else if (sentiment === 'negative') {
      newStatus = 'CLOSED_LOST';
    }

    if (newStatus !== lead.status) {
      await sql`
        UPDATE leads SET status = ${newStatus}, updated_at = NOW()
        WHERE id = ${lead.id}
      `;
    }

    // Queue for negotiation engine processing
    await sql`
      INSERT INTO negotiation_queue (
        id, lead_id, inbound_message, sentiment, created_at, processed
      ) VALUES (
        ${crypto.randomUUID()}, ${lead.id}, ${message}, ${sentiment}, NOW(), false
      )
    `.catch(() => {});

    return Response.json({
      received: true,
      leadId: lead.id,
      sentiment,
      newStatus,
    });
  } catch (error: any) {
    console.error('[INBOUND-SMS] Error:', error);
    return Response.json({ error: 'Processing failed' }, { status: 500 });
  }
}
