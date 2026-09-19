/**
 * SMS Channel Driver
 *
 * Adapter that wraps the existing smsDriver to conform to the ChannelDriver interface.
 */
import type { ChannelDriver, SendOptions, SendResult, MessageStatus } from '../types';
import { sendSMS, getSMSProvider } from '../../smsDriver';

export class SMSChannelDriver implements ChannelDriver {
  readonly channel = 'sms' as const;

  get provider(): string {
    return getSMSProvider();
  }

  async send(options: SendOptions): Promise<SendResult> {
    const result = await sendSMS({
      to: options.to,
      message: options.content,
      leadId: options.contactId,
      transactional: options.priority === 'high',
    });

    return {
      success: result.success,
      messageId: result.messageId,
      provider: result.provider,
      status: result.success ? 'sent' : 'failed',
      error: result.error,
    };
  }

  async getStatus(messageId: string): Promise<MessageStatus> {
    // SMS providers typically don't support real-time status lookup
    // without webhook integration. Return 'sent' as default for now.
    // Real implementation would query the provider's API or check
    // a local database of delivery status updates.

    if (messageId.startsWith('mock_')) {
      return 'delivered';
    }

    // For AWS SNS and Twilio, status is typically received via webhooks
    // This would need to be enhanced with a message status table
    return 'sent';
  }

  async cancel(messageId: string): Promise<boolean> {
    // SMS messages are typically sent immediately and cannot be cancelled
    // unless they're in a scheduled queue
    console.log(`[SMSChannelDriver] Cancel not supported for message: ${messageId}`);
    return false;
  }

  async isHealthy(): Promise<boolean> {
    const provider = this.provider;

    // Check if required credentials are configured
    if (provider === 'aws-sns') {
      return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
    }

    if (provider === 'twilio') {
      return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    }

    // Mock provider is always healthy
    return true;
  }
}

// Singleton instance
export const smsChannelDriver = new SMSChannelDriver();
