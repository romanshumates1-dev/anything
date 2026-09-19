/**
 * Communications Engine
 *
 * Central orchestrator for multi-channel communications.
 * Handles driver registration, credit management, and message routing.
 *
 * Features:
 * - Unified API for all communication channels
 * - Automatic credit checking and deduction
 * - Credit refunds on send failures
 * - Driver health monitoring
 * - Extensible driver registration
 */
import { randomUUID } from 'node:crypto';
import type {
  ChannelType,
  SendOptions,
  SendResult,
  ChannelDriver,
  Message,
  MessageStatus,
  ChannelConfig,
} from './types';
import {
  hasEnoughCredits,
  deductCredits,
  refundCredits,
} from '@/app/api/utils/credits';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Credit costs per channel type.
 * These are base costs; actual costs may vary by tier.
 */
const DEFAULT_CREDIT_COSTS: Record<ChannelType, number> = {
  phone: 10,  // Voice calls are most expensive
  sms: 1,     // Standard SMS cost
  email: 1,   // Minimal cost for email (rounded up from 0.1)
};

class CommunicationsEngine {
  private drivers = new Map<ChannelType, ChannelDriver>();
  private configs = new Map<ChannelType, ChannelConfig>();
  private creditCosts: Record<ChannelType, number> = { ...DEFAULT_CREDIT_COSTS };

  /**
   * Register a channel driver.
   * Only one driver per channel type is allowed.
   */
  registerDriver(driver: ChannelDriver): void {
    if (this.drivers.has(driver.channel)) {
      console.warn(`[CommunicationsEngine] Replacing existing driver for channel: ${driver.channel}`);
    }
    this.drivers.set(driver.channel, driver);
    console.log(`[CommunicationsEngine] Registered driver for ${driver.channel}: ${driver.provider}`);
  }

  /**
   * Unregister a channel driver.
   */
  unregisterDriver(channel: ChannelType): boolean {
    return this.drivers.delete(channel);
  }

  /**
   * Get the registered driver for a channel.
   */
  getDriver(channel: ChannelType): ChannelDriver | undefined {
    return this.drivers.get(channel);
  }

  /**
   * Set configuration for a channel.
   */
  setChannelConfig(channel: ChannelType, config: ChannelConfig): void {
    this.configs.set(channel, config);
  }

  /**
   * Get configuration for a channel.
   */
  getChannelConfig(channel: ChannelType): ChannelConfig | undefined {
    return this.configs.get(channel);
  }

  /**
   * Set custom credit costs for channels.
   */
  setCreditCosts(costs: Partial<Record<ChannelType, number>>): void {
    this.creditCosts = { ...this.creditCosts, ...costs };
  }

  /**
   * Get the credit cost for a channel.
   */
  getCreditCost(channel: ChannelType): number {
    return this.creditCosts[channel] ?? 1;
  }

  /**
   * Check if a channel is available (has a registered, healthy driver).
   */
  async isChannelAvailable(channel: ChannelType): Promise<boolean> {
    const driver = this.drivers.get(channel);
    if (!driver) return false;

    const config = this.configs.get(channel);
    if (config && !config.enabled) return false;

    try {
      return await driver.isHealthy();
    } catch {
      return false;
    }
  }

  /**
   * Get all available channels.
   */
  async getAvailableChannels(): Promise<ChannelType[]> {
    const channels: ChannelType[] = [];
    for (const channel of this.drivers.keys()) {
      if (await this.isChannelAvailable(channel)) {
        channels.push(channel);
      }
    }
    return channels;
  }

