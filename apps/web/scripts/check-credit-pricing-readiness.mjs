#!/usr/bin/env node
/**
 * check-credit-pricing-readiness.mjs — billing-readiness rollout gate (F3 follow-through).
 *
 * Verifies from live repo sources only (no DB, no network, no secrets):
 *  1. `db/migrations/080_credit_system.sql` seeds exactly 30 `credit_costs` rows
 *     (5 tiers x 6 actions) and holds NO professional/scale rows (the known gap).
 *  2. `src/app/api/utils/credits.ts` fail-closed safeguards: CREDIT_TIERS mirrors
 *     the 5 seeded tiers; getAllCosts never unions a FREE fallback; getCreditCost
 *     rejects unknown tiers + missing paid-tier action rows before any debit;
 *     deductCreditsForAction returns PRICING_NOT_CONFIGURED (no wrong debit).
 *  3. `src/app/api/utils/creditGuard.ts` maps the pricing throw to allowed:false
 *     (clean HTTP 402, never an uncaught 500).
 *  4. `(marketing)/pricing/page.tsx` scope: renders free/starter/pro/business/scale,
 *     never the defunct 'professional' label.
 *  5. `067_value_based_pricing.sql` seeds plan_scale at $2,499/mo (249900c).
 *
 * Exit codes: 0 = rollout-ready (safeguards hold AND scale/professional priced);
 * 1 = code-safeguard defect (fix code first); 2 = safeguards hold but pricing is
 * incomplete (BLOCKED-APPROVAL — owner must set per-action rates; never invent them).
 *
 * Run from repo root: `node apps/web/scripts/check-credit-pricing-readiness.mjs`
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(appRoot, rel), 'utf8');

const ACTIONS = ['SMS_SEND', 'EMAIL_SEND', 'AI_REQUEST', 'AI_NEGOTIATION', 'CONTRACT_GENERATE', 'LEAD_FIND'];
const SEEDED_TIERS = ['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'];
const UNPRICED_TIERS = ['PROFESSIONAL', 'SCALE'];

const failures = [];
const blocks = [];
function check(name, ok, opts = {}) {
  const { block = false, detail = '' } = opts;
  console.log(`${ok ? 'PASS   ' : block ? 'BLOCKED' : 'FAIL   '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) (block ? blocks : failures).push(name);
}

// 1 — seeded credit_costs matrix (migration 080).
const seedSql = read('db/migrations/080_credit_system.sql');
const tuples = [...seedSql.matchAll(/\(\s*'([A-Z_]+)'\s*,\s*'([A-Z]+)'\s*,\s*(\d+)\s*\)/g)].map((m) => ({
  action: m[1],
  tier: m[2],
  cost: Number(m[3]),
}));
const have = new Set(tuples.map((t) => `${t.tier}/${t.action}`));
check('080 seeds the full matrix (5 tiers x 6 actions = 30 rows)', tuples.length >= 30, {
  detail: `found ${tuples.length}`,
});
for (const tier of SEEDED_TIERS) {
  for (const action of ACTIONS) check(`080 seeds ${tier}/${action}`, have.has(`${tier}/${action}`));
}
for (const tier of UNPRICED_TIERS) {
  // `ok` = the tier IS priced. While a live tier has no credit_costs rows the
  // check fails with block:true -> exit 2 (HOLD / BLOCKED-APPROVAL) and the
  // per-action table above prints MISSING for every row — rates are never
  // invented. Once the owner-approved migration seeds the rows, the block
  // clears and the gate falls through to READY (exit 0).
  const priced = tuples.some((t) => t.tier === tier);
  check(`${tier} credit_costs rows`, priced, {
    block: true,
    detail: priced
      ? 'priced from approved migration'
      : 'KNOWN GAP — owner must approve per-action rates; migration NOT applied',
  });
}

// Decision table: verbatim seeds; MISSING is reported, never invented.
console.log('\nPer-action credit costs (verbatim from 080; MISSING = no row):');
for (const action of ACTIONS) {
  const parts = [];
  for (const tier of ['FREE', 'STARTER', 'PRO', 'PROFESSIONAL', 'BUSINESS', 'SCALE', 'ENTERPRISE']) {
    const t = tuples.find((x) => x.tier === tier && x.action === action);
    parts.push(`${tier}=${t ? t.cost : 'MISSING'}`);
  }
  console.log(`  ${action}: ${parts.join(' ')}`);
}
console.log('');

// 2 — fail-closed code safeguards (credits.ts).
const credits = read('src/app/api/utils/credits.ts');
// Scan executable code, not prose: getAllCosts' docblock deliberately
// DOCUMENTS the banned `OR tier = 'FREE'` fallback to explain why it was
// removed (F3 history). Strip block comments and whole-line // comments so
// that history cannot trip this guard; string literals and SQL in live code
// are still scanned (a reintroduced fallback would be caught).
const creditsCode = credits
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const tierLine = credits.split('\n').find((l) => l.includes('CREDIT_TIERS =')) || '';
check(
  'CREDIT_TIERS mirrors exactly the 5 seeded tiers',
  SEEDED_TIERS.every((t) => tierLine.includes(`'${t}'`)) &&
    !tierLine.includes('SCALE') &&
    !tierLine.includes('PROFESSIONAL'),
  { detail: tierLine.trim().slice(0, 110) },
);
check("getAllCosts never unions a FREE fallback (no OR tier='FREE')", !creditsCode.includes("OR tier = 'FREE'"));
check('getCreditCost rejects unknown tiers before SQL', credits.includes('refusing to price it at FREE'));
check('getCreditCost throws on a missing paid-tier action row', credits.includes('no credit_costs row for'));
check(
  'deductCreditsForAction fails closed with PRICING_NOT_CONFIGURED',
  credits.includes('PRICING_NOT_CONFIGURED'),
);

// 3 — API failure path (creditGuard.ts): clean 402, never a 500.
const guard = read('src/app/api/utils/creditGuard.ts');
check(
  'creditGuard maps pricing failure to allowed:false (clean 402)',
  guard.includes('Pricing is not configured for your plan'),
);

// 4 — pricing-page scope: scale is live, professional is defunct.
const pricingPage = read('src/app/(marketing)/pricing/page.tsx');
check(
  'pricing page renders free/starter/pro/business/scale',
  pricingPage.includes("WHERE tier IN ('free', 'starter', 'pro', 'business', 'scale')"),
);
check("pricing page has no 'professional' tier entry", !pricingPage.includes('professional:'));

// 5 — authoritative Scale plan price (migration 067).
const vbp = read('db/migrations/067_value_based_pricing.sql');
check('067 seeds plan_scale at $2,499/mo (249900c)', vbp.includes("'plan_scale', 'Scale', 'scale', 249900"));

console.log('');
if (failures.length === 0 && blocks.length === 0) {
  console.log('READY: safeguards hold and all enabled tiers are priced.');
  process.exit(0);
}
if (failures.length > 0) {
  console.log(`NOT READY: ${failures.length} safeguard defect(s) — fix code before any rollout.`);
  process.exit(1);
}
console.log(
  `HOLD (BLOCKED-APPROVAL): safeguards hold; ${blocks.length} pricing item(s) need owner rates. ` +
    'Fail-closed behavior active (HTTP 402, deducted:0, no ledger write).',
);
process.exit(2);
