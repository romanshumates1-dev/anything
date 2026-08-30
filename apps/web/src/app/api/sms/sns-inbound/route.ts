/**
 * AWS SNS Inbound SMS Webhook
 *
 * Handles inbound SMS via AWS SNS instead of Twilio.
 * AWS SNS delivers messages as JSON with signature verification.
 *
 * Flow:
 * 1. Phone carrier → AWS Pinpoint/SNS → This webhook
 * 2. Verify SNS signature (prevents spoofing)
 * 3. Handle subscription confirmation (one-time setup)
 * 4. Process inbound SMS messages
 */
import { createHmac, createVerify } from 'node:crypto';
import sql from '@/app/api/utils/sql';
import { logEvent } from '../../utils/logger';
import { recordRun } from '../../utils/execution-ledger';
import { enqueueJob } from '../../utils/jobs';
import { recordReplyReceived } from '../../utils/sla';
import { cancelCadence } from '../../utils/cadenceEngine';
import { detectHumanRequest, handleHumanRequest } from '../../services/humanRequestDetector';
import { isOptOutMessage } from '../../services/optOutDetection';
import { registerOptOut } from '../../utils/compliance';
import { recordStageTransition, resolveLeadIdByPhone } from '../../services/stageTransitionRecorder';

const SNS_SIGNING_CERT_URL_PATTERN = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//;

interface SNSMessage {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
}

interface SMSMessage {
  originationNumber: string;
  destinationNumber: string;
  messageKeyword: string;
  messageBody: string;
  inboundMessageId: string;
  previousPublishedMessageId?: string;
}

