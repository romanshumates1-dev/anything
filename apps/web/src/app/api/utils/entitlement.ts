/**
 * entitlement — the server-side paywall + usage gate.
 *
 * Two concerns, both enforced here (never in the UI alone):
 *   1. ACCESS: does this user have an active/trialing subscription? (paywall)
 *   2. USAGE:  would this action exceed the plan's cap for a metric? (limits)
 *
 * All plan numbers come from src/config/plans.ts. All cap arithmetic comes from
 * billing-math.ts. This module is only the DB glue: read subscription, read/
 * increment usage counters, record Twilio spend. Fail-closed on error.
 *
 * The 10DLC registration-grace rule lives here too: usage tagged
 * category='registration' is tracked but NEVER counts against a cap — it is the
 * traffic a carrier requires during A2P campaign registration, and burning the
 * customer's paid allowance on it would be a cruel experience.
 */
import { headers } from 'next/headers';

import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { isEmailDomainAllowed } from '@/app/api/utils/access-control';
import {
  capForMetric,
  getPlan,
  isPeriodMetric,
  twilioCostPerSegmentCents,
  type PlanId,
  type UsageMetric,
} from '@/config/plans';
import {
  remainingAllowance,
  trueTwilioCostCents,
  wouldExceedCap,
} from '@/config/billing-math';
import { smsSegmentCount } from '@/config/sms-segments';

export type UsageCategory = 'campaign' | 'registration';

/** Subscription statuses that grant platform access. past_due keeps access
 *  during Stripe dunning; canceled/incomplete/unpaid do not. */
export const ACTIVE_STATUSES = ['trialing', 'active', 'past_due'] as const;

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: PlanId;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  registration_grace: boolean;
}

export async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  const rows = (await sql`
    SELECT id, user_id, plan, status, stripe_customer_id, stripe_subscription_id,
           stripe_price_id, current_period_start, current_period_end, trial_end,
           cancel_at_period_end, registration_grace
    FROM subscriptions WHERE user_id = ${userId} LIMIT 1
  `) as SubscriptionRow[];
  return rows[0] ?? null;
}

/** Create a trialing 'starter' subscription for a user if none exists.
 *  Idempotent (ON CONFLICT DO NOTHING on the unique user_id index). */
