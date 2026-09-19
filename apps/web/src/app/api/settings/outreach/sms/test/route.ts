/**
 * Test SMS sending endpoint.
 *
 * Sends a test SMS using the provided configuration to verify it works.
 * Does not save the configuration - just tests it.
 */
import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
// Rate limiting is done via audit_logs for test-specific daily limits
import sql from '@/app/api/utils/sql';

interface TestSmsRequest {
  to: string;
  config: {
    provider: 'platform' | 'twilio' | 'sns';
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    twilioPhoneNumber?: string;
    twilioMessagingServiceSid?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsRegion?: string;
  };
}

function formatPhoneNumber(phone: string): string {
  // Remove all non-numeric characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // If no + prefix and looks like a US number, add +1
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    } else {
      cleaned = '+1' + cleaned;
    }
  }

  return cleaned;
}

async function sendTestWithTwilio(config: TestSmsRequest['config'], to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');

    const formData = new URLSearchParams({
      To: formatPhoneNumber(to),
      Body: 'DealFlow AI - Test Message\n\nIf you received this, your SMS configuration is working correctly!',
      ...(config.twilioMessagingServiceSid
        ? { MessagingServiceSid: config.twilioMessagingServiceSid }
        : { From: config.twilioPhoneNumber || '' }),
    });

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, messageId: data.sid };
    } else {
      return { success: false, error: data.message || `Twilio error: ${response.status}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function sendTestWithSNS(config: TestSmsRequest['config'], to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const { SNSClient, PublishCommand } = await import('@aws-sdk/client-sns');

    const client = new SNSClient({
      region: config.awsRegion || 'us-east-1',
      credentials: {
        accessKeyId: config.awsAccessKeyId!,
        secretAccessKey: config.awsSecretAccessKey!,
      },
    });

    const command = new PublishCommand({
      PhoneNumber: formatPhoneNumber(to),
      Message: 'DealFlow AI - Test Message\n\nIf you received this, your SMS configuration is working correctly!',
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: 'Transactional',
        },
        'AWS.SNS.SMS.SenderID': {
          DataType: 'String',
          StringValue: 'DealFlow',
        },
      },
    });

    const response = await client.send(command);
    return { success: true, messageId: response.MessageId };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function sendTestWithPlatform(to: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // Platform SMS uses the environment-configured provider
  try {
    const { sendSMS } = await import('@/app/api/services/smsDriver');

    const result = await sendSMS({
      to: formatPhoneNumber(to),
      message: 'DealFlow AI - Test Message\n\nIf you received this, your SMS configuration is working correctly!',
      transactional: true,
    });

    if (result.success) {
      return { success: true, messageId: result.messageId };
    }
    return { success: false, error: result.error || 'Failed to send' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

const TEST_SMS_LIMIT_PER_DAY = 5;

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'Organization not found' }, { status: 403 });
  }

  // Rate limit: 5 test SMS per user per day
  const [todayCount] = await sql`
    SELECT COUNT(*) as count FROM audit_logs
    WHERE user_id = ${session.userId}
      AND action = 'outreach_sms_test'
      AND created_at > NOW() - INTERVAL '24 hours'
  `;
  if (Number(todayCount?.count || 0) >= TEST_SMS_LIMIT_PER_DAY) {
    return Response.json(
      { error: `Test SMS limit reached (${TEST_SMS_LIMIT_PER_DAY}/day). Try again tomorrow.` },
      { status: 429 }
    );
  }

  try {
    const body = await request.json() as TestSmsRequest;

    if (!body.to || !body.config) {
      return Response.json({ error: 'Missing required fields: to, config' }, { status: 400 });
    }

    // Basic phone validation
    const cleanedPhone = body.to.replace(/[^\d+]/g, '');
    if (cleanedPhone.length < 10) {
      return Response.json({ error: 'Invalid phone number' }, { status: 400 });
    }

    const { config, to } = body;
    let result: { success: boolean; messageId?: string; error?: string };

    switch (config.provider) {
      case 'twilio':
        if (!config.twilioAccountSid || !config.twilioAuthToken) {
          return Response.json({ error: 'Twilio credentials are required' }, { status: 400 });
        }
        if (!config.twilioPhoneNumber && !config.twilioMessagingServiceSid) {
          return Response.json({ error: 'Twilio phone number or Messaging Service SID is required' }, { status: 400 });
        }
        result = await sendTestWithTwilio(config, to);
        break;

      case 'sns':
        if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
          return Response.json({ error: 'AWS credentials are required for SNS' }, { status: 400 });
        }
        result = await sendTestWithSNS(config, to);
        break;

      case 'platform':
      default:
        result = await sendTestWithPlatform(to);
        break;
    }

    // Log the test (mask phone number)
    const maskedPhone = to.replace(/(\d{3})\d{4}(\d{3,4})/, '$1****$2');
    await logEvent(
      'outreach_sms_test',
      'user',
      session.userId,
      {
        provider: config.provider,
        to: maskedPhone,
        success: result.success,
        error: result.error,
      },
      session.userId
    );

    if (!result.success) {
      return Response.json({ error: result.error || 'Failed to send test SMS' }, { status: 400 });
    }

    return Response.json({
      success: true,
      messageId: result.messageId,
      message: 'Test SMS sent successfully',
    });
  } catch (error: any) {
    console.error('[SmsTest] Error:', error);
    return Response.json({ error: error.message || 'Failed to send test SMS' }, { status: 500 });
  }
}
