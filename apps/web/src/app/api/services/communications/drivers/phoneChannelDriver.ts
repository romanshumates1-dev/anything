/**
 * Phone Channel Driver
 *
 * Adapter that wraps the phoneDriver to conform to the ChannelDriver interface.
 */
import type { ChannelDriver, SendOptions, SendResult, MessageStatus } from '../types';
import {
  makeCall,
  getCallStatus,
  cancelCall,
  getConfiguredProvider,
  type CallStatus,
} from '../../phoneDriver';

export class PhoneChannelDriver implements ChannelDriver {
  readonly channel = 'phone' as const;

  get provider(): string {
    return getConfiguredProvider();
  }

  async send(options: SendOptions): Promise<SendResult> {
    const result = await makeCall({
      to: options.to,
      message: options.content,
      leadId: options.contactId,
      campaignId: options.campaignId,
      callbackUrl: options.metadata?.callbackUrl as string,
      timeout: options.metadata?.timeout as number,
      machineDetection: options.metadata?.machineDetection as boolean,
      record: options.metadata?.record as boolean,
    });

    return {
      success: result.success,
      messageId: result.callId,
      provider: result.provider,
      status: mapCallStatus(result.status),
      error: result.error,
      cost: result.cost,
    };
  }

  async getStatus(messageId: string): Promise<MessageStatus> {
    const details = await getCallStatus(messageId);

    if (!details) {
      return 'pending';
    }

    return mapCallStatus(details.status);
  }

  async cancel(messageId: string): Promise<boolean> {
    return cancelCall(messageId);
  }

  async isHealthy(): Promise<boolean> {
    const provider = this.provider;

    // Check if required credentials are configured
    switch (provider) {
      case 'twilio':
        return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
      case 'aws-connect':
        return !!(process.env.AWS_CONNECT_INSTANCE_ID && process.env.AWS_ACCESS_KEY_ID);
      case 'mock':
        return true;
      default:
        return true; // Mock provider is always available
    }
  }
}

/**
 * Map call status to MessageStatus.
 */
function mapCallStatus(status: CallStatus): MessageStatus {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'ringing':
      return 'sending';
    case 'in-progress':
      return 'sending';
    case 'completed':
      return 'delivered';
    case 'busy':
    case 'no-answer':
      return 'failed';
    case 'failed':
      return 'failed';
    case 'canceled':
      return 'failed';
    default:
      return 'pending';
  }
}

// Singleton instance
export const phoneChannelDriver = new PhoneChannelDriver();
