/**
 * SMS Driver - AWS SNS
 *
 * Uses your own AWS infrastructure instead of Twilio.
 * Cost: ~$0.015 per SMS (AWS SNS 10DLC with carrier fees)
 */
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

interface SendSMSParams {
  to: string;
  message: string;
  leadId?: string;
  transactional?: boolean;
}

interface SendSMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: 'aws-sns' | 'twilio' | 'mock';
}

export async function sendSMS(params: SendSMSParams): Promise<SendSMSResult> {
  const { to, message, transactional = false } = params;

  // Format phone number to E.164
  let phoneNumber = to.replace(/[^0-9+]/g, '');
  if (!phoneNumber.startsWith('+')) {
    phoneNumber = '+1' + phoneNumber; // Assume US
  }

  // Check if AWS SNS is enabled
  if (process.env.AWS_SNS_SMS_ENABLED === 'true' || process.env.AWS_ACCESS_KEY_ID) {
    try {
      const result = await snsClient.send(new PublishCommand({
        PhoneNumber: phoneNumber,
        Message: message,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: transactional ? 'Transactional' : 'Promotional'
          },
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: 'DealFlow'
          }
        }
      }));

      return {
        success: true,
        messageId: result.MessageId,
        provider: 'aws-sns'
      };
    } catch (err: any) {
      console.error('[AWS SNS] SMS error:', err.message);
      return {
        success: false,
        error: err.message,
        provider: 'aws-sns'
      };
    }
  }

  // Fallback to Twilio if configured
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: phoneNumber,
          From: process.env.TWILIO_PHONE_NUMBER || process.env.OWNER_NUMBER || '',
          Body: message,
          ...(process.env.TWILIO_MESSAGING_SERVICE_SID ? { MessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID } : {}),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        return {
          success: true,
          messageId: data.sid,
          provider: 'twilio'
        };
      } else {
        return {
          success: false,
          error: data.message || 'Twilio error',
          provider: 'twilio'
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        provider: 'twilio'
      };
    }
  }

  // Mock mode
  console.log(`[MOCK SMS] To: ${phoneNumber} | Message: ${message.slice(0, 50)}...`);
  return {
    success: true,
    messageId: `mock_${Date.now()}`,
    provider: 'mock'
  };
}

export function getSMSProvider(): string {
  if (process.env.AWS_SNS_SMS_ENABLED === 'true' || process.env.AWS_ACCESS_KEY_ID) return 'aws-sns';
  if (process.env.TWILIO_ACCOUNT_SID) return 'twilio';
  return 'mock';
}
