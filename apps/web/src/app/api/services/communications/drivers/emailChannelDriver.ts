/**
 * Email Channel Driver
 *
 * Adapter that wraps the existing emailDriver to conform to the ChannelDriver interface.
 */
import type { ChannelDriver, SendOptions, SendResult, MessageStatus } from '../types';
import { send as sendEmail, getConfiguredProvider } from '../../emailDriver';

export class EmailChannelDriver implements ChannelDriver {
  readonly channel = 'email' as const;

  get provider(): string {
    return getConfiguredProvider();
  }

  async send(options: SendOptions): Promise<SendResult> {
    // Parse recipient and content for email
    const fromAddress = process.env.EMAIL_FROM
      || process.env.SMTP_FROM
      || 'DealFlow AI <noreply@dealflow.ai>';

    // Content should be HTML for email
    const htmlContent = options.content.includes('<')
      ? options.content
      : `<p>${options.content.replace(/\n/g, '<br>')}</p>`;

    const result = await sendEmail({
      to: options.to,
      from: fromAddress,
      subject: options.metadata?.subject as string || 'Message from DealFlow AI',
      html: htmlContent,
      text: options.content.replace(/<[^>]*>/g, ''), // Strip HTML for text version
      campaignId: options.campaignId,
      contactId: options.contactId,
    });

    return {
      success: result.status === 'sent',
      messageId: result.providerMessageId,
      provider: result.provider || this.provider,
      status: mapEmailStatus(result.status),
      error: result.errorMessage,
    };
  }

  async getStatus(messageId: string): Promise<MessageStatus> {
    // Email status is typically received via webhooks (bounce, open, click)
    // Without webhook integration, we can only return the initial status

    if (messageId.startsWith('mock_')) {
      return 'delivered';
    }

    // For production providers, status would come from:
    // - SendGrid: Event Webhooks
    // - Resend: Webhooks
    // - SES: SNS notifications
    // This would need to be enhanced with a message status table
    return 'sent';
  }

  async cancel(messageId: string): Promise<boolean> {
    // Emails are sent immediately and cannot be cancelled
    // unless they're in a scheduled queue (not implemented yet)
    console.log(`[EmailChannelDriver] Cancel not supported for message: ${messageId}`);
    return false;
  }

  async isHealthy(): Promise<boolean> {
    const provider = this.provider;

    // Check if required credentials are configured
    switch (provider) {
      case 'sendgrid':
        return !!process.env.SENDGRID_API_KEY;
      case 'resend':
        return !!process.env.RESEND_API_KEY;
      case 'ses':
        return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
      case 'smtp':
        return !!(process.env.SMTP_HOST && process.env.SMTP_PASS);
      case 'mock':
        return true;
      default:
        return true; // Mock provider is always available
    }
  }
}

/**
 * Map email driver status to MessageStatus.
 */
function mapEmailStatus(status: 'sent' | 'failed' | 'dry-run'): MessageStatus {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'failed':
      return 'failed';
    case 'dry-run':
      return 'sent'; // Treat dry-run as sent for testing
    default:
      return 'pending';
  }
}

// Singleton instance
export const emailChannelDriver = new EmailChannelDriver();
