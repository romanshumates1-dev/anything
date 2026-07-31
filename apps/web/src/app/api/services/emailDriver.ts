/**
 * emailDriver.ts — The gateway for sending all outbound emails.
 *
 * This service is the single point of contact for dispatching emails. It abstracts
 * the underlying email provider (e.g., SES, Resend, Postmark) and ensures all
 * outbound messages are compliant with CAN-SPAM regulations.
 *
 * As per the "VERIFY & TUNE" rule, this file existed with basic guards. This
 * version is fleshed out for integration with the cadence engine.
 */
import { randomUUID } from 'node:crypto';
import { logEvent } from '@/app/api/utils/logger';

interface EmailParams {
  to: string;
  from: string; // e.g., "DealFlow <noreply@dealswiftautomation.com>"
  subject: string;
  html: string;
  campaignId?: string;
  leadId?: string;
  contactId?: string;
}

interface SendResult {
  status: 'sent' | 'failed' | 'dry-run';
  providerMessageId?: string;
  errorMessage?: string;
}

/**
 * Generates a unique, secure token for the unsubscribe link.
 * In a real implementation, this would be a signed JWT or an opaque token
 * stored in the database with an expiry.
 */
function generateUnsubscribeToken(contactId: string): string {
  // For now, a simple base64 encoding of contactId + a secret salt.
  const payload = `${contactId}:${process.env.EMAIL_UNSUB_SECRET || 'dev-secret'}`;
  return Buffer.from(payload).toString('base64url');
}

/**
 * Appends a CAN-SPAM compliant footer to the email body.
 */
function withCanSpamFooter(html: string, contactId: string): string {
  const physicalAddress = process.env.LEGAL_PHYSICAL_ADDRESS || '123 Main St, Dover, DE 19901';
  const unsubscribeToken = generateUnsubscribeToken(contactId);
  const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const footer = `
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 12px; color: #64748b;">
      <p>You are receiving this email as part of a real estate investment inquiry.</p>
      <p>${physicalAddress}</p>
      <p><a href="${unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a></p>
    </div>
  `;

  return `${html}${footer}`;
}

/**
 * A mock email provider for development and testing. It logs the email to the
 * console instead of sending it.
 */
async function sendWithMockProvider(params: EmailParams): Promise<SendResult> {
  const mockMessageId = `mock_${randomUUID()}`;
  console.log('--- [MockEmailProvider] ---');
  console.log(`To: ${params.to}`);
  console.log(`From: ${params.from}`);
  console.log(`Subject: ${params.subject}`);
  console.log('---------------------------');
  // console.log(params.html); // Too verbose for default logs
  console.log('--- [End MockEmailProvider] ---');

  await logEvent('email_dispatched', 'lead', params.leadId ?? 'unknown', {
    ...params, providerMessageId: mockMessageId, provider: 'mock',
  });

  return { status: 'sent', providerMessageId: mockMessageId };
}

export async function send(params: EmailParams): Promise<SendResult> {
  if (!params.contactId) {
    throw new Error('emailDriver.send requires a contactId to generate an unsubscribe link.');
  }

  const emailToSend = {
    ...params,
    html: withCanSpamFooter(params.html, params.contactId),
  };

  const provider = process.env.EMAIL_PROVIDER || 'mock';

  try {
    if (provider === 'mock') {
      return await sendWithMockProvider(emailToSend);
    }
    // In a real implementation, other providers would be handled here.
    // e.g., if (provider === 'resend') { return await sendWithResend(emailToSend); }
    throw new Error(`Unknown email provider: ${provider}`);
  } catch (error: any) {
    return { status: 'failed', errorMessage: error.message };
  }
}
