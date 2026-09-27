/**
 * PLAN / ENTITLEMENT CONSISTENCY CHECK (section 10).
 *
 * Migration 066 deliberately kept `plan_professional` ("Pro (Legacy)") beside
 * the canonical `plan_pro`, both with tier='pro' at different prices, so
 * `WHERE tier='pro' LIMIT 1` used to be non-deterministic and could grant the
 * wrong entitlement. `api/utils/planCatalog.ts` makes the choice deterministic;
 * this script verifies the REAL data against the REAL module rather than a
 * re-implementation, because unit tests only prove the rule on fixtures.
 *
 * Read-only.
 */
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import {
  selectPlanRow,
  dedupePlansByTier,
} from '../src/app/api/utils/planCatalog';

const env: Record<string, string> = {};
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i)] = t.slice(i + 1);
}
const sql = neon(env.DATABASE_URL);

// Live column set: id, name, tier, price_cents, currency, limits, created_at,
// updated_at, stripe_price_id. There is no `features` and no `is_active`.
const rows = await sql`
  SELECT id, name, tier, price_cents, stripe_price_id
  FROM subscription_plans
  ORDER BY tier, id
`;

const usd = (cents: number) => (cents / 100).toFixed(2);
console.log(`subscription_plans rows: ${rows.length}`);
for (const r of rows) {
  console.log(
    `  ${String(r.id).padEnd(22)} tier=${String(r.tier).padEnd(14)} ` +
      `$${usd(Number(r.price_cents)).padStart(8)} stripe=${r.stripe_price_id ? 'yes' : 'none'}`
  );
}

const keyed = rows.map((r) => ({
  id: r.id,
  tier: r.tier,
  price_cents: Number(r.price_cents),
}));

const byTier = new Map<string, typeof keyed>();
for (const r of keyed) {
  const list = byTier.get(r.tier) ?? [];
  list.push(r);
  byTier.set(r.tier, list);
}

let problems = 0;

// 1. Deterministic canonical choice for every tier with more than one row.
for (const [tier, list] of [...byTier.entries()].sort()) {
  if (list.length <= 1) continue;
  const chosen = selectPlanRow(list, tier);
  if (!chosen) {
    console.log(`    PROBLEM: tier '${tier}' could not be resolved to a plan row`);
    problems++;
    continue;
  }
  console.log(
    `  [multi-row tier '${tier}'] ${list.length} rows -> canonical ${chosen.id} ($${usd(chosen.price_cents)})`
  );
  if (chosen.id !== `plan_${tier}`) {
    console.log(`    PROBLEM: canonical id is not plan_${tier}`);
    problems++;
  }
}

// 2. The dedupe helper must reduce each multi-row tier to exactly one entry.
const deduped = dedupePlansByTier(keyed);
for (const [tier, list] of [...byTier.entries()].sort()) {
  if (list.length <= 1) continue;
  const kept = deduped.filter((r) => r.tier === tier);
  if (kept.length !== 1) {
    console.log(`    PROBLEM: tier '${tier}' deduped to ${kept.length} rows, expected 1`);
    problems++;
  }
}

// 3. Every plan_id a live subscription references must resolve to a real row.
const referenced = await sql`
  SELECT DISTINCT plan_id FROM organization_subscriptions
`;
for (const r of referenced) {
  if (!r.plan_id) continue;
  const key = String(r.plan_id);
  const resolved =
    selectPlanRow(keyed, key) ?? selectPlanRow(keyed, key.replace(/^plan_/, ''));
  if (!resolved) {
    console.log(`  PROBLEM: live subscription references unknown plan '${key}'`);
    problems++;
  } else if (resolved.id !== key) {
    console.log(
      `  NOTE: subscription plan_id '${key}' resolves to canonical '${resolved.id}' ($${usd(resolved.price_cents)})`
    );
  }
}

console.log(
  problems === 0
    ? 'PLAN_GATE: PASS (canonical selection deterministic for every tier)'
    : `PLAN_GATE: FAIL (${problems} problem(s))`
);
process.exit(problems === 0 ? 0 : 1);