export async function ensureSubscription(
  userId: string,
  plan: PlanId = 'starter',
  trialDays = 30
): Promise<SubscriptionRow> {
  const trialEnd = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO subscriptions (user_id, plan, status, trial_end, current_period_start, current_period_end)
    VALUES (${userId}, ${plan}, 'trialing', ${trialEnd}, now(), ${trialEnd})
    ON CONFLICT (user_id) DO NOTHING
  `;
  const sub = await getSubscription(userId);
  if (!sub) throw new Error('ensureSubscription: row missing after upsert');
  return sub;
}

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** Billing-period tag used to key usage counters. Uses the Stripe period start
 *  month when present, else the current UTC month, so counters reset per period. */
export function periodTag(sub: Pick<SubscriptionRow, 'current_period_start'> | null): string {
  const d = sub?.current_period_start ? new Date(sub.current_period_start) : new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export async function getUsageCount(
  userId: string,
  period: string,
  metric: UsageMetric,
  category: UsageCategory = 'campaign'
): Promise<number> {
  const rows = (await sql`
    SELECT count FROM usage_counters
    WHERE user_id = ${userId} AND period = ${period} AND metric = ${metric} AND category = ${category}
    LIMIT 1
  `) as { count: string | number }[];
  return rows[0] ? Number(rows[0].count) : 0;
}

/** Atomically add `n` to a usage counter, returning the new total. */
export async function consumeUsage(
  userId: string,
  period: string,
  metric: UsageMetric,
  n: number,
  category: UsageCategory = 'campaign'
): Promise<number> {
  const rows = (await sql`
    INSERT INTO usage_counters (user_id, period, metric, category, count)
    VALUES (${userId}, ${period}, ${metric}, ${category}, ${n})
    ON CONFLICT (user_id, period, metric, category)
    DO UPDATE SET count = usage_counters.count + ${n}, updated_at = now()
    RETURNING count
  `) as { count: string | number }[];
  return rows[0] ? Number(rows[0].count) : n;
}

export async function recordTwilioSpend(
  userId: string,
  period: string,
  segments: number,
  costCents: number,
  category: UsageCategory = 'campaign',
  messageSid?: string
): Promise<void> {
  await sql`
    INSERT INTO twilio_spend_ledger (user_id, period, segments, cost_cents, category, message_sid)
    VALUES (${userId}, ${period}, ${segments}, ${costCents}, ${category}, ${messageSid ?? null})
  `;
}

/**
 * Meter ONE actually-sent SMS (G-5): increment the segment counter for the
 * billing period AND record the true Twilio spend, using the message's real
 * segment count (GSM-7 vs UCS-2). This replaces the launch-time projection —
 * the launch route still GATES on the projected count, but the number that
 * lands in usage/spend is now the number actually sent.
 *
 * Registration-grace traffic is metered into its own category so it never
 * counts against the plan cap (periodTwilioCostCents/getUsageCount read the
 * 'campaign' category only).
 */
export async function meterSmsSend(
  userId: string,
  text: string,
  opts: { messageSid?: string; category?: UsageCategory } = {}
): Promise<{ segments: number; costCents: number }> {
  const segments = smsSegmentCount(text);
  if (segments <= 0) return { segments: 0, costCents: 0 };
  const category = opts.category ?? 'campaign';
  const sub = await getSubscription(userId);
  const period = periodTag(sub);
  const costCents = trueTwilioCostCents(segments, twilioCostPerSegmentCents());
  await consumeUsage(userId, period, 'sms_segments', segments, category);
  await recordTwilioSpend(userId, period, segments, costCents, category, opts.messageSid);
  return { segments, costCents };
}

export async function periodTwilioCostCents(userId: string, period: string): Promise<number> {
  const rows = (await sql`
    SELECT COALESCE(SUM(cost_cents), 0) AS total FROM twilio_spend_ledger
    WHERE user_id = ${userId} AND period = ${period} AND category = 'campaign'
  `) as { total: string | number }[];
  return rows[0] ? Number(rows[0].total) : 0;
}

export interface UsageDecision {
  allowed: boolean;
  metric: UsageMetric;
  current: number;
  requested: number;
  cap: number | null;
  remaining: number;
  reason?: string;
}

/**
 * Would `requested` more of `metric` be allowed for this user right now?
 * - category='registration' → always allowed (grace), never counts.
 * - period metrics → checked against usage_counters for the current period.
 * - point-in-time metrics (campaigns_active, contacts_stored) → the caller
 *   passes the current total via `opts.current` (it lives in domain tables).
 */
export async function checkUsage(
  userId: string,
  metric: UsageMetric,
  requested = 1,
  opts: { category?: UsageCategory; current?: number } = {}
): Promise<UsageDecision> {
  const category = opts.category ?? 'campaign';

  // Registration-grace traffic is exempt from ALL caps and needs no plan
  // lookup — 10DLC campaign-registration sends must never burn the paid
  // allowance. Checked first so it is DB-free and cannot fail closed on a DB
  // blip during registration.
  if (category === 'registration') {
    return {
      allowed: true,
      metric,
      current: 0,
      requested,
      cap: null,
      remaining: Number.POSITIVE_INFINITY,
      reason: 'registration-grace (10DLC): not counted against plan cap',
    };
  }

  try {
    const sub = await getSubscription(userId);
    const plan: PlanId = sub?.plan ?? 'starter';
    const cap = capForMetric(plan, metric);
    const period = periodTag(sub);
    const current = isPeriodMetric(metric)
      ? await getUsageCount(userId, period, metric, category)
      : opts.current ?? 0;

    // sms_segments: defense-in-depth — also refuse if realized+projected Twilio
    // spend would exceed the funded budget (never spend past what the fee funds).
    if (metric === 'sms_segments' && cap !== null) {
      const spent = await periodTwilioCostCents(userId, period);
      const projected = spent + trueTwilioCostCents(requested, twilioCostPerSegmentCents());
      const budget = capForMetricBudgetCents(plan);
      if (budget !== null && projected > budget) {
        return {
          allowed: false,
          metric,
          current,
          requested,
          cap,
          remaining: remainingAllowance(current, cap),
          reason: 'twilio-budget-cap: projected spend exceeds funded budget',
        };
      }
    }

    const allowed = !wouldExceedCap(current, requested, cap);
    return {
      allowed,
      metric,
      current,
      requested,
      cap,
      remaining: remainingAllowance(current, cap),
      reason: allowed ? undefined : 'usage-cap: plan limit reached',
    };
  } catch (err) {
    console.error('checkUsage error (failing closed)', err);
    return {
      allowed: false,
      metric,
      current: 0,
      requested,
      cap: 0,
      remaining: 0,
      reason: 'entitlement error — failing closed',
    };
  }
}

/** The Twilio budget (cents) a plan funds — used for the spend-cap check. */
function capForMetricBudgetCents(plan: PlanId): number | null {
  return getPlan(plan).smsBudgetCents;
}

// ── route gate ────────────────────────────────────────────────────────────
export type EntitlementCheck =
  | { ok: true; userId: string; plan: PlanId; status: string }
  | { ok: false; response: Response };

/**
 * Gate for routes that require a paying/trialing subscription. Mirrors
 * requireAdmin's shape. Returns 401 (no session), 403 (domain), or 402
 * (Payment Required) when there is no active subscription.
 */
export async function requireActiveSubscription(): Promise<EntitlementCheck> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { ok: false, response: Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 }) };
  }
  const [user] = (await sql`SELECT email FROM "user" WHERE id = ${session.user.id} LIMIT 1`) as { email: string }[];
  if (!user || !isEmailDomainAllowed(user.email)) {
    return { ok: false, response: Response.json({ error: { code: 'FORBIDDEN', message: 'Account domain not authorized' } }, { status: 403 }) };
  }
  const sub = await getSubscription(session.user.id);
  if (!sub || !isActiveStatus(sub.status)) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: 'PAYMENT_REQUIRED', message: 'An active subscription is required. Choose a plan to continue.' } },
        { status: 402 }
      ),
    };
  }
  return { ok: true, userId: session.user.id, plan: sub.plan, status: sub.status };
}
