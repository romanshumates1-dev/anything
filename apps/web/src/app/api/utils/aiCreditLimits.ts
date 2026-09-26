/**
 * Phase 11 — server-side AI credit authorization with weekly + daily included-credit limits.
 *
 * Rules enforced here (deterministically, server-side only):
 *   monthly included allowance = M
 *   weekly included cap        = floor(M / 4)   (at most 1/4 of the monthly included credits)
 *   daily  included cap        = floor(M / 20)  (at most 1/5 of the weekly included-credit limit)
 *
 * Included and purchased credits are separate accounting buckets:
 *   - included credits are consumed first and are subject to the weekly/daily caps above
 *   - purchased credits are limited only by their own balance and are NEVER blocked by the
 *     included-credit weekly/daily caps
 *
 * Period counters are keyed on the UTC day, the ISO-8601 week and the calendar month so that
 * every server instance and every request agrees on the same period boundaries (no timezone
 * drift, no month/week/day boundary ambiguity).
 *
 * Fail-closed: if credit accounting is unavailable the request is denied rather than being
 * granted for free. Concurrent requests are serialised by the persistence layer through a
 * single-statement guarded update; this module never mutates counters itself.
 */

export const AI_CREDIT_WEEKLY_DIVISOR = 4;
export const AI_CREDIT_DAILY_DIVISOR = 20;

export interface AiCreditPeriodCaps {
  monthly: number;
  weekly: number;
  daily: number;
}

export interface AiCreditPeriodKeys {
  /** UTC calendar day, e.g. `2026-03-04`. */
  day: string;
  /** ISO-8601 week, e.g. `2026-W10`. */
  week: string;
  /** UTC calendar month, e.g. `2026-03`. */
  month: string;
}

export interface AiCreditUsageTotals {
  day: number;
  week: number;
  month: number;
}

export type AiCreditIncludedDenyReason =
  | 'daily_limit'
  | 'weekly_limit'
  | 'monthly_limit'
  | 'allowance_exhausted';

export interface AiCreditIncludedConsumptionInput {
  organizationId: string;
  keys: AiCreditPeriodKeys;
  caps: AiCreditPeriodCaps;
  requestId?: string;
}

export type AiCreditIncludedConsumption =
  | { ok: true; used: AiCreditUsageTotals }
  | { ok: false; reason: AiCreditIncludedDenyReason };

export interface AiCreditPurchasedDebitInput {
  organizationId: string;
  requestId?: string;
}

export type AiCreditPurchasedDebit =
  | { ok: true; remaining?: number }
  | { ok: false; reason: 'insufficient_purchased' };

export interface AiCreditUsageDeps {
  /** Atomically consume one included credit across the day/week/month windows. */
  consumeIncludedPeriods: (
    input: AiCreditIncludedConsumptionInput,
  ) => Promise<AiCreditIncludedConsumption>;
  /** Atomically debit one purchased credit from the purchased bucket. */
  debitPurchasedCredits: (input: AiCreditPurchasedDebitInput) => Promise<AiCreditPurchasedDebit>;
  /** Compensating action used when the AI call fails after included credits were consumed. */
  releaseIncludedPeriods?: (input: AiCreditIncludedConsumptionInput) => Promise<void>;
  /** Compensating action used when the AI call fails after purchased credits were debited. */
  refundPurchasedCredits?: (input: AiCreditPurchasedDebitInput) => Promise<void>;
  /** Injectable clock so period boundaries stay testable. */
  now?: () => Date;
}

export interface AiCreditUsageRequest {
  organizationId: string;
  /** Included monthly AI allowance for the organization's current plan. */
  monthlyAllowance: number;
  requestId?: string;
}

export type AiCreditDenyReason = 'missing_organization' | 'no_credits' | 'accounting_error';

export type AiCreditAuthorization =
  | {
      ok: true;
      /**
       * `included`   -> one included credit was consumed against the day/week/month caps
       * `purchased` -> included credits were capped/exhausted and a purchased credit paid for it
       * `unlimited` -> the plan carries an unlimited allowance; no counter was touched
       */
      bucket: 'included' | 'purchased' | 'unlimited';
      caps: AiCreditPeriodCaps;
      keys: AiCreditPeriodKeys;
      used?: AiCreditUsageTotals;
      /** Idempotent compensation hook; call when the AI request fails after authorization. */
      release: () => Promise<void>;
    }
  | {
      ok: false;
      reason: AiCreditDenyReason;
      message: string;
      caps: AiCreditPeriodCaps;
      keys: AiCreditPeriodKeys;
    };

