/**
 * Pricing-display single-source-of-truth guard (transform-independent).
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Checkout ALWAYS reads the billed amount from the DB `subscription_plans`
 * row (migration 067: plan_starter=12900c, plan_pro=39900c,
 * plan_business=89900c, plan_scale=249900c) via planCatalog.selectPlanRow +
 * billing/subscribe/route.ts ("Pricing is sourced from subscription_plans ...
 * Do NOT hardcode prices here"). But /pricing DISPLAY reads
 * `pricingTiers.ts` PRICING_TIERS, which held STALE prices
 * (starter 100, pro 299, business 599, scale 1500) vs the DB authoritative
 * value-based prices (129 / 399 / 899 / 2499).
 *
 * A visitor saw "$1,500/mo" for Scale on /pricing while checkout charged
 * "$2,499". The billed amount is/was correct (DB wins); only the advertised
 * display price was wrong. This test pins pricingTiers.ts monthly prices to
 * migration 067 cents so the gap cannot silently return.
 *
 * READS BOTH SOURCES FROM DISK (no runtime import of pricingTiers.ts) so it is
 * immune to the vitest/SWC transform limitation that drops
 * `export const ... as const` object exports in some SWC versions. The prod
 * Next.js build parses pricingTiers.ts correctly; only the test transform
 * misbehaves. This tests exactly what is shipped.
 *
 * Excluded (intentional divergence, no billing/display truth gap):
 *  - FREE: $0 in DB, hard-capped; not shown as a price tag on /pricing; not in
 *    pricingTiers.ts (Starter is the entry paid tier there).
 *  - ENTERPRISE: "custom pricing" ($0) in DB (plan_enterprise), not a
 *    self-service price tag.
 *  - GROWTH/PROFESSIONAL/ELITE: marketing-only tiers with no DB plan rows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const repoRoot = process.cwd();
const migration067 = readFileSync(
  `${repoRoot}/db/migrations/067_value_based_pricing.sql`,
  'utf8',
);
const pricingTiersSrc = readFileSync(
  `${repoRoot}/src/app/api/utils/pricingTiers.ts`,
  'utf8',
);

/** Extract (price_cents, tier) for a plan_id from migration 067 INSERTs. */
function planRow(sql: string, planId: string): { cents: number; tier: string } | null {
  // ('plan_scale', 'Scale', 'scale', 249900, '{...json...}')
  const re = new RegExp(
    `\\(\\s*['"]${planId}['"]\\s*,\\s*['"][^'"]+['"]\\s*,\\s*['"]([^'"]+)['"]\\s*,\\s*(\\d+)\\s*,`,
    'i',
  );
  const m = sql.match(re);
  return m ? { cents: Number(m[2]), tier: m[1] } : null;
}

/** Extract prices[1] (monthly) for a TIER key from pricingTiers.ts source text. */
function monthlyPriceFromSrc(src: string, tierKey: string): number | null {
  // matches:  SCALE: { ... prices: { 1: 2499, ... }
  const re = new RegExp(`${tierKey}:\\s*\\{[^]*?prices:\\s*\\{[^]*?1:\\s*(\\d+)`, 's');
  const m = src.match(re);
  return m ? Number(m[1]) : null;
}

describe('pricingTiers.ts mirrors the DB plan prices (migration 067)', () => {
  it('SCALE monthly price matches the 249900-cent DB seed', () => {
    const row = planRow(migration067, 'plan_scale');
    expect(row, 'migration 067 must seed plan_scale').not.toBeNull();
    expect(row!.cents).toBe(249900);
    const displayed = monthlyPriceFromSrc(pricingTiersSrc, 'SCALE');
    expect(displayed, 'pricingTiers.ts must define SCALE.prices[1]').not.toBeNull();
    expect(displayed).toBe(row!.cents / 100);
  });

  it('every DB-backed paid-tier monthly price matches its seeded plan row', () => {
    const tierToPlan: Record<string, string> = {
      STARTER: 'plan_starter',
      PRO: 'plan_pro',
      BUSINESS: 'plan_business',
      SCALE: 'plan_scale',
    };
    for (const [tierKey, planId] of Object.entries(tierToPlan)) {
      const row = planRow(migration067, planId);
      expect(row, `migration 067 must seed ${planId}`).not.toBeNull();
      const displayed = monthlyPriceFromSrc(pricingTiersSrc, tierKey);
      expect(
        displayed,
        `${tierKey} pricingTiers.ts must define prices[1] for display`,
      ).not.toBeNull();
      expect(
        displayed,
        `${tierKey} display price must equal ${row!.cents / 100} ` +
          `(DB ${planId}, tier '${row!.tier}')`,
      ).toBe(row!.cents / 100);
    }
  });
});
