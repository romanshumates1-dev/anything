import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import {
  getSubscription,
  getUsageCount,
  isActiveStatus,
  periodTag,
} from '@/app/api/utils/entitlement';
import { capForMetric, getPlan, includedSmsSegments, type PlanId } from '@/config/plans';

/**
 * The signed-in user's current subscription + this period's usage against caps.
 * Drives the in-app billing screen. Auth required; a user only ever sees their
 * own subscription (keyed by session user id — no id param, no IDOR surface).
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 });
  }

  try {
    const sub = await getSubscription(session.user.id);
    const plan: PlanId = sub?.plan ?? 'starter';
    const period = periodTag(sub);
    const def = getPlan(plan);

    const [smsUsed, leadsUsed, aiUsed] = await Promise.all([
      getUsageCount(session.user.id, period, 'sms_segments'),
      getUsageCount(session.user.id, period, 'leads'),
      getUsageCount(session.user.id, period, 'ai_replies'),
    ]);

    return Response.json({
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            active: isActiveStatus(sub.status),
            trialEnd: sub.trial_end,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            registrationGrace: sub.registration_grace,
          }
        : { plan: 'starter', status: 'none', active: false },
      plan: { id: def.id, name: def.name, byoAiKeyAllowed: def.byoAiKeyAllowed },
      period,
      usage: {
        sms_segments: { used: smsUsed, cap: includedSmsSegments(plan) },
        leads: { used: leadsUsed, cap: capForMetric(plan, 'leads') },
        ai_replies: { used: aiUsed, cap: capForMetric(plan, 'ai_replies') },
      },
    });
  } catch (err) {
    console.error('GET /api/billing/subscription error', err);
    return Response.json({ error: { code: 'INTERNAL', message: 'Internal Server Error' } }, { status: 500 });
  }
}