  /**
   * Send a message through the appropriate channel.
   *
   * Process:
   * 1. Validate driver exists for channel
   * 2. Check organization has sufficient credits
   * 3. Deduct credits
   * 4. Send message via driver
   * 5. Refund credits on failure
   */
  async send(options: SendOptions): Promise<Message> {
    const { channel, organizationId, contactId, campaignId, content, to } = options;

    // Generate message ID upfront for tracking
    const messageId = `msg_${randomUUID()}`;

    // Validate driver exists
    const driver = this.drivers.get(channel);
    if (!driver) {
      throw new Error(`No driver registered for channel: ${channel}`);
    }

    // Check channel config
    const config = this.configs.get(channel);
    if (config && !config.enabled) {
      throw new Error(`Channel ${channel} is disabled`);
    }

    // Calculate credit cost
    const creditCost = this.getCreditCost(channel);

    // Check credits before sending
    const hasCredits = await hasEnoughCredits(organizationId, creditCost);
    if (!hasCredits) {
      await logEvent('message_blocked', 'communication', messageId, {
        reason: 'insufficient_credits',
        channel,
        organizationId,
        contactId,
        creditCost,
      });

      return {
        id: messageId,
        channel,
        campaignId,
        contactId,
        organizationId,
        content,
        status: 'failed',
        provider: driver.provider,
        error: 'Insufficient credits',
        failedAt: new Date(),
      };
    }

    // Deduct credits with idempotency key
    const deductResult = await deductCredits(
      organizationId,
      creditCost,
      'DEDUCT',
      `${channel} message to ${contactId}`,
      {
        channel,
        contactId,
        campaignId,
        messageId,
      },
      `comm_${messageId}` // Idempotency key prevents double-charging
    );

    if (!deductResult.success) {
      await logEvent('message_blocked', 'communication', messageId, {
        reason: 'credit_deduction_failed',
        channel,
        organizationId,
        contactId,
        errorCode: deductResult.errorCode,
      });

      return {
        id: messageId,
        channel,
        campaignId,
        contactId,
        organizationId,
        content,
        status: 'failed',
        provider: driver.provider,
        error: deductResult.errorCode === 'INSUFFICIENT_CREDITS'
          ? 'Insufficient credits'
          : 'Credit deduction failed',
        failedAt: new Date(),
      };
    }

    // Attempt to send
    let result: SendResult;
    try {
      result = await driver.send({
        ...options,
        // Ensure message ID is consistent
        metadata: {
          ...options.metadata,
          engineMessageId: messageId,
        },
      });
    } catch (error: any) {
      // Refund credits on exception
      await refundCredits(
        organizationId,
        creditCost,
        `Refund for failed ${channel} send: ${error.message}`,
        {
          originalMessageId: messageId,
          channel,
          error: error.message,
        },
        deductResult.transactionId
      );

      await logEvent('message_failed', 'communication', messageId, {
        channel,
        organizationId,
        contactId,
        error: error.message,
        creditsRefunded: creditCost,
      });

      return {
        id: messageId,
        channel,
        campaignId,
        contactId,
        organizationId,
        content,
        status: 'failed',
        provider: driver.provider,
        error: error.message,
        failedAt: new Date(),
      };
    }

    // Handle send failure (no exception but unsuccessful)
    if (!result.success) {
      await refundCredits(
        organizationId,
        creditCost,
        `Refund for failed ${channel} send: ${result.error}`,
        {
          originalMessageId: messageId,
          channel,
          providerError: result.error,
        },
        deductResult.transactionId
      );

      await logEvent('message_failed', 'communication', messageId, {
        channel,
        organizationId,
        contactId,
        error: result.error,
        creditsRefunded: creditCost,
      });

      return {
        id: messageId,
        channel,
        campaignId,
        contactId,
        organizationId,
        content,
        status: 'failed',
        provider: result.provider,
        error: result.error,
        failedAt: new Date(),
      };
    }

    // Success
    await logEvent('message_sent', 'communication', messageId, {
      channel,
      organizationId,
      contactId,
      campaignId,
      provider: result.provider,
      providerMessageId: result.messageId,
      creditCost,
    });

    return {
      id: messageId,
      channel,
      campaignId,
      contactId,
      organizationId,
      content,
      status: result.status,
      provider: result.provider,
      credits: creditCost,
      cost: result.cost,
      sentAt: new Date(),
    };
  }

  /**
   * Get the status of a message.
   */
  async getMessageStatus(channel: ChannelType, messageId: string): Promise<MessageStatus> {
    const driver = this.drivers.get(channel);
    if (!driver) {
      throw new Error(`No driver registered for channel: ${channel}`);
    }
    return driver.getStatus(messageId);
  }

  /**
   * Cancel a pending message.
   */
  async cancelMessage(channel: ChannelType, messageId: string): Promise<boolean> {
    const driver = this.drivers.get(channel);
    if (!driver) {
      return false;
    }
    return driver.cancel(messageId);
  }

  /**
   * Get health status for all registered drivers.
   */
  async getHealthStatus(): Promise<Record<ChannelType, { healthy: boolean; provider: string }>> {
    const status: Record<string, { healthy: boolean; provider: string }> = {};

    for (const [channel, driver] of this.drivers.entries()) {
      try {
        const healthy = await driver.isHealthy();
        status[channel] = { healthy, provider: driver.provider };
      } catch {
        status[channel] = { healthy: false, provider: driver.provider };
      }
    }

    return status as Record<ChannelType, { healthy: boolean; provider: string }>;
  }
}

// Singleton instance
export const communicationsEngine = new CommunicationsEngine();

// Re-export types for convenience
export type { ChannelType, SendOptions, Message, MessageStatus, ChannelDriver };
