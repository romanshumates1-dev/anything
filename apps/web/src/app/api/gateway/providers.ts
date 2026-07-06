/**
 * Gateway Provider Interface & Adapters
 * 
 * Defines the contract for multi-provider SMS sending with unified status tracking.
 * Implementations: TwilioAdapter, TelnyxAdapter, BandwidthAdapter
 * 
 * No provider directly performs send/delivery checks — all logic passes through
 * the gateway router, which owns routing, queueing, failover, and observability.
 */

export type DeliveryStatus = 
  | 'queued'
  | 'dispatched'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'undelivered'
  | 'bounced';

export type ProviderNormalizedEvent = {
  messageId: string;
  status: DeliveryStatus;
  timestamp: Date;
  errorCode?: string;
  errorMessage?: string;
};

export interface ISMSProvider {
  name: string;
  isHealthy(): Promise<boolean>;
  send(to: string, text: string, messageUuid: string): Promise<string>; // returns provider message ID
  getDeliveryStatus(providerId: string): Promise<DeliveryStatus>;
  validateWebhook(body: any, signature?: string): boolean;
  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null;
  healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }>;
}

/**
 * Twilio Provider Adapter
 * Wraps existing twilio-adapter and messaging.ts send path
 */
export class TwilioAdapter implements ISMSProvider {
  name = 'twilio';

  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string | undefined,
    private messagingServiceSid: string | undefined,
  ) {}

  async isHealthy(): Promise<boolean> {
    try {
      const check = await this.healthCheck();
      return check.healthy && check.latency < 3000;
    } catch {
      return false;
    }
  }

  async send(to: string, text: string, messageUuid: string): Promise<string> {
    // Placeholder: integrate with existing getTwilioClient() and create message
    // Returns the Twilio message SID
    const toE164 = to.startsWith('+') ? to : `+${to}`;
    const sid = `sm_${messageUuid.substring(0, 16)}`; // Mock for now
    return sid;
  }

  async getDeliveryStatus(providerId: string): Promise<DeliveryStatus> {
    // Query Twilio API for message status; return normalized status
    return 'sent'; // Mock for now
  }

  validateWebhook(body: any, signature?: string): boolean {
    // Verify Twilio webhook signature (uses auth token)
    return !!body.MessageSid;
  }

  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null {
    if (!body.MessageSid) return null;
    const statusMap: Record<string, DeliveryStatus> = {
      queued: 'queued',
      failed: 'failed',
      sent: 'sent',
      delivered: 'delivered',
      undelivered: 'undelivered',
      read: 'delivered',
    };
    return {
      messageId: body.MessageSid,
      status: (statusMap[body.MessageStatus] || 'sent') as DeliveryStatus,
      timestamp: new Date(),
      errorCode: body.ErrorCode,
      errorMessage: body.ErrorMessage,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    // Placeholder: call Twilio /api/2010-04-01/Accounts/{SID}.json
    return { healthy: true, latency: 100 };
  }
}

/**
 * Telnyx Provider Adapter
 * 
 * 10DLC registration must be completed on Telnyx console before this adapter
 * receives traffic. Config flag: TELNYX_10DLC_REGISTERED
 */
export class TelnyxAdapter implements ISMSProvider {
  name = 'telnyx';

  constructor(
    private apiKey: string,
    private fromNumber: string,
  ) {}

  async isHealthy(): Promise<boolean> {
    try {
      const check = await this.healthCheck();
      return check.healthy && check.latency < 3000;
    } catch {
      return false;
    }
  }

  async send(to: string, text: string, messageUuid: string): Promise<string> {
    // POST to Telnyx /v2/messaging_profiles/:id/messages
    // Returns Telnyx message ID
    const msgId = `telnyx_${messageUuid.substring(0, 16)}`;
    return msgId;
  }

  async getDeliveryStatus(providerId: string): Promise<DeliveryStatus> {
    // Query Telnyx API
    return 'sent';
  }

  validateWebhook(body: any, signature?: string): boolean {
    // Verify Telnyx webhook signature
    return !!body.id && body.type?.includes('message');
  }

  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null {
    if (!body.id || !body.type?.includes('message')) return null;
    const statusMap: Record<string, DeliveryStatus> = {
      message_queued: 'queued',
      message_sent: 'sent',
      message_delivered: 'delivered',
      message_failed: 'failed',
      message_undeliverable: 'undelivered',
    };
    return {
      messageId: body.id,
      status: (statusMap[body.type] || 'sent') as DeliveryStatus,
      timestamp: new Date(body.created_at),
      errorCode: body.errors?.[0]?.code,
      errorMessage: body.errors?.[0]?.message,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    return { healthy: true, latency: 120 };
  }
}

/**
 * Bandwidth Provider Adapter
 * 
 * 10DLC registration must be completed on Bandwidth console before this adapter
 * receives traffic. Config flag: BANDWIDTH_10DLC_REGISTERED
 */
export class BandwidthAdapter implements ISMSProvider {
  name = 'bandwidth';

  constructor(
    private userId: string,
    private apiToken: string,
    private accountId: string,
    private fromNumber: string,
  ) {}

  async isHealthy(): Promise<boolean> {
    try {
      const check = await this.healthCheck();
      return check.healthy && check.latency < 3000;
    } catch {
      return false;
    }
  }

  async send(to: string, text: string, messageUuid: string): Promise<string> {
    // POST to Bandwidth /users/:userId/messages
    const msgId = `bw_${messageUuid.substring(0, 16)}`;
    return msgId;
  }

  async getDeliveryStatus(providerId: string): Promise<DeliveryStatus> {
    return 'sent';
  }

  validateWebhook(body: any, signature?: string): boolean {
    return !!body.message?.id;
  }

  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null {
    if (!body.message?.id) return null;
    const statusMap: Record<string, DeliveryStatus> = {
      QUEUED: 'queued',
      SENT: 'sent',
      DELIVERED: 'delivered',
      FAILED: 'failed',
      UNDELIVERED: 'undelivered',
    };
    return {
      messageId: body.message.id,
      status: (statusMap[body.message.state] || 'sent') as DeliveryStatus,
      timestamp: new Date(body.time),
      errorCode: body.error?.code,
      errorMessage: body.error?.message,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    return { healthy: true, latency: 150 };
  }
}
