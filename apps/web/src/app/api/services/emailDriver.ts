/**
 * emailDriver.ts — The gateway for sending all outbound emails.
 *
 * Supports multiple providers:
 *   - smtp: Gmail, Outlook, or any SMTP server
 *   - sendgrid: SendGrid API (100/day free)
 *   - resend: Resend.com API (3000/month free)
 *   - ses: Amazon SES ($0.10/1000 emails)
 *   - mock: Development logging only
 */
import { randomUUID } from 'node:crypto';
import { logEvent } from '@/app/api/utils/logger';

interface EmailParams {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  campaignId?: string;
  leadId?: string;
  contactId?: string;
}

interface SendResult {
  status: 'sent' | 'failed' | 'dry-run';
  providerMessageId?: string;
  errorMessage?: string;
  provider?: string;
}

function generateUnsubscribeToken(contactId: string): string {
  const payload = `${contactId}:${process.env.EMAIL_UNSUB_SECRET || 'dev-secret'}`;
  return Buffer.from(payload).toString('base64url');
}

function withCanSpamFooter(html: string, contactId: string): string {
  const physicalAddress = process.env.COMPANY_POSTAL_ADDRESS || process.env.LEGAL_PHYSICAL_ADDRESS || '123 Main St, Dover, DE 19901';
  const unsubscribeToken = generateUnsubscribeToken(contactId);
  const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000'}/api/email/unsubscribe?token=${unsubscribeToken}`;

  const footer = `
    <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-family: sans-serif; font-size: 12px; color: #64748b;">
      <p>You are receiving this email as part of a real estate investment inquiry.</p>
      <p>${physicalAddress}</p>
      <p><a href="${unsubscribeUrl}" style="color: #64748b;">Unsubscribe</a></p>
    </div>
  `;

  return `${html}${footer}`;
}

async function sendWithSendGrid(params: EmailParams): Promise<SendResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error('SENDGRID_API_KEY not configured');

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: params.to }] }],
      from: { email: params.from.includes('<') ? params.from.match(/<(.+)>/)?.[1] : params.from },
      subject: params.subject,
      content: [
        { type: 'text/plain', value: params.text || params.html.replace(/<[^>]+>/g, '') },
        { type: 'text/html', value: params.html },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SendGrid error: ${response.status} - ${error}`);
  }

  const messageId = response.headers.get('x-message-id') || `sg_${randomUUID()}`;
  return { status: 'sent', providerMessageId: messageId, provider: 'sendgrid' };
}

async function sendWithResend(params: EmailParams): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return { status: 'sent', providerMessageId: data.id, provider: 'resend' };
}

async function sendWithSES(params: EmailParams): Promise<SendResult> {
  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');

  const client = new SESClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  // Preserve display name in From field (SES accepts "Name <email>" format)
  const command = new SendEmailCommand({
    Source: params.from,
    Destination: { ToAddresses: [params.to] },
    Message: {
      Subject: { Data: params.subject },
      Body: {
        Text: { Data: params.text || params.html.replace(/<[^>]+>/g, '') },
        Html: { Data: params.html },
      },
    },
  });

  const response = await client.send(command);
  return { status: 'sent', providerMessageId: response.MessageId, provider: 'ses' };
}

async function sendWithSMTP(params: EmailParams): Promise<SendResult> {
  const nodemailer = await import('nodemailer');

  const transporter = nodemailer.default.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: params.from,
    to: params.to,
    subject: params.subject,
    text: params.text || params.html.replace(/<[^>]+>/g, ''),
    html: params.html,
  });

  return { status: 'sent', providerMessageId: info.messageId, provider: 'smtp' };
}

async function sendWithMockProvider(params: EmailParams): Promise<SendResult> {
  const mockMessageId = `mock_${randomUUID()}`;
  console.log(`[MOCK EMAIL] To: ${params.to} | Subject: ${params.subject}`);

  await logEvent('email_dispatched', 'lead', params.leadId ?? 'unknown', {
    to: params.to, subject: params.subject, providerMessageId: mockMessageId, provider: 'mock',
  });

  return { status: 'sent', providerMessageId: mockMessageId, provider: 'mock' };
}

export async function send(params: EmailParams): Promise<SendResult> {
  if (!params.contactId) {
    throw new Error('emailDriver.send requires a contactId to generate an unsubscribe link.');
  }

  const emailToSend = {
    ...params,
    html: withCanSpamFooter(params.html, params.contactId),
  };

  // Auto-detect provider based on available credentials (priority order: explicit > dedicated > aws)
  let provider = process.env.EMAIL_PROVIDER;
  if (!provider) {
    if (process.env.SENDGRID_API_KEY) provider = 'sendgrid';
    else if (process.env.RESEND_API_KEY) provider = 'resend';
    else if (process.env.SMTP_HOST && process.env.SMTP_PASS) provider = 'smtp';
    // Auto-detect SES if AWS credentials exist (no manual flag needed)
    else if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) provider = 'ses';
    else provider = 'mock';
  }

  // Build fallback chain based on available providers
  const fallbackChain: Array<{ name: string; fn: (p: EmailParams) => Promise<SendResult> }> = [];

  // Primary provider first
  const addProvider = (name: string, fn: (p: EmailParams) => Promise<SendResult>, condition: boolean) => {
    if (condition) fallbackChain.push({ name, fn });
  };

  // Add providers in priority order (primary first, then fallbacks)
  if (provider === 'ses' || process.env.AWS_ACCESS_KEY_ID) addProvider('ses', sendWithSES, true);
  if (provider === 'sendgrid' || process.env.SENDGRID_API_KEY) addProvider('sendgrid', sendWithSendGrid, provider !== 'sendgrid');
  if (provider === 'resend' || process.env.RESEND_API_KEY) addProvider('resend', sendWithResend, provider !== 'resend');
  if (provider === 'smtp' || (process.env.SMTP_HOST && process.env.SMTP_PASS)) addProvider('smtp', sendWithSMTP, provider !== 'smtp');

  // Always have mock as final fallback in dev
  if (fallbackChain.length === 0 || process.env.NODE_ENV !== 'production') {
    fallbackChain.push({ name: 'mock', fn: sendWithMockProvider });
  }

  // Try each provider in order until one succeeds
  let lastError: string | undefined;
  for (const { name, fn } of fallbackChain) {
    try {
      const result = await fn(emailToSend);
      if (result.status === 'sent') {
        return result;
      }
      lastError = result.errorMessage;
    } catch (error: any) {
      console.error(`[EmailDriver] ${name} error:`, error.message);
      lastError = error.message;
      // Continue to next provider in fallback chain
    }
  }

  return { status: 'failed', errorMessage: lastError || 'All providers failed', provider };
}

export function getConfiguredProvider(): string {
  if (process.env.EMAIL_PROVIDER) return process.env.EMAIL_PROVIDER;
  if (process.env.SENDGRID_API_KEY) return 'sendgrid';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_PASS) return 'smtp';
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return 'ses';
  return 'mock';
}
