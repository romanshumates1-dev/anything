import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import { getRateLimitSummary } from '@/app/api/services/rateLimiter';
import sql from '@/app/api/utils/sql';

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get user's organization if any
    const orgRows = await sql`
      SELECT organization_id FROM organization_members
      WHERE user_id = ${session.userId}
      LIMIT 1
    `;
    const organizationId = orgRows[0]?.organization_id as string | undefined;

    const summary = await getRateLimitSummary(session.userId, organizationId);

    return NextResponse.json({
      tier: summary.tier,
      planName: summary.planName,
      limits: {
        daily: {
          ai_requests: {
            used: summary.daily.ai_request.currentUsage,
            limit: summary.daily.ai_request.limit,
            remaining: summary.daily.ai_request.remaining,
            resetsAt: summary.daily.ai_request.resetsAt.toISOString(),
          },
          sms: {
            used: summary.daily.sms.currentUsage,
            limit: summary.daily.sms.limit,
            remaining: summary.daily.sms.remaining,
            resetsAt: summary.daily.sms.resetsAt.toISOString(),
          },
          emails: {
            used: summary.daily.email.currentUsage,
            limit: summary.daily.email.limit,
            remaining: summary.daily.email.remaining,
            resetsAt: summary.daily.email.resetsAt.toISOString(),
          },
        },
        weekly: {
          ai_requests: {
            used: summary.weekly.ai_request.currentUsage,
            limit: summary.weekly.ai_request.limit,
            remaining: summary.weekly.ai_request.remaining,
            resetsAt: summary.weekly.ai_request.resetsAt.toISOString(),
          },
          sms: {
            used: summary.weekly.sms.currentUsage,
            limit: summary.weekly.sms.limit,
            remaining: summary.weekly.sms.remaining,
            resetsAt: summary.weekly.sms.resetsAt.toISOString(),
          },
          emails: {
            used: summary.weekly.email.currentUsage,
            limit: summary.weekly.email.limit,
            remaining: summary.weekly.email.remaining,
            resetsAt: summary.weekly.email.resetsAt.toISOString(),
          },
        },
        monthly: {
          ai_requests: {
            used: summary.monthly.ai_request.currentUsage,
            limit: summary.monthly.ai_request.limit,
            remaining: summary.monthly.ai_request.remaining,
            resetsAt: summary.monthly.ai_request.resetsAt.toISOString(),
          },
          sms: {
            used: summary.monthly.sms.currentUsage,
            limit: summary.monthly.sms.limit,
            remaining: summary.monthly.sms.remaining,
            resetsAt: summary.monthly.sms.resetsAt.toISOString(),
          },
          emails: {
            used: summary.monthly.email.currentUsage,
            limit: summary.monthly.email.limit,
            remaining: summary.monthly.email.remaining,
            resetsAt: summary.monthly.email.resetsAt.toISOString(),
          },
        },
      },
    });
  } catch (error) {
    console.error('[RATE_LIMITS] Error fetching rate limits:', error);
    return NextResponse.json({ error: 'Failed to fetch rate limits' }, { status: 500 });
  }
}
