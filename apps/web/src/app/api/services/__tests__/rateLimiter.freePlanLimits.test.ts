/**
 * REGRESSION TEST — free-tier plans that omit the ai_request_* keys must not
 * lock every user out of AI.
 *
 * DEFECT (found 2026-09-30, live DB): `subscription_plans.plan_free.limits`
 * carries `ai_request_allowance` (the key `tierLimits.ts` and the sidebar read)
 * but NOT `daily_ai_requests` / `weekly_ai_requests` / `monthly_ai_credits`
 * (the keys `rateLimiter.ts` reads). `checkRateLimit` coerced the missing
 * monthly key with `Number(limits[key]) || 0` and then — because the daily and
 * weekly windows are skipped when the value is 0 — evaluated ONLY the monthly
 * window with limit 0, so `check_rate_limit` denied on the very first request:
 *
 *   429 {"error":"Rate limit exceeded: You've used all 0 ai requests for this
 *        month."}
 *
 * Every organization on `plan_free` (all 10 live orgs) was therefore locked out
 * of every rate-limited AI route, with a message that also read "all 0" because
 * the limiter printed the LIMIT where it meant USAGE.
 *
 * These assertions pin the two halves of the fix:
 *   1. limit resolution never produces 0 for a plan that declares an allowance
 *      under a different (legacy) key, and
 *   2. the denial message reports usage, not the limit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.hoisted(() => vi.fn());
vi.mock('@/app/api/utils/sql', () => ({ default: sqlMock, sql: sqlMock }));

// The real plan row for `plan_free` in the live database (2026-09-30).
const FREE_PLAN_LIMITS = {
  seats: 1,
  campaigns: 1,
  is_free_tier: true,
  workflow_limit: 1,
  automation_limit: 1,
  ai_request_allowance: 10,
  monthly_sms_allowance: 25,
  monthly_lead_allowance: 10,
  monthly_email_allowance: 50,
  api_rate_limit_per_minute: 10,
};

/** Arguments of the n-th check_rate_limit(...) call. */
function callArgs(index: number) {
  return sqlMock.mock.calls[index][0] as TemplateStringsArray & { raw?: unknown[] };
}

describe('rateLimiter: free-plan limits that lack the ai_request_* keys', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('never resolves an ai_request limit of 0 from ai_request_allowance', async () => {
    const { getPlanLimitsForTest } = await import('../rateLimiter');
    const resolved = getPlanLimitsForTest(FREE_PLAN_LIMITS);

    // The monthly AI window is the one that previously became 0.
    expect(resolved.monthly_ai_credits).toBeGreaterThan(0);
    // And the plan's declared allowance is honoured, not silently dropped.
    expect(resolved.monthly_ai_credits).toBe(10);
    // The daily/weekly windows resolve from the same declared allowance.
    expect(resolved.daily_ai_requests).toBe(10);
    expect(resolved.weekly_ai_requests).toBe(10);
  });

  it('does not report the limit where it means usage', async () => {
    const { buildRateLimitMessage } = await import('../rateLimiter');
    const message = buildRateLimitMessage('ai_request', 'monthly', 0, 10, new Date(0));
    expect(message).not.toContain('all 0');
    expect(message).toContain('10');
  });

  it('still honours an explicit unlimited (-1) and a real zero monthly cap', async () => {
    const { getPlanLimitsForTest } = await import('../rateLimiter');
    expect(getPlanLimitsForTest({ monthly_ai_credits: -1 }).monthly_ai_credits).toBe(-1);
    // An explicit 0 is a deliberate "no AI on this plan" and must stay 0.
    expect(
      getPlanLimitsForTest({ ...FREE_PLAN_LIMITS, monthly_ai_credits: 0 }).monthly_ai_credits
    ).toBe(0);
  });

  it('leaves a window undefined when the plan declares nothing for it', async () => {
    const { getPlanLimitsForTest, resolveLimitValue } = await import('../rateLimiter');
    // No alias and no direct key: the caller skips the window instead of
    // evaluating a fabricated cap of 0.
    expect(resolveLimitValue({ weekly_sms: undefined }, 'weekly_sms')).toBeUndefined();
    const resolved = getPlanLimitsForTest({ monthly_ai_credits: 5 });
    expect(resolved.weekly_ai_requests).toBeUndefined();
  });
});
