/**
 * AWS RCS (Rich Communication Services) Driver
 *
 * Benefits over 10DLC SMS:
 * - No complicated registration (carrier-level approval)
 * - Rich media support (images, buttons, carousels)
 * - Read receipts and typing indicators
 * - No CPaaS markup: $70-90 per 10K vs $150+ for SMS
 * - Pay only for delivered messages
 *
 * Cost breakdown:
 * - AWS transport fee: ~$0.001-0.003/msg
 * - Carrier surcharges: $0.003-0.009/msg (AT&T, T-Mobile, Verizon)
 * - Total: ~$0.004-0.012/msg vs $0.0079+ for SMS
 *
 * Fallback: If RCS fails, falls back to SMS (may charge for both)
 */

import {
  PinpointClient,
  SendMessagesCommand,
  GetChannelCommand
} from '@aws-sdk/client-pinpoint';

interface RCSMessage {
  to: string;
  text: string;
  mediaUrl?: string;
  suggestions?: Array<{
    type: 'reply' | 'action';
    text: string;
    postbackData?: string;
    url?: string;
  }>;
  leadId?: string;
  fallbackToSMS?: boolean;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  channel: 'rcs' | 'sms' | 'mock';
  cost?: number;
  error?: string;
}

const pinpointClient = new PinpointClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Estimated costs per message
const COSTS = {
  rcs: 0.007,      // AWS + carrier avg
  sms: 0.0079,     // SMS fallback
  smsFallback: 0.015, // RCS attempt + SMS fallback
};

export async function sendRCSMessage(params: RCSMessage): Promise<SendResult> {
  const { to, text, mediaUrl, suggestions, fallbackToSMS = true } = params;

  // Format phone to E.164
  let phoneNumber = to.replace(/[^0-9+]/g, '');
  if (!phoneNumber.startsWith('+')) {
    phoneNumber = '+1' + phoneNumber;
  }

  // Check if AWS RCS is configured
  const appId = process.env.AWS_PINPOINT_APP_ID;
  const rcsAgentId = process.env.AWS_RCS_AGENT_ID;

  if (!appId || !rcsAgentId) {
    // Mock mode
    console.log(`[MOCK RCS] To: ${phoneNumber} | Message: ${text.slice(0, 50)}...`);
    return {
      success: true,
      messageId: `mock_rcs_${Date.now()}`,
      channel: 'mock',
      cost: 0,
    };
  }

  try {
    // Build RCS message
    const rcsContent: any = {
      text,
    };

    if (mediaUrl) {
      rcsContent.media = {
        fileUri: mediaUrl,
        height: 'MEDIUM',
      };
    }

    if (suggestions && suggestions.length > 0) {
      rcsContent.suggestions = suggestions.map(s => {
        if (s.type === 'reply') {
          return {
            reply: {
              text: s.text,
              postbackData: s.postbackData || s.text,
            },
          };
        } else {
          return {
            action: {
              text: s.text,
              openUrlAction: { url: s.url },
            },
          };
        }
      });
    }

    const response = await pinpointClient.send(new SendMessagesCommand({
      ApplicationId: appId,
      MessageRequest: {
        Addresses: {
          [phoneNumber]: {
            ChannelType: 'RCS',
          },
        },
        MessageConfiguration: {
          RCSMessage: {
            RCSBusinessMessagingMessage: {
              ContentMessage: {
                ContentType: 'text',
                RichCard: undefined,
                Text: text,
              },
            },
          },
        },
      },
    }));

    const result = response.MessageResponse?.Result?.[phoneNumber];

    if (result?.DeliveryStatus === 'SUCCESSFUL') {
      return {
        success: true,
        messageId: result.MessageId,
        channel: 'rcs',
        cost: COSTS.rcs,
      };
    }

    // RCS failed, try SMS fallback
    if (fallbackToSMS && result?.DeliveryStatus !== 'SUCCESSFUL') {
      console.log(`[RCS] Failed for ${phoneNumber}, falling back to SMS`);

      const smsResponse = await pinpointClient.send(new SendMessagesCommand({
        ApplicationId: appId,
        MessageRequest: {
          Addresses: {
            [phoneNumber]: {
              ChannelType: 'SMS',
            },
          },
          MessageConfiguration: {
            SMSMessage: {
              Body: text,
              MessageType: 'TRANSACTIONAL',
            },
          },
        },
      }));

      const smsResult = smsResponse.MessageResponse?.Result?.[phoneNumber];

      return {
        success: smsResult?.DeliveryStatus === 'SUCCESSFUL',
        messageId: smsResult?.MessageId,
        channel: 'sms',
        cost: COSTS.smsFallback, // Charged for both attempts
        error: smsResult?.StatusMessage,
      };
    }

    return {
      success: false,
      channel: 'rcs',
      error: result?.StatusMessage || 'RCS send failed',
    };

  } catch (err: any) {
    console.error('[RCS] Error:', err.message);
    return {
      success: false,
      channel: 'rcs',
      error: err.message,
    };
  }
}

export function getRCSCostEstimate(messageCount: number, failureRate: number = 0.1): {
  rcsCost: number;
  smsFallbackCost: number;
  totalCost: number;
  savingsVsSMS: number;
} {
  const successfulRCS = messageCount * (1 - failureRate);
  const fallbackSMS = messageCount * failureRate;

  const rcsCost = successfulRCS * COSTS.rcs;
  const smsFallbackCost = fallbackSMS * COSTS.smsFallback;
  const totalCost = rcsCost + smsFallbackCost;

  const pureSMSCost = messageCount * COSTS.sms;
  const savingsVsSMS = pureSMSCost - totalCost;

  return {
    rcsCost: Math.round(rcsCost * 100) / 100,
    smsFallbackCost: Math.round(smsFallbackCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    savingsVsSMS: Math.round(savingsVsSMS * 100) / 100,
  };
}