async function verifySNSSignature(message: SNSMessage): Promise<boolean> {
  if (!process.env.AWS_SNS_VERIFY_SIGNATURES || process.env.AWS_SNS_VERIFY_SIGNATURES === 'false') {
    return true;
  }

  if (!SNS_SIGNING_CERT_URL_PATTERN.test(message.SigningCertURL)) {
    console.error('[SNS] Invalid signing cert URL:', message.SigningCertURL);
    return false;
  }

  try {
    const certRes = await fetch(message.SigningCertURL);
    if (!certRes.ok) return false;
    const cert = await certRes.text();

    const fieldsToSign = message.Type === 'Notification'
      ? ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];

    const stringToSign = fieldsToSign
      .filter(key => (message as any)[key] !== undefined)
      .map(key => `${key}\n${(message as any)[key]}`)
      .join('\n') + '\n';

    const verify = createVerify('SHA1');
    verify.update(stringToSign);
    return verify.verify(cert, message.Signature, 'base64');
  } catch (err) {
    console.error('[SNS] Signature verification error:', err);
    return false;
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') || '';

  if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
    return Response.json({ error: 'Invalid content type' }, { status: 400 });
  }

  let snsMessage: SNSMessage;
  try {
    const body = await request.text();
    snsMessage = JSON.parse(body);
  } catch (err) {
    console.error('[SNS] Failed to parse body:', err);
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const isValid = await verifySNSSignature(snsMessage);
  if (!isValid) {
    console.error('[SNS] Invalid signature');
    return Response.json({ error: 'Invalid signature' }, { status: 403 });
  }

  if (snsMessage.Type === 'SubscriptionConfirmation') {
    if (snsMessage.SubscribeURL) {
      try {
        const confirmRes = await fetch(snsMessage.SubscribeURL);
        if (confirmRes.ok) {
          console.log('[SNS] Subscription confirmed for:', snsMessage.TopicArn);
          return Response.json({ status: 'subscription_confirmed' });
        }
      } catch (err) {
        console.error('[SNS] Failed to confirm subscription:', err);
      }
    }
    return Response.json({ error: 'Subscription confirmation failed' }, { status: 500 });
  }

  if (snsMessage.Type === 'UnsubscribeConfirmation') {
    console.log('[SNS] Unsubscribe confirmation received');
    return Response.json({ status: 'unsubscribed' });
  }

  if (snsMessage.Type !== 'Notification') {
    return Response.json({ error: 'Unknown message type' }, { status: 400 });
  }

  let smsData: SMSMessage;
  try {
    smsData = JSON.parse(snsMessage.Message);
  } catch {
    console.error('[SNS] Failed to parse SMS message');
    return Response.json({ error: 'Invalid SMS message format' }, { status: 400 });
  }

  const from = smsData.originationNumber;
  const text = smsData.messageBody?.trim() || '';
  const messageSid = smsData.inboundMessageId;

  if (!from || !text) {
    return Response.json({ error: 'Missing from or text' }, { status: 400 });
  }

  if (messageSid) {
    const [existing] = await sql`
      SELECT id FROM audit_logs
      WHERE action = 'sms_inbound' AND payload->>'messageSid' = ${messageSid}
      LIMIT 1
    `;
    if (existing) {
      console.log('[SNS] Duplicate message, skipping:', messageSid);
      return Response.json({ status: 'duplicate' });
    }
  }

  console.log('[SNS] Inbound SMS received', { from, messageSid });

  const upperText = text.toUpperCase().trim();
  const isStop = isOptOutMessage(text);

  if (isStop) {
    await registerOptOut(from, 'sms', upperText);
    await cancelCadence(from);
    const leadId = await resolveLeadIdByPhone(from);
    if (leadId) {
      await recordStageTransition({
        leadId,
        fromStage: null,
        toStage: 'CLOSED_LOST',
        channel: 'sms',
        metadata: { reason: 'opt_out' },
      });
    }
    await logEvent('sms_opt_out', from, 'sns_inbound', { keyword: upperText, messageSid });
    return Response.json({ status: 'opted_out' });
  }

  const humanDetection = detectHumanRequest(text);
  if (humanDetection.isHumanRequest) {
    const humanLeadId = await resolveLeadIdByPhone(from);
    if (humanLeadId) {
      const [humanLead] = await sql`SELECT organization_id FROM leads WHERE id = ${humanLeadId}`;
      if (humanLead) {
        await handleHumanRequest(
          Number(humanLeadId) || 0,
          messageSid || crypto.randomUUID(),
          text,
          humanLead.organization_id,
          humanDetection
        );
      }
    }
    await logEvent('human_request', from, 'sns_inbound', { text, messageSid });
    return Response.json({ status: 'human_requested' });
  }

  const [lead] = await sql`
    SELECT l.id, l.name, l.organization_id, clq.campaign_id
    FROM leads l
    LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
    WHERE l.phone = ${from}
    ORDER BY l.updated_at DESC
    LIMIT 1
  `;

  if (lead) {
    await recordReplyReceived(lead.id, 'sms');

    await sql`
      INSERT INTO message_events (lead_id, direction, channel, body, status, external_id, created_at)
      VALUES (${lead.id}, 'inbound', 'sms', ${text}, 'received', ${messageSid}, now())
    `;

    await enqueueJob('ai_reply', {
      leadId: lead.id,
      from,
      text,
      channel: 'sms',
      organizationId: lead.organization_id,
    }, { maxAttempts: 3 });

    await logEvent('sms_inbound', from, 'sns_inbound', {
      leadId: lead.id,
      text: text.slice(0, 100),
      messageSid,
    });

    await recordRun({
      task: 'sns_inbound',
      flow: 'ai_reply_enqueued',
      step: 'process',
      status: 'pass',
      detail: JSON.stringify({ leadId: lead.id, messageSid }),
    });

    return Response.json({ status: 'processed', leadId: lead.id });
  }

  await logEvent('sms_inbound_unknown', from, 'sns_inbound', {
    text: text.slice(0, 100),
    messageSid,
  });

  return Response.json({ status: 'no_matching_lead' });
}

export async function GET() {
  return Response.json({
    provider: 'aws-sns',
    status: 'ready',
    note: 'POST inbound SMS messages to this endpoint',
  });
}
