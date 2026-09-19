/**
 * Communications Service Types
 *
 * Unified abstraction for multi-channel communications (phone, SMS, email).
 * Provides type-safe interfaces for drivers and message handling.
 */

export type ChannelType = 'phone' | 'sms' | 'email';

export type MessageStatus =
  | 'pending'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'opted_out';

export interface Message {
  id: string;
  channel: ChannelType;
  campaignId?: string;
  contactId: string;
  organizationId: string;
  content: string;
  status: MessageStatus;
  provider: string;
  cost?: number;
  credits?: number;
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SendOptions {
  channel: ChannelType;
  to: string;
  content: string;
  campaignId?: string;
  contactId: string;
  organizationId: string;
  scheduledFor?: Date;
  priority?: 'low' | 'normal' | 'high';
  metadata?: Record<string, unknown>;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  status: MessageStatus;
  error?: string;
  cost?: number;
}

export interface ChannelDriver {
  readonly channel: ChannelType;
  readonly provider: string;

  /**
   * Send a message through this channel.
   */
  send(options: SendOptions): Promise<SendResult>;

  /**
   * Get the current status of a message.
   */
  getStatus(messageId: string): Promise<MessageStatus>;

  /**
   * Cancel a pending/queued message.
   * Returns true if successfully cancelled, false otherwise.
   */
  cancel(messageId: string): Promise<boolean>;

  /**
   * Check if the driver is properly configured and healthy.
   */
  isHealthy(): Promise<boolean>;
}

/**
 * Configuration for channel-specific settings
 */
export interface ChannelConfig {
  enabled: boolean;
  defaultProvider?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  rateLimit?: {
    maxPerMinute: number;
    maxPerHour: number;
  };
}

/**
 * Event types for message lifecycle
 */
export type MessageEventType =
  | 'message.created'
  | 'message.queued'
  | 'message.sending'
  | 'message.sent'
  | 'message.delivered'
  | 'message.failed'
  | 'message.bounced'
  | 'message.opted_out';

export interface MessageEvent {
  type: MessageEventType;
  messageId: string;
  channel: ChannelType;
  timestamp: Date;
  data?: Record<string, unknown>;
}

/**
 * Webhook payload for delivery status updates
 */
export interface DeliveryWebhook {
  messageId: string;
  provider: string;
  status: MessageStatus;
  timestamp: Date;
  rawPayload?: Record<string, unknown>;
}
