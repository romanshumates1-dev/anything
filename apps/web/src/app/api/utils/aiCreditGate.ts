/**
 * Phase 11 — the server-side gate for AI-consuming routes.
 *
 * Routes should not know about credit buckets, caps or fallbacks. They call
 * `authorizeAiRequest(orgId)` before doing AI work, and:
 *
 *   - `ok: true,  bucket: 'unlimited'` -> proceed, nothing was charged
 *   - `ok: true,  bucket: 'included'`  -> proceed, one included credit consumed
 *   - `ok: true,  bucket: 'purchased'` -> proceed, one purchased credit debited
 *   - `ok: false`                      -> refuse with `message` / `reason`
 *
 * If the work then FAILS, the caller must invoke the returned `release()` so the
 * consumed credit is compensated. `release()` is idempotent, so it is safe in a
 * `finally`-style cleanup path.
 */

import { getSubscriptionStatus } from './subscriptionGuard';
import { createAiCreditUsageDeps } from './aiCreditDb';
import {
  authorizeAiCreditUsage,
  getAiCreditPeriodKeys,
  type AiCreditAuthorization,
  type AiCreditUsageDeps,
} from './aiCreditLimits';

/** Sentinel allowance used by the plan catalog for "unlimited". */
export const UNLIMITED_AI_CREDITS = -1;

export interface AiCreditGateDeps {
  /** Resolves the plan's monthly INCLUDED AI allowance (-1 = unlimited). */
  getMonthlyAllowance: (organizationId: string) => Promise<number>;
  usageDeps: AiCreditUsageDeps;
}

export interface AuthorizeAiRequestOptions {
  /** Idempotency key so a retried request cannot be charged twice. */
  requestId?: string;
}

/** Reads the included monthly allowance from the organization's subscription. */
async function monthlyAllowanceFromSubscription(organizationId: string): Promise<number> {
  const subscription = await getSubscriptionStatus(organizationId);
  const allowance = subscription?.limits?.monthly_ai_credits;
  return typeof allowance === 'number' ? allowance : 0;
}

export function createAiCreditGateDeps(overrides: Partial<AiCreditGateDeps> = {}): AiCreditGateDeps {
  return {
    getMonthlyAllowance: monthlyAllowanceFromSubscription,
    usageDeps: createAiCreditUsageDeps(),
    ...overrides,
  };
}

function noopRelease(): Promise<void> {
  return Promise.resolve();
}

export async function authorizeAiRequest(
  organizationId: string,
  options: AuthorizeAiRequestOptions = {},
  deps: AiCreditGateDeps = createAiCreditGateDeps(),
): Promise<AiCreditAuthorization> {
  const now = deps.usageDeps.now ? deps.usageDeps.now() : new Date();
  const keys = getAiCreditPeriodKeys(now);

  if (!organizationId) {
    const caps = { monthly: 0, weekly: 0, daily: 0 };
    return {
      ok: false,
      reason: 'missing_organization',
      message: 'AI credits could not be authorized because the account is not linked to an organization.',
      caps,
      keys,
    };
  }

  let monthlyAllowance: number;
  try {
    monthlyAllowance = await deps.getMonthlyAllowance(organizationId);
  } catch {
    const caps = { monthly: 0, weekly: 0, daily: 0 };
    return {
      ok: false,
      reason: 'accounting_error',
      message: 'AI credit accounting is temporarily unavailable. Please try again shortly.',
      caps,
      keys,
    };
  }

  // An unlimited plan is never capped and never consumes a credit.
  if (monthlyAllowance === UNLIMITED_AI_CREDITS) {
    return {
      ok: true,
      bucket: 'unlimited',
      caps: { monthly: UNLIMITED_AI_CREDITS, weekly: UNLIMITED_AI_CREDITS, daily: UNLIMITED_AI_CREDITS },
      keys,
      release: noopRelease,
    };
  }

  // NOTE: a plan with zero included AI credits must NOT be denied here. A zero monthly
  // allowance simply means the included bucket is empty — the caller may still hold PURCHASED
  // credits, and those are explicitly NOT gated by the included-credit caps. `authorizeAiCreditUsage`
  // already skips the included bucket when its monthly cap is 0 and falls through to the purchased
  // bucket, returning `no_credits` only when BOTH are empty. Denying up front would lock a paying
  // customer out of credits they already bought.

  return authorizeAiCreditUsage(
    {
      organizationId,
      monthlyAllowance,
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
    deps.usageDeps,
  );
}
