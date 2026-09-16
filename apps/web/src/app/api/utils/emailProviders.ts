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
import { isCloudflareWorkers } from '@/lib/websocket';
import sql from '@/app/api/utils/sql';

export type EmailProvider = 'gmail' | 'ses' | 'ses-http' | 'gemini' | 'mock';

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
  // Same SES quota/account as 'ses' — separate key so the message_events rows
  // record WHICH transport sent (SMTP vs HTTPS API) without double-counting.
  'ses-http': { daily: 50000, costPer1000: 0.10 },
  mock: { daily: 999999, costPer1000: 0 },
};

async function getSentTodayCount(provider: EmailProvider, orgId: string): Promise<number> {
  // 'ses' and 'ses-http' share one SES account/quota: count both rows together
  // so switching transports cannot exceed the real SES sending limit.
  const providers = provider === 'ses' || provider === 'ses-http' ? ['ses', 'ses-http'] : [provider];
  const [result] = await sql`
    SELECT COUNT(*) as cnt
    FROM message_events
    WHERE provider = ANY(${providers})
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
  // WORKERD GUARD (Cloudflare Workers): SMTP cannot send from the deployed
  // Worker — outbound port 25/587 is blocked at the platform level. So on
  // workerd the ONLY reachable provider is 'ses', routed through the SES HTTPS
  // API (sendSesHttpEmail). Everything else falls to 'mock' (logged, never
  // silently dropped). Node (dev/Docker/CI) keeps the full SMTP chain below.
  if (isCloudflareWorkers()) {
    const configuredProvider = process.env.EMAIL_PROVIDER as EmailProvider;
    // Accept 'ses' (same value as every other runtime) AND 'ses-http' — both
    // mean the SES HTTPS API here. Anything else is undeployable on Workers.
    if (configuredProvider === 'ses' || configuredProvider === 'ses-http' || !configuredProvider) {
      const sesQuota = await getProviderQuota('ses-http', orgId);
      if (sesQuota.remaining >= count) {
        return 'ses-http';
      }
    }
    return 'mock';
  }

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
  // Lazy-require: `nodemailer` opens NO sockets at import time, but the static
  // import pulled its SMTP stack into the Cloudflare Workers bundle. Loading
  // it here keeps workerd SMTP-free (this function is never called on Workers
  // — see the isCloudflareWorkers() guard in selectBestProvider below).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer');
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
  // Lazy-require, same reason as createGmailTransport: keeps the SMTP stack
  // out of the Workers bundle. The SES-SMTP path is ALSO unreachable on
  // Workers (guarded in selectBestProvider) — deployed email goes through the
  // SES HTTPS API (sendSesHttpEmail below), never through port 25/587.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer');
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
  // Lazy-require, same reason as createGmailTransport. Unreachable on Workers
  // (guarded in selectBestProvider).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodemailer = require('nodemailer');
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

/**
 * Send one email through the SES HTTPS API (SendEmail v2 action).
 *
 * WHY THIS EXISTS: on Cloudflare Workers outbound port 25/587 is blocked and
 * TCP sockets may not be created in global scope, so nodemailer SMTP cannot
 * send from the deployed Worker. The SES Query API is plain HTTPS POST and
 * works fine under workerd.
 *
 * Auth reuses the SAME SMTP-credential env vars the nodemailer SES transport
 * uses (AWS_SES_ACCESS_KEY / AWS_SES_SECRET_KEY) — SES SMTP credentials ARE
 * IAM-derived SigV4 credentials and sign API requests identically.
 */
async function sendSesHttpEmail(
  options: EmailSendOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const accessKey = process.env.AWS_SES_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SES_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const region =
    process.env.AWS_SES_REGION || process.env.AWS_REGION || 'us-east-1';
  const fromAddress =
    options.from ||
    process.env.AWS_SES_FROM_ADDRESS ||
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.SMTP_USER;

  if (!accessKey || !secretKey) {
    return { success: false, error: 'SES HTTPS send: AWS_SES_ACCESS_KEY / AWS_SES_SECRET_KEY not configured' };
  }
  if (!fromAddress) {
    return { success: false, error: 'SES HTTPS send: no from address (set AWS_SES_FROM_ADDRESS or EMAIL_FROM_ADDRESS)' };
  }

  const endpoint = `https://email.${region}.amazonaws.com/`;
  const params = new URLSearchParams({
    Action: 'SendEmail',
    Version: '2010-12-01',
    'Source': fromAddress,
    'Destination.ToAddresses.member.1': options.to,
    'Message.Subject.Data': options.subject,
    'Message.Subject.Charset': 'UTF-8',
    'Message.Body.Text.Data': options.text,
    'Message.Body.Text.Charset': 'UTF-8',
  });
  if (options.html) {
    params.set('Message.Body.Html.Data', options.html);
    params.set('Message.Body.Html.Charset', 'UTF-8');
  }
  if (options.replyTo) {
    params.set('ReplyToAddresses.member.1', options.replyTo);
  }

  try {
    const { signSesRequest } = await import('@/app/api/utils/ses-sign');
    const body = params.toString();
    const headers = await signSesRequest({
      region,
      service: 'ses',
      method: 'POST',
      body,
      accessKey,
      secretKey,
    });
    const res = await fetch(endpoint, { method: 'POST', headers, body });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { success: false, error: `SES HTTPS send failed [${res.status}]: ${errBody.slice(0, 300)}` };
    }
    const xml = await res.text();
    const messageId = xml.match(/<MessageId>([^<]+)<\/MessageId>/)?.[1];
    return { success: true, messageId };
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) };
  }
}

export async function sendEmailWithProvider(
  provider: EmailProvider,
  options: EmailSendOptions
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (provider === 'mock') {
    console.log('[MOCK EMAIL]', options.to, options.subject);
    return { success: true, messageId: `mock_${Date.now()}` };
  }

  // On Cloudflare Workers 'ses-http' is the SES HTTPS API (SMTP ports are
  // blocked at the platform level); 'ses' is the SES SMTP transport on Node
  // and ALSO routes to the HTTPS API on Workers, so a shared EMAIL_PROVIDER
  // value keeps working on every runtime without per-env config drift.
  if (provider === 'ses-http' || (provider === 'ses' && isCloudflareWorkers())) {
    return sendSesHttpEmail(options);
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
    case 'ses-http':
      // Handled by the HTTPS early-return above — reaching here means the
      // guard was bypassed (impossible through sendEmailAuto). Fail loudly
      // rather than silently downgrading to SMTP on Workers.
      return { success: false, error: `'ses-http' requires the SES HTTPS path (Cloudflare Workers)` };
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
