/**
 * Phase 11 — persistence-backed implementation of the AI credit ledger.
 *
 * `aiCreditLimits.ts` holds the pure, testable policy (which bucket, which caps, in what order).
 * This module binds that policy to Postgres and to the existing credit ledger:
 *
 *   - included credits -> `consume_ai_included_credit` / `release_ai_included_credit`
 *     (migration 088). These counters are day/week/month scoped and are the ONLY ones gated by
 *     the weekly/daily caps.
 *   - purchased credits -> `deductCredits` / `refundCredits` from `credits.ts`, which is a
 *     separate bucket that is never blocked by the included-credit caps.
 *
 * Every failure mode here throws. `authorizeAiCreditUsage` converts a throw into a closed
 * `accounting_error` denial, so an unavailable ledger can never hand out a free AI call.
 */

import sql from './sql';
import { deductCredits, refundCredits } from './credits';
import type {
  AiCreditIncludedConsumption,
  AiCreditIncludedConsumptionInput,
  AiCreditPurchasedDebit,
  AiCreditPurchasedDebitInput,
  AiCreditUsageDeps,
  AiCreditUsageTotals,
} from './aiCreditLimits';

const DENY_REASONS = new Set(['daily_limit', 'weekly_limit', 'monthly_limit', 'allowance_exhausted']);

/** neon returns a JSONB column as an already-parsed object; be defensive about strings too. */
function parseJsonb(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function createAiCreditUsageDeps(overrides: Partial<AiCreditUsageDeps> = {}): AiCreditUsageDeps {
  const deps: AiCreditUsageDeps = {
    async consumeIncludedPeriods(
      input: AiCreditIncludedConsumptionInput,
    ): Promise<AiCreditIncludedConsumption> {
      const rows = (await sql`
        SELECT consume_ai_included_credit(
          ${input.organizationId},
          ${input.keys.day},
          ${input.keys.week},
          ${input.keys.month},
          ${input.caps.daily},
          ${input.caps.weekly},
          ${input.caps.monthly}
        ) AS result
      `) as Array<Record<string, unknown>>;

      const payload = parseJsonb(rows?.[0]?.result);
      if (!payload || typeof payload.ok !== 'boolean') {
        throw new Error('consume_ai_included_credit returned an unusable payload');
      }

      if (payload.ok) {
        const used: AiCreditUsageTotals = {
          day: toCount(payload.day),
          week: toCount(payload.week),
          month: toCount(payload.month),
        };
        return { ok: true, used };
      }

      const reason = typeof payload.reason === 'string' ? payload.reason : 'allowance_exhausted';
      return {
        ok: false,
        reason: (DENY_REASONS.has(reason) ? reason : 'allowance_exhausted') as AiCreditIncludedConsumption extends {
          ok: false;
          reason: infer R;
        }
          ? R
          : never,
      };
    },

    async debitPurchasedCredits(input: AiCreditPurchasedDebitInput): Promise<AiCreditPurchasedDebit> {
      const result = await deductCredits(
        input.organizationId,
        1,
        'DEDUCT',
        'AI credit usage (purchased credits)',
        { source: 'ai_credit_period_limits' },
        input.requestId,
      );

      if (!result.success) {
        return { ok: false, reason: 'insufficient_purchased' };
      }

      return typeof result.remainingBalance === 'number'
        ? { ok: true, remaining: result.remainingBalance }
        : { ok: true };
    },

    async releaseIncludedPeriods(input: AiCreditIncludedConsumptionInput): Promise<void> {
      await sql`
        SELECT release_ai_included_credit(
          ${input.organizationId},
          ${input.keys.day},
          ${input.keys.week},
          ${input.keys.month}
        ) AS result
      `;
    },

    async refundPurchasedCredits(input: AiCreditPurchasedDebitInput): Promise<void> {
      await refundCredits(
        input.organizationId,
        1,
        'AI credit refund (AI request failed)',
        { source: 'ai_credit_period_limits' },
      );
    },
  };

  return { ...deps, ...overrides };
}
