/**
 * SMS Outreach Engine - AWS SNS Integration for Pipeline
 *
 * Integrates AWS SNS SMS into the campaign outreach pipeline alongside email.
 * Supports multi-channel sequences: Email → SMS → Email → SMS escalation.
 *
 * Cost: ~$0.00645/SMS (AWS SNS) vs $0.0079+ (Twilio)
 */

import { SNSClient, PublishCommand, CheckIfPhoneNumberIsOptedOutCommand } from '@aws-sdk/client-sns';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';

const snsClient = new SNSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export interface SMSOutreachParams {
  to: string;
  message: string;
  leadId: string | number;
  campaignId?: string | number;
  organizationId: string;
  contactId?: string | number;
  channel: 'seller' | 'buyer';
  touchNumber?: number;
  transactional?: boolean;
}

export interface SMSOutreachResult {
  success: boolean;
  messageId?: string;
  status: 'sent' | 'failed' | 'opted_out' | 'invalid_number' | 'rate_limited';
  provider: 'aws-sns' | 'twilio' | 'mock';
  errorMessage?: string;
  costCents?: number;
}

export async function sendPipelineSMS(params: SMSOutreachParams): Promise<SMSOutreachResult> {
  const { to, message, leadId, campaignId, organizationId, contactId, channel, touchNumber = 1, transactional = false } = params;

  // Format phone to E.164
  let phone = to.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) {
    phone = '+1' + phone;
  }

  // Validate phone format
  if (phone.length < 11 || phone.length > 15) {
    return {
      success: false,
      status: 'invalid_number',
      provider: 'aws-sns',
      errorMessage: 'Invalid phone number format',
    };
  }

  // Check opt-out status
  const isOptedOut = await checkOptOut(phone);
  if (isOptedOut) {
    await logEvent('sms_skipped_optout', 'lead', String(leadId), { phone, channel }, organizationId);
    return {
      success: false,
      status: 'opted_out',
      provider: 'aws-sns',
      errorMessage: 'Phone number opted out of SMS',
    };
  }

  // Check rate limits (max 1 SMS per lead per hour for non-transactional)
  if (!transactional) {
    const rateLimited = await checkRateLimit(String(leadId), organizationId);
    if (rateLimited) {
      return {
        success: false,
        status: 'rate_limited',
        provider: 'aws-sns',
        errorMessage: 'Rate limit exceeded - 1 SMS/lead/hour',
      };
    }
  }

  // Check if AWS SNS is configured
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log(`[MOCK SMS] To: ${phone} | ${message.slice(0, 50)}...`);
    return {
      success: true,
      messageId: `mock_${Date.now()}`,
      status: 'sent',
      provider: 'mock',
      costCents: 0,
    };
  }

  try {
    const result = await snsClient.send(new PublishCommand({
      PhoneNumber: phone,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: transactional ? 'Transactional' : 'Promotional',
        },
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: process.env.SMS_SENDER_ID || 'DealFlow',
        },
      },
    }));

    // Record in message_events
    await sql`
      INSERT INTO message_events (
        id, organization_id, campaign_id, contact_id, direction, status,
        provider, provider_message_id, channel, metadata
      ) VALUES (
        ${crypto.randomUUID()},
        ${organizationId},
        ${campaignId || null},
        ${contactId || null},
        'outbound',
        'sent',
        'aws-sns',
        ${result.MessageId || null},
        'sms',
        ${JSON.stringify({ phone, leadId, touchNumber, channel })}
      )
    `.catch(console.error);

    await logEvent('sms_sent', 'lead', String(leadId), {
      messageId: result.MessageId,
      phone,
      channel,
      touchNumber,
      provider: 'aws-sns',
    }, organizationId);

    return {
      success: true,
      messageId: result.MessageId,
      status: 'sent',
      provider: 'aws-sns',
      costCents: 0.645, // AWS SNS cost per SMS
    };
  } catch (err: any) {
    console.error('[SMS] AWS SNS error:', err.message);

    await logEvent('sms_failed', 'lead', String(leadId), {
      error: err.message,
      phone,
      channel,
    }, organizationId);

    return {
      success: false,
      status: 'failed',
      provider: 'aws-sns',
      errorMessage: err.message,
    };
  }
}

async function checkOptOut(phone: string): Promise<boolean> {
  try {
    const result = await snsClient.send(new CheckIfPhoneNumberIsOptedOutCommand({
      phoneNumber: phone,
    }));
    return result.isOptedOut === true;
  } catch {
    return false;
  }
}

async function checkRateLimit(leadId: string, organizationId: string): Promise<boolean> {
  const [recent] = await sql`
    SELECT COUNT(*)::int as count
    FROM message_events
    WHERE metadata->>'leadId' = ${leadId}
      AND channel = 'sms'
      AND created_at > now() - interval '1 hour'
  `.catch(() => [{ count: 0 }]);

  return (recent?.count || 0) >= 1;
}

/**
 * Queue SMS for pipeline outreach
 */
export async function queuePipelineSMS(params: SMSOutreachParams): Promise<string | null> {
  return enqueueJob('send_pipeline_sms', params, {
    maxAttempts: 3,
    dedupeKey: `sms_${params.leadId}_${params.touchNumber || 1}`,
  });
}

/**
 * Get SMS analytics for organization
 */
export async function getSMSAnalytics(organizationId: string, days: number = 30) {
  const stats = await sql`
    SELECT
      COUNT(*)::int as total_sent,
      COUNT(*) FILTER (WHERE status = 'sent')::int as delivered,
      COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
      COUNT(*) FILTER (WHERE metadata->>'channel' = 'seller')::int as seller_sms,
      COUNT(*) FILTER (WHERE metadata->>'channel' = 'buyer')::int as buyer_sms,
      COALESCE(SUM(0.00645), 0)::numeric(10,2) as estimated_cost
    FROM message_events
    WHERE organization_id = ${organizationId}
      AND channel = 'sms'
      AND created_at > now() - (${days} || ' days')::interval
  `.catch(() => [{}]);

  return stats[0] || {};
}
