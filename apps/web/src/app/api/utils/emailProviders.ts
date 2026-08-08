/**
 * Email Provider Selection
 *
 * Supports multiple email providers with automatic fallback:
 * 1. FREE: Gmail SMTP (500/day limit)
 * 2. AWS SES: High volume (50k+/day, ~$0.10 per 1000)
 * 3. Gemini/Google Workspace: Medium volume (2000/day)
 *
 * Provider is selected based on:
 * - Environment config (EMAIL_PROVIDER)
 * - Daily quota remaining
 * - Cost optimization preference
 */
import nodemailer from 'nodemailer';
import sql from '@/app/api/utils/sql';

export type EmailProvider = 'gmail' | 'ses' | 'gemini' | 'mock';

export interface EmailSendOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
}

export interface ProviderQuota {
  provider: EmailProvider;
  dailyLimit: number;
  sentToday: number;
  remaining: number;
  costPer1000: number;
}

const PROVIDER_LIMITS: Record<EmailProvider, { daily: number; costPer1000: number }> = {
  gmail: { daily: 500, costPer1000: 0 },
  gemini: { daily: 2000, costPer1000: 0 },
  ses: { daily: 50000, costPer1000: 0.10 },
  mock: { daily: 999999, costPer1000: 0 },
};

async function getSentTodayCount(provider: EmailProvider, orgId: string): Promise<number> {
  const [result] = await sql`
    SELECT COUNT(*) as cnt
    FROM message_events
    WHERE provider = ${provider}
      AND organization_id = ${orgId}
      AND created_at > now() - interval '24 hours'
      AND direction = 'outbound'
      AND channel = 'email'
  `;
  return Number(result?.cnt || 0);
}

export async function getProviderQuota(provider: EmailProvider, orgId: string): Promise<ProviderQuota> {
  const limits = PROVIDER_LIMITS[provider];
  const sentToday = await getSentTodayCount(provider, orgId);
  return {
    provider,
    dailyLimit: limits.daily,
    sentToday,
    remaining: Math.max(0, limits.daily - sentToday),
    costPer1000: limits.costPer1000,
  };
}

export async function selectBestProvider(orgId: string, count: number = 1): Promise<EmailProvider> {
  const configuredProvider = process.env.EMAIL_PROVIDER as EmailProvider;

  if (configuredProvider && configuredProvider !== 'mock') {
    const quota = await getProviderQuota(configuredProvider, orgId);
    if (quota.remaining >= count) {
      return configuredProvider;
    }
  }

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const gmailQuota = await getProviderQuota('gmail', orgId);
    if (gmailQuota.remaining >= count) {
      return 'gmail';
    }
  }

  if (process.env.AWS_SES_ACCESS_KEY && process.env.AWS_SES_SECRET_KEY) {
    const sesQuota = await getProviderQuota('ses', orgId);
    if (sesQuota.remaining >= count) {
      return 'ses';
    }
  }

  if (process.env.GEMINI_SMTP_USER && process.env.GEMINI_SMTP_PASS) {
    const geminiQuota = await getProviderQuota('gemini', orgId);
    if (geminiQuota.remaining >= count) {
      return 'gemini';
    }
  }

  return 'mock';
}

function createGmailTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function createSESTransport() {
  return nodemailer.createTransport({
    host: process.env.AWS_SES_SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.AWS_SES_ACCESS_KEY,
      pass: process.env.AWS_SES_SECRET_KEY,
    },
  });
}

function createGeminiTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GEMINI_SMTP_USER,
      pass: process.env.GEMINI_SMTP_PASS,
    },
  });
}

export async function sendEmailWithProvider(
  provider: EmailProvider,
  options: EmailSendOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (provider === 'mock') {
    console.log('[MOCK EMAIL]', options.to, options.subject);
    return { success: true, messageId: `mock_${Date.now()}` };
  }

  let transport;
  let fromAddress = options.from;

  switch (provider) {
    case 'gmail':
      transport = createGmailTransport();
      fromAddress = fromAddress || process.env.SMTP_USER;
      break;
    case 'ses':
      transport = createSESTransport();
      fromAddress = fromAddress || process.env.AWS_SES_FROM_ADDRESS || process.env.SMTP_USER;
      break;
    case 'gemini':
      transport = createGeminiTransport();
      fromAddress = fromAddress || process.env.GEMINI_SMTP_USER;
      break;
    default:
      return { success: false, error: `Unknown provider: ${provider}` };
  }

  try {
    const result = await transport.sendMail({
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo,
    });

    return { success: true, messageId: result.messageId };
  } catch (error: any) {
    console.error(`[${provider}] Email send failed:`, error.message);
    return { success: false, error: error.message };
  }
}

export async function sendEmailAuto(
  orgId: string,
  options: EmailSendOptions
): Promise<{ success: boolean; provider: EmailProvider; messageId?: string; error?: string }> {
  const provider = await selectBestProvider(orgId, 1);
  const result = await sendEmailWithProvider(provider, options);
  return { ...result, provider };
}
