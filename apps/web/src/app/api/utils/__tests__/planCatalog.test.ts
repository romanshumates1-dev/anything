/**
 * Plan-catalog selection tests — the duplicate-tier regression suite.
 *
 * Guards against the nondeterministic `WHERE tier='pro' LIMIT 1` bug where
 * the billing page could quote $79 (Pro Legacy) or $299 (canonical Pro) for
 * the same plan depending on Postgres row order.
 */
import { describe, it, expect } from 'vitest';
import { isCanonicalPlanRow, selectPlanRow, dedupePlansByTier } from '../planCatalog';

const PLAN_PRO = { id: 'plan_pro', tier: 'pro', price: 299 };
const PLAN_PROFESSIONAL = { id: 'plan_professional', tier: 'pro', price: 79 };
const PLAN_STARTER = { id: 'plan_starter', tier: 'starter', price: 99 };
const PLAN_FREE = { id: 'plan_free', tier: 'free', price: 0 };

describe('isCanonicalPlanRow', () => {
  it('accepts plan_<tier> rows and rejects aliases', () => {
    expect(isCanonicalPlanRow(PLAN_PRO)).toBe(true);
    expect(isCanonicalPlanRow(PLAN_FREE)).toBe(true);
    expect(isCanonicalPlanRow(PLAN_PROFESSIONAL)).toBe(false);
  });
});

describe('selectPlanRow', () => {
  it('canonical wins for a TIER key, in either input order', () => {
    expect(selectPlanRow([PLAN_PROFESSIONAL, PLAN_PRO], 'pro')).toBe(PLAN_PRO);
    expect(selectPlanRow([PLAN_PRO, PLAN_PROFESSIONAL], 'pro')).toBe(PLAN_PRO);
  });

  it('exact primary-key match wins even for the legacy alias', () => {
    expect(selectPlanRow([PLAN_PROFESSIONAL, PLAN_PRO], 'plan_professional')).toBe(
      PLAN_PROFESSIONAL
    );
    expect(selectPlanRow([PLAN_PROFESSIONAL, PLAN_PRO], 'plan_pro')).toBe(PLAN_PRO);
  });

  it('keeps the legacy alias when no canonical row exists (compat)', () => {
    expect(selectPlanRow([PLAN_PROFESSIONAL], 'pro')).toBe(PLAN_PROFESSIONAL);
  });

  it('returns null when nothing matches', () => {
    expect(selectPlanRow([PLAN_STARTER], 'pro')).toBeNull();
    expect(selectPlanRow([], 'pro')).toBeNull();
  });

  it('never depends on input order for non-exact, non-canonical duplicates', () => {
    const a = { id: 'aaa', tier: 'custom' };
    const b = { id: 'bbb', tier: 'custom' };
    expect(selectPlanRow([a, b], 'custom')?.id).toBe('aaa');
    expect(selectPlanRow([b, a], 'custom')?.id).toBe('aaa');
  });
});

describe('dedupePlansByTier', () => {
  it('drops the legacy alias when a canonical row for the same tier exists', () => {
    const rows = [PLAN_FREE, PLAN_PROFESSIONAL, PLAN_STARTER, PLAN_PRO];
    const deduped = dedupePlansByTier(rows);
    expect(deduped.map((r) => r.id)).toEqual(['plan_free', 'plan_starter', 'plan_pro']);
    expect(deduped.some((r) => r.id === 'plan_professional')).toBe(false);
  });

  it('produces the same result regardless of input order', () => {
    const rows = [PLAN_PRO, PLAN_PROFESSIONAL, PLAN_STARTER];
    const a = dedupePlansByTier(rows).map((r) => r.id);
    const b = dedupePlansByTier([...rows].reverse()).map((r) => r.id);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('keeps the alias when it is the only row for its tier', () => {
    const deduped = dedupePlansByTier([PLAN_PROFESSIONAL, PLAN_STARTER]);
    expect(deduped.map((r) => r.id)).toEqual(['plan_professional', 'plan_starter']);
  });

  it('leaves distinct tiers untouched', () => {
    const deduped = dedupePlansByTier([PLAN_FREE, PLAN_STARTER, PLAN_PRO]);
    expect(deduped).toHaveLength(3);
  });
});