function toNonNegativeInt(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * Derives the weekly and daily included-credit caps from the monthly included allowance.
 *
 * weekly = floor(M / 4)  -> at most 1/4 of the monthly included credits
 * daily  = floor(M / 20) -> at most 1/5 of the weekly included-credit limit
 */
export function deriveAiCreditPeriodCaps(monthlyAllowance: number): AiCreditPeriodCaps {
  const monthly = toNonNegativeInt(monthlyAllowance);
  if (monthly === 0) return { monthly: 0, weekly: 0, daily: 0 };
  return {
    monthly,
    weekly: Math.floor(monthly / AI_CREDIT_WEEKLY_DIVISOR),
    daily: Math.floor(monthly / AI_CREDIT_DAILY_DIVISOR),
  };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function isoWeekOf(date: Date): { year: number; week: number } {
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNum = thursday.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  thursday.setUTCDate(thursday.getUTCDate() + 4 - dayNum); // move to Thursday of this ISO week
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return { year: thursday.getUTCFullYear(), week };
}

/** UTC day / ISO-8601 week / calendar month keys — identical on every server instance. */
export function getAiCreditPeriodKeys(now: Date): AiCreditPeriodKeys {
  const iso = isoWeekOf(now);
  return {
    day: `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`,
    week: `${iso.year}-W${pad2(iso.week)}`,
    month: `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`,
  };
}

function denyMessage(reason: AiCreditDenyReason): string {
  switch (reason) {
    case 'missing_organization':
      return 'AI credits could not be authorized because the account is not linked to an organization.';
    case 'accounting_error':
      return 'AI credit accounting is temporarily unavailable. Please try again shortly.';
    case 'no_credits':
    default:
      return 'AI credit limit reached for this period and no purchased credits remain. Purchase additional credits or wait for the period to reset.';
  }
}

/**
 * Authorizes a single AI credit spend for an organization.
 *
 * Order of consumption (deterministic):
 *   1. included subscription credits — gated by the weekly/daily/monthly caps above
 *   2. purchased credits           — bounded only by their own balance
 *
 * Never throws: accounting failures fail closed with `accounting_error` so a request can never
 * receive free credits because the ledger is unavailable.
 */
export async function authorizeAiCreditUsage(
  request: AiCreditUsageRequest,
  deps: AiCreditUsageDeps,
): Promise<AiCreditAuthorization> {
  const now = deps.now ? deps.now() : new Date();
  const keys = getAiCreditPeriodKeys(now);
  const caps = deriveAiCreditPeriodCaps(request.monthlyAllowance);

  if (!request.organizationId) {
    return {
      ok: false,
      reason: 'missing_organization',
      message: denyMessage('missing_organization'),
      caps,
      keys,
    };
  }

  const includedInput: AiCreditIncludedConsumptionInput = {
    organizationId: request.organizationId,
    keys,
    caps,
    ...(request.requestId ? { requestId: request.requestId } : {}),
  };

  if (caps.monthly > 0) {
    try {
      const consumed = await deps.consumeIncludedPeriods(includedInput);
      if (consumed.ok) {
        let released = false;
        return {
          ok: true,
          bucket: 'included',
          caps,
          keys,
          used: consumed.used,
          release: async () => {
            if (released) return;
            released = true;
            await deps.releaseIncludedPeriods?.(includedInput);
          },
        };
      }
    } catch {
      return {
        ok: false,
        reason: 'accounting_error',
        message: denyMessage('accounting_error'),
        caps,
        keys,
      };
    }
  }

  const purchasedInput: AiCreditPurchasedDebitInput = {
    organizationId: request.organizationId,
    ...(request.requestId ? { requestId: request.requestId } : {}),
  };

  try {
    const debited = await deps.debitPurchasedCredits(purchasedInput);
    if (!debited.ok) {
      return {
        ok: false,
        reason: 'no_credits',
        message: denyMessage('no_credits'),
        caps,
        keys,
      };
    }
    let released = false;
    return {
      ok: true,
      bucket: 'purchased',
      caps,
      keys,
      ...(typeof debited.remaining === 'number' ? { used: undefined } : {}),
      release: async () => {
        if (released) return;
        released = true;
        await deps.refundPurchasedCredits?.(purchasedInput);
      },
    };
  } catch {
    return {
      ok: false,
      reason: 'accounting_error',
      message: denyMessage('accounting_error'),
      caps,
      keys,
    };
  }
}
