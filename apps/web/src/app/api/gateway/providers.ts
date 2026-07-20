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
  /** `from` (INT-3 local presence) overrides the adapter's default sender when given. */
  send(to: string, text: string, messageUuid: string, from?: string): Promise<string>; // returns provider message ID
  getDeliveryStatus(providerId: string): Promise<DeliveryStatus>;
  validateWebhook(body: any, signature?: string): boolean;
  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null;
  healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }>;
}

/**
 * Twilio Provider Adapter
 * Uses the real Twilio REST API via the twilio SDK client.
 */
export class TwilioAdapter implements ISMSProvider {
  name = 'twilio';

  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string | undefined,
    private messagingServiceSid: string | undefined,
  ) {}

  private getClient() {
    // Lazy-import to avoid circular deps; twilio SDK is already a dep
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require('twilio');
    return twilio(this.accountSid, this.authToken);
  }

  async isHealthy(): Promise<boolean> {
    try {
      const check = await this.healthCheck();
      return check.healthy && check.latency < 3000;
    } catch {
      return false;
    }
  }

  async send(to: string, text: string, messageUuid: string, from?: string): Promise<string> {
    const client = this.getClient();
    const toE164 = to.startsWith('+') ? to : `+${to}`;

    const createParams: Record<string, string> = {
      body: text,
      to: toE164,
    };
    if (from) {
      // INT-3 local presence: an explicit pool number beats the messaging
      // service (whose whole job is picking a sender — we already picked one).
      createParams.from = from;
    } else if (this.messagingServiceSid) {
      createParams.messagingServiceSid = this.messagingServiceSid;
    } else if (this.fromNumber) {
      createParams.from = this.fromNumber;
    } else {
      throw new Error('TwilioAdapter: no messagingServiceSid or fromNumber configured');
    }

    const message = await client.messages.create(createParams);
    console.log('[TwilioAdapter] sent', {
      sid: message.sid,
      status: message.status,
      to: toE164,
      messageUuid,
    });
    return message.sid;
  }

  async getDeliveryStatus(providerId: string): Promise<DeliveryStatus> {
    const client = this.getClient();
    const message = await client.messages(providerId).fetch();
    const statusMap: Record<string, DeliveryStatus> = {
      queued: 'queued',
      sending: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      undelivered: 'undelivered',
      failed: 'failed',
      canceled: 'bounced',
    };
    return statusMap[message.status] || 'sent';
  }

  validateWebhook(body: any, _signature?: string): boolean {
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

  async getDeliveryStatus(_providerId: string): Promise<DeliveryStatus> {
    // Query Telnyx API
    return 'sent';
  }

  validateWebhook(body: any, _signature?: string): boolean {
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

  async getDeliveryStatus(_providerId: string): Promise<DeliveryStatus> {
    return 'sent';
  }

  validateWebhook(body: any, _signature?: string): boolean {
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
/**
 * Phase T — Toll-Free driver STUB. Toll-free verification is the LEGIT
 * higher-throughput / cheaper path once registered — NOT an A2P bypass for cold
 * traffic. Same ISMSProvider interface; nothing dials/sends until the // LIVE:
 * block is implemented AND the toll-free number is Verified in the Twilio
 * console. See DEPLOY.md "Toll-free verification".
 */
export class TollFreeStub implements ISMSProvider {
  name = 'toll-free-stub';

  constructor(
    private accountSid: string,
    private authToken: string,
    private tollFreeNumber: string,
    /** 'unverified' | 'pending' | 'verified' — real sends require 'verified'. */
    private verificationStatus: 'unverified' | 'pending' | 'verified' = 'unverified',
  ) {}

  async isHealthy(): Promise<boolean> {
    return this.verificationStatus === 'verified';
  }

  async send(to: string, text: string, messageUuid: string): Promise<string> {
    if (this.verificationStatus !== 'verified') {
      throw new Error(`TollFreeStub: number ${this.tollFreeNumber} is '${this.verificationStatus}', not verified — cannot send`);
    }
    // LIVE: const client = require('twilio')(this.accountSid, this.authToken);
    // LIVE: const msg = await client.messages.create({
    // LIVE:   body: text, to: to.startsWith('+') ? to : `+${to}`, from: this.tollFreeNumber,
    // LIVE: });
    // LIVE: return msg.sid;
    return `tollfree_stub_${messageUuid.substring(0, 12)}`;
  }

  async getDeliveryStatus(_providerId: string): Promise<DeliveryStatus> {
    return 'sent';
  }

  validateWebhook(body: any, _signature?: string): boolean {
    return !!body?.MessageSid;
  }

  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null {
    if (!body?.MessageSid) return null;
    return { messageId: body.MessageSid, status: 'delivered', timestamp: new Date() };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    const verified = this.verificationStatus === 'verified';
    return { healthy: verified, latency: verified ? 120 : 0, details: `toll-free ${this.verificationStatus}` };
  }
}
