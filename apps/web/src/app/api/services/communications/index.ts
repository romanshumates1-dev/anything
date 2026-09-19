/**
 * Communications Service
 *
 * Unified multi-channel communications abstraction.
 * Supports phone, SMS, and email channels with automatic credit management.
 */

export { communicationsEngine } from './engine';

export type {
  ChannelType,
  MessageStatus,
  Message,
  SendOptions,
  SendResult,
  ChannelDriver,
  ChannelConfig,
  MessageEventType,
  MessageEvent,
  DeliveryWebhook,
} from './types';
