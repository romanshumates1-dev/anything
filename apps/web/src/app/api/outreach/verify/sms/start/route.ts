/**
 * POST /api/outreach/verify/sms/start
 *
 * Start SMS verification process:
 * 1. Validate credentials
 * 2. Generate verification code
 * 3. Send code to the user's phone number
 * 4. Store verification record
 */

import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import {
  startSmsVerification,
  SmsCredentials,
  SmsProvider,
} from '@/app/api/utils/outreachVerification';
import { logEvent } from '@/app/api/utils/logger';

// Twilio client for sending verification SMS
async function sendVerificationSms(
  credentials: SmsCredentials,
  provider: SmsProvider,
  phoneNumber: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  if (provider === 'platform') {
    // Platform uses our infrastructure - handled separately
    return { success: true };
  }

  if (provider === 'twilio') {
    try {
      // Dynamic import to avoid bundling issues
      const twilio = await import('twilio');
      const client = twilio.default(credentials.twilioAccountSid, credentials.twilioAuthToken);

      await client.messages.create({
        body: `Your DealFlow AI verification code is: ${code}. This code expires in 15 minutes.`,
        from: credentials.twilioPhoneNumber || credentials.twilioMessagingServiceSid,
        to: phoneNumber,
      });

      return { success: true };
    } catch (error: any) {
      console.error('[SMS Verification] Twilio error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send verification SMS via Twilio',
      };
    }
  }

  if (provider === 'aws_sns') {
    try {
      const { SNSClient, PublishCommand } = await import('@aws-sdk/client-sns');

      const snsClient = new SNSClient({
        region: credentials.awsRegion || 'us-east-1',
        credentials: {
          accessKeyId: credentials.awsAccessKeyId!,
          secretAccessKey: credentials.awsSecretAccessKey!,
        },
      });

      await snsClient.send(
        new PublishCommand({
          PhoneNumber: phoneNumber,
          Message: `Your DealFlow AI verification code is: ${code}. This code expires in 15 minutes.`,
          MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
              DataType: 'String',
              StringValue: 'Transactional',
            },
          },
        })
      );

      return { success: true };
    } catch (error: any) {
      console.error('[SMS Verification] AWS SNS error:', error);
      return {
        success: false,
        error: error.message || 'Failed to send verification SMS via AWS SNS',
      };
    }
  }

  return { success: false, error: 'Unsupported provider' };
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { provider, credentials, phoneNumber } = body;

    // Validate required fields
    if (!provider) {
      return Response.json({ error: 'Provider is required' }, { status: 400 });
    }

    if (provider !== 'platform' && !phoneNumber) {
      return Response.json({ error: 'Phone number is required for BYOP' }, { status: 400 });
    }

    // Validate provider-specific credentials
    if (provider === 'twilio') {
      if (!credentials?.twilioAccountSid || !credentials?.twilioAuthToken) {
        return Response.json(
          { error: 'Twilio Account SID and Auth Token are required' },
          { status: 400 }
        );
      }
      if (!credentials?.twilioPhoneNumber && !credentials?.twilioMessagingServiceSid) {
        return Response.json(
          { error: 'Twilio Phone Number or Messaging Service SID is required' },
          { status: 400 }
        );
      }
    }

    if (provider === 'aws_sns') {
      if (!credentials?.awsAccessKeyId || !credentials?.awsSecretAccessKey) {
        return Response.json(
          { error: 'AWS Access Key ID and Secret Access Key are required' },
          { status: 400 }
        );
      }
    }

    // Start verification process
    const result = await startSmsVerification(
      organization.id,
      provider as SmsProvider,
      credentials || {},
      phoneNumber || 'platform',
      session.userId
    );

    // For BYOP, send the verification code via their provider
    if (provider !== 'platform' && result.success && result.status === 'VERIFYING') {
      // Get the code from the verification record (it's stored there)
      const verificationCode = await getVerificationCode(organization.id);

      if (verificationCode) {
        const sendResult = await sendVerificationSms(
          credentials,
          provider as SmsProvider,
          phoneNumber,
          verificationCode
        );

        if (!sendResult.success) {
          return Response.json(
            {
              error: 'credentials_invalid',
              message: sendResult.error || 'Failed to send verification SMS. Please check your credentials.',
            },
            { status: 400 }
          );
        }
      }
    }

    await logEvent(
      'sms_verification_started',
      'outreach_verification',
      organization.id,
      { provider, status: result.status },
      session.userId
    );

    return Response.json(result);
  } catch (error: any) {
    console.error('[SMS Verification Start] Error:', error);
    return Response.json(
      { error: 'Failed to start SMS verification', message: error.message },
      { status: 500 }
    );
  }
}

// Helper to get the verification code (for internal use only)
async function getVerificationCode(organizationId: string): Promise<string | null> {
  const { default: sql } = await import('@/app/api/utils/sql');

  const [row] = await sql`
    SELECT verification_code FROM outreach_verifications
    WHERE organization_id = ${organizationId}::uuid AND channel = 'sms'
  `;

  return row?.verification_code || null;
}
