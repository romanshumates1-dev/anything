/**
 * POST /api/outreach/verify/sms/resend
 *
 * Resend the verification code to the user's phone.
 */

import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import {
  resendVerificationCode,
  getVerificationStatus,
  getCredentials,
  SmsCredentials,
} from '@/app/api/utils/outreachVerification';
import { logEvent } from '@/app/api/utils/logger';

export async function POST(_request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    // Get current verification to retrieve credentials
    const verification = await getVerificationStatus(organization.id, 'sms');

    if (!verification) {
      return Response.json(
        { error: 'No verification in progress. Please start verification first.' },
        { status: 400 }
      );
    }

    if (verification.provider === 'platform') {
      return Response.json(
        { error: 'Platform SMS does not require verification code.' },
        { status: 400 }
      );
    }

    // Generate new code
    const result = await resendVerificationCode(organization.id, session.userId);

    if (!result) {
      return Response.json(
        { error: 'Failed to generate new verification code.' },
        { status: 400 }
      );
    }

    // Get credentials to send the SMS
    const credentials = await getCredentials(verification.id) as SmsCredentials | null;

    if (!credentials) {
      return Response.json(
        { error: 'Credentials not found. Please restart verification.' },
        { status: 400 }
      );
    }

    // Send the verification SMS
    let sendSuccess = false;
    let sendError = '';

    if (verification.provider === 'twilio') {
      try {
        const twilio = await import('twilio');
        const client = twilio.default(credentials.twilioAccountSid, credentials.twilioAuthToken);

        await client.messages.create({
          body: `Your DealFlow AI verification code is: ${result.code}. This code expires in 15 minutes.`,
          from: credentials.twilioPhoneNumber || credentials.twilioMessagingServiceSid,
          to: result.phoneNumber,
        });

        sendSuccess = true;
      } catch (error: any) {
        sendError = error.message;
      }
    } else if (verification.provider === 'aws_sns') {
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
            PhoneNumber: result.phoneNumber,
            Message: `Your DealFlow AI verification code is: ${result.code}. This code expires in 15 minutes.`,
            MessageAttributes: {
              'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Transactional',
              },
            },
          })
        );

        sendSuccess = true;
      } catch (error: any) {
        sendError = error.message;
      }
    }

    if (!sendSuccess) {
      return Response.json(
        { error: 'Failed to send verification SMS', message: sendError },
        { status: 500 }
      );
    }

    await logEvent(
      'sms_verification_code_resent',
      'outreach_verification',
      organization.id,
      { phoneNumber: result.phoneNumber },
      session.userId
    );

    return Response.json({
      success: true,
      message: `Verification code sent to ${result.phoneNumber}. Check your phone.`,
    });
  } catch (error: any) {
    console.error('[SMS Resend] Error:', error);
    return Response.json(
      { error: 'Failed to resend verification code', message: error.message },
      { status: 500 }
    );
  }
}
