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
import { recordStageTransitionsBulk, resolveLeadIdsByPhoneGlobal } from '../../services/stageTransitionRecorder';

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
  // FAIL CLOSED BY DEFAULT (fixed 2026-09-26 re-review): the old gate was
  // `if (!process.env.AWS_SNS_VERIFY_SIGNATURES || === 'false') return true;`
  // — an UNSET variable silently disabled verification, so anyone could POST
  // a forged SNS Notification to /api/sms/sns-inbound and inject inbound SMS
  // (opt-outs, negotiation jobs). .env.example and DEPLOY.md both document
  // the default as `true`; the code now matches them. Verification only runs
  // when explicitly disabled with AWS_SNS_VERIFY_SIGNATURES=false (local
  // development without network access to AWS signing certs).
  if (process.env.AWS_SNS_VERIFY_SIGNATURES === 'false') {
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
    // registerOptOut above is platform-wide by design, so attribution is symmetric:
    // every lead holding this number gets the closed-lost event, rather than one
    // arbitrary tenant chosen by ORDER BY updated_at DESC.
    const optOutLeadIds = await resolveLeadIdsByPhoneGlobal(from);
    if (optOutLeadIds.length) {
      await recordStageTransitionsBulk(optOutLeadIds, 'CLOSED_LOST', {
        channel: 'sms',
        reason: 'opt_out',
      });
    }
    await logEvent('sms_opt_out', from, 'sns_inbound', { keyword: upperText, messageSid });
    return Response.json({ status: 'opted_out' });
  }

  const humanDetection = detectHumanRequest(text);
  if (humanDetection.isHumanRequest) {
    // TENANT ISOLATION: a stranger texting the platform must not be able to pick
    // which tenant acts on it. Previously this resolved ONE arbitrary lead, read that
    // lead's organization_id, and ran handleHumanRequest inside that tenant - an
    // unauthenticated cross-tenant write. Attribution is now acted on only when it is
    // UNAMBIGUOUS (exactly one lead). With several matches we log and skip the tenant
    // action rather than silently choosing one.
    const humanLeadIds = await resolveLeadIdsByPhoneGlobal(from);
    if (humanLeadIds.length === 1) {
      const humanLeadId = humanLeadIds[0];
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
    } else if (humanLeadIds.length > 1) {
      await logEvent('human_request_ambiguous', from, 'sns_inbound', {
        text,
        messageSid,
        matchCount: humanLeadIds.length,
      });
    }
    await logEvent('human_request', from, 'sns_inbound', { text, messageSid });
    return Response.json({ status: 'human_requested' });
  }

  // TENANT ISOLATION (independent-review fix): the general reply path must route by the
  // DESTINATION number through the platform's own send history — the same
  // server-trusted primitive the Twilio route uses — and NOT by sender phone. The old
  // code did `WHERE l.phone = from ORDER BY updated_at DESC LIMIT 1`: a number shared
  // by two tenants attributed the reply (AI job + conversation + message event) to
  // whichever tenant touched it last. destinationNumber is platform-observed metadata,
  // not caller-chosen identity, and the campaign join below binds the org explicitly.
  const destinationNumber = smsData.destinationNumber;
  let lead: { id: string; name: string; organization_id: string; campaign_id: string | null } | undefined;
  if (destinationNumber) {
    const [campaign] = await sql`
      SELECT cc.campaign_id AS "campaignId", c.organization_id AS "organizationId"
      FROM campaign_contacts cc
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE cc.phone = ${destinationNumber}
        AND c.status NOT IN ('cancelled', 'paused')
      ORDER BY cc.updated_at DESC
      LIMIT 1
    `;
    if (campaign) {
      const [matchedLead] = await sql`
        SELECT l.id, l.name, l.organization_id
        FROM leads l
        WHERE l.phone = ${from}
          AND l.organization_id = ${campaign.organizationId}
        ORDER BY l.updated_at DESC
        LIMIT 1
      `;
      lead = matchedLead
        ? {
            id: matchedLead.id,
            name: matchedLead.name,
            organization_id: matchedLead.organization_id,
            campaign_id: campaign.campaignId,
          }
        : undefined;
    }
  }

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
