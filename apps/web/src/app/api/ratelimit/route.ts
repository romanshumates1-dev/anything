/**
 * Rate Limit Tracking API
 *
 * Tracks and enforces:
 * - Daily email send limits (Gmail: 500/day, SES: 50k/day)
 * - SMS rate limits (1/sec carrier limit)
 * - API call limits
 * - Per-lead contact frequency
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

type Channel = 'email' | 'sms' | 'call' | 'api';
type Provider = 'gmail' | 'ses' | 'sendgrid' | 'twilio' | 'internal';

interface RateLimitConfig {
  channel: Channel;
  provider: Provider;
  dailyLimit: number;
  perSecondLimit?: number;
  perLeadDailyLimit?: number;
  perLeadWeeklyLimit?: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'email:gmail': {
    channel: 'email',
    provider: 'gmail',
    dailyLimit: 500,
    perLeadDailyLimit: 3,
    perLeadWeeklyLimit: 7,
  },
  'email:ses': {
    channel: 'email',
    provider: 'ses',
    dailyLimit: 50000,
    perSecondLimit: 14,
    perLeadDailyLimit: 5,
    perLeadWeeklyLimit: 15,
  },
  'email:sendgrid': {
    channel: 'email',
    provider: 'sendgrid',
    dailyLimit: 100,  // Free tier
    perLeadDailyLimit: 3,
    perLeadWeeklyLimit: 7,
  },
  'sms:twilio': {
    channel: 'sms',
    provider: 'twilio',
    dailyLimit: 10000,
    perSecondLimit: 1,  // Carrier limit
    perLeadDailyLimit: 2,
    perLeadWeeklyLimit: 5,
  },
};

interface RateLimitStatus {
  channel: Channel;
  provider: Provider;
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
  percentUsed: number;
  canSend: boolean;
  resetAt: string;
  perSecondOk: boolean;
  leadLimitOk?: boolean;
}

// Get current usage for a channel/provider
async function getUsage(orgId: string, channel: Channel, provider: Provider): Promise<number> {
  const [result] = await sql`
    SELECT COUNT(*) as count FROM rate_limit_log
    WHERE organization_id = ${orgId}
    AND channel = ${channel}
    AND provider = ${provider}
    AND created_at > CURRENT_DATE
  `.catch(() => [{ count: 0 }]);

  return Number(result?.count || 0);
}

// Get usage for a specific lead
async function getLeadUsage(leadId: string, channel: Channel): Promise<{ daily: number; weekly: number }> {
  const [daily] = await sql`
    SELECT COUNT(*) as count FROM rate_limit_log
    WHERE lead_id = ${leadId}
    AND channel = ${channel}
    AND created_at > CURRENT_DATE
  `.catch(() => [{ count: 0 }]);

  const [weekly] = await sql`
    SELECT COUNT(*) as count FROM rate_limit_log
    WHERE lead_id = ${leadId}
    AND channel = ${channel}
    AND created_at > NOW() - INTERVAL '7 days'
  `.catch(() => [{ count: 0 }]);

  return {
    daily: Number(daily?.count || 0),
    weekly: Number(weekly?.count || 0),
  };
}

// Check per-second rate (for SMS/high-volume)
async function checkPerSecondRate(orgId: string, channel: Channel, provider: Provider): Promise<boolean> {
  const config = RATE_LIMITS[`${channel}:${provider}`];
  if (!config?.perSecondLimit) return true;

  const [result] = await sql`
    SELECT COUNT(*) as count FROM rate_limit_log
    WHERE organization_id = ${orgId}
    AND channel = ${channel}
    AND provider = ${provider}
    AND created_at > NOW() - INTERVAL '1 second'
  `.catch(() => [{ count: 0 }]);

  return Number(result?.count || 0) < config.perSecondLimit;
}

// GET: Check rate limit status
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  const url = new URL(req.url);
  const channel = url.searchParams.get('channel') as Channel;
  const provider = url.searchParams.get('provider') as Provider;
  const leadId = url.searchParams.get('leadId');

  try {
    // If specific channel/provider requested
    if (channel && provider) {
      const config = RATE_LIMITS[`${channel}:${provider}`];
      if (!config) {
        return Response.json({ error: 'Unknown channel/provider combination' }, { status: 400 });
      }

      const dailyUsed = await getUsage(organization.id, channel, provider);
      const perSecondOk = await checkPerSecondRate(organization.id, channel, provider);

      let leadLimitOk = true;
      if (leadId && config.perLeadDailyLimit) {
        const leadUsage = await getLeadUsage(leadId, channel);
        leadLimitOk = leadUsage.daily < config.perLeadDailyLimit &&
                      leadUsage.weekly < (config.perLeadWeeklyLimit || Infinity);
      }

      const status: RateLimitStatus = {
        channel,
        provider,
        dailyUsed,
        dailyLimit: config.dailyLimit,
        dailyRemaining: Math.max(0, config.dailyLimit - dailyUsed),
        percentUsed: Math.round((dailyUsed / config.dailyLimit) * 100),
        canSend: dailyUsed < config.dailyLimit && perSecondOk && leadLimitOk,
        resetAt: getNextMidnight().toISOString(),
        perSecondOk,
        leadLimitOk,
      };

      return Response.json(status);
    }

    // Return all rate limit statuses
    const statuses: RateLimitStatus[] = [];

    for (const [key, config] of Object.entries(RATE_LIMITS)) {
      const dailyUsed = await getUsage(organization.id, config.channel, config.provider);
      const perSecondOk = await checkPerSecondRate(organization.id, config.channel, config.provider);

      statuses.push({
        channel: config.channel,
        provider: config.provider,
        dailyUsed,
        dailyLimit: config.dailyLimit,
        dailyRemaining: Math.max(0, config.dailyLimit - dailyUsed),
        percentUsed: Math.round((dailyUsed / config.dailyLimit) * 100),
        canSend: dailyUsed < config.dailyLimit && perSecondOk,
        resetAt: getNextMidnight().toISOString(),
        perSecondOk,
      });
    }

    return Response.json({ limits: statuses });
  } catch (error: any) {
    console.error('[RATELIMIT] Error:', error);
    return Response.json({ error: 'Failed to check rate limits' }, { status: 500 });
  }
}

// POST: Log a send (increment counter)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { channel, provider, leadId, messageId } = body;

  if (!channel || !provider) {
    return Response.json({ error: 'channel and provider required' }, { status: 400 });
  }

  const config = RATE_LIMITS[`${channel}:${provider}`];
  if (!config) {
    return Response.json({ error: 'Unknown channel/provider' }, { status: 400 });
  }

  try {
    // Check if we're at limit
    const currentUsage = await getUsage(organization.id, channel, provider);
    if (currentUsage >= config.dailyLimit) {
      return Response.json({
        logged: false,
        blocked: true,
        reason: 'Daily limit reached',
        limit: config.dailyLimit,
        used: currentUsage,
      }, { status: 429 });
    }

    // Check per-second rate
    const perSecondOk = await checkPerSecondRate(organization.id, channel, provider);
    if (!perSecondOk) {
      return Response.json({
        logged: false,
        blocked: true,
        reason: 'Per-second rate limit',
        retryAfter: 1000,
      }, { status: 429 });
    }

    // Check lead-specific limits
    if (leadId && config.perLeadDailyLimit) {
      const leadUsage = await getLeadUsage(leadId, channel);
      if (leadUsage.daily >= config.perLeadDailyLimit) {
        return Response.json({
          logged: false,
          blocked: true,
          reason: 'Lead daily contact limit reached',
          leadLimit: config.perLeadDailyLimit,
          leadUsed: leadUsage.daily,
        }, { status: 429 });
      }
      if (config.perLeadWeeklyLimit && leadUsage.weekly >= config.perLeadWeeklyLimit) {
        return Response.json({
          logged: false,
          blocked: true,
          reason: 'Lead weekly contact limit reached',
          leadWeeklyLimit: config.perLeadWeeklyLimit,
          leadWeeklyUsed: leadUsage.weekly,
        }, { status: 429 });
      }
    }

    // Log the send
    await sql`
      INSERT INTO rate_limit_log (
        id, organization_id, channel, provider, lead_id, message_id, created_at
      ) VALUES (
        ${crypto.randomUUID()}, ${organization.id}, ${channel}, ${provider},
        ${leadId || null}, ${messageId || null}, NOW()
      )
    `;

    const newUsage = currentUsage + 1;

    return Response.json({
      logged: true,
      used: newUsage,
      remaining: config.dailyLimit - newUsage,
      percentUsed: Math.round((newUsage / config.dailyLimit) * 100),
    });
  } catch (error: any) {
    console.error('[RATELIMIT] Log error:', error);
    return Response.json({ error: 'Failed to log send' }, { status: 500 });
  }
}

function getNextMidnight(): Date {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
}
