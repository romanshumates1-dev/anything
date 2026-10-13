/**
 * Regression guard — `check-credit-pricing-readiness.mjs` rollout gate (F3).
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The F3 follow-through hardened billing so an unmapped tier can NEVER receive
 * silent FREE pricing: `getCreditCost`/`getAllCosts` throw, `canAffordAction`
 * propagates, `deductCreditsForAction` returns `PRICING_NOT_CONFIGURED` with
 * deducted:0, and `creditGuard.checkCredits` maps it to a clean 402. Those are
 * unit-tested in `credits.test.ts` / `creditTierPricing.f3.test.ts` — but no test
 * pinned the *rollout* invariant: the repo must not be deployed to production
 * while a live `subscription_plans` tier (SCALE, $2,499/mo per migration 067, and
 * rendered by the pricing page) has zero `credit_costs` rows in migration 080.
 * An earlier draft of this cycle's own checkpoint wrote "45 rows" for the 080
 * seed (5 tiers × 6 actions = 30) — proof that the seed matrix needs a machine
 * check, not eyeballing.
 *
 * WHAT IS ASSERTED (offline, no DB, no network, no secrets)
 * ----------------------------------------------------------
 * 1. The 080 seed matrix: exactly 30 rows, 5 tiers × 6 actions, SCALE and
 *    PROFESSIONAL absent.
 * 2. The gate script exits 2 (HOLD / BLOCKED-APPROVAL) on the current repo:
 *    safeguards hold, but SCALE (the only live tier with unpriced credit_costs)
 *    needs owner approval for per-action rates before any pricing migration is
 *    seeded. PROFESSIONAL is NOT blocked - it is a deprecated alias normalised to
 *    PRO at runtime (migration 066 + entitlements.ts:getOrganizationTier), and
 *    PRO already has credit_costs rows. Its stdout prints the verbatim per-action
 *    table with MISSING for unpriced tiers - never an invented rate.
 * 3. The gate exits 0 (READY) against a fully-priced fixture tree — proving the
 *    gate opens once the owner approves rates and the migration lands, not stuck
 *    red forever. (Fixture costs are placeholders used ONLY to exercise the gate
 *    logic; they are never shipped and never asserted as correct prices.)
 *
 * The script itself is the rollout checklist (Priority 2 of the directive);
 * this test proves the checklist executes and reports honestly.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_ROOT = process.cwd();
const SCRIPT = join(APP_ROOT, 'scripts', 'check-credit-pricing-readiness.mjs');
const SEED = join(APP_ROOT, 'db', 'migrations', '080_credit_system.sql');

const TUPLE_RE = /\(\s*'([A-Z_]+)'\s*,\s*'([A-Z]+)'\s*,\s*(\d+)\s*\)/g;
const SEEDED_TIERS = ['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE'];
const ACTIONS = [
  'SMS_SEND',
  'EMAIL_SEND',
  'AI_REQUEST',
  'AI_NEGOTIATION',
  'CONTRACT_GENERATE',
  'LEAD_FIND',
];

function runGate(scriptPath: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    return { code: 0, out: String(out) };
  } catch (e: any) {
    return { code: e?.status ?? 99, out: `${e?.stdout ?? ''}${e?.stderr ?? ''}` };
  }
}

describe('credit-pricing rollout gate (F3)', () => {
  it('pins the 080 seed matrix: 30 rows, 5 tiers, SCALE/PROFESSIONAL absent', () => {
    const sql = readFileSync(SEED, 'utf8');
    const tuples = [...sql.matchAll(TUPLE_RE)];
    expect(tuples.length).toBe(30);
    const have = new Set(tuples.map((m) => `${m[2]}/${m[1]}`));
    for (const tier of SEEDED_TIERS) {
      for (const action of ACTIONS) {
        expect(have.has(`${tier}/${action}`)).toBe(true);
      }
    }
    expect([...have].some((k) => k.startsWith('SCALE/') || k.startsWith('PROFESSIONAL/'))).toBe(false);
  });

    it('exits 2 (HOLD / BLOCKED-APPROVAL): safeguards hold, SCALE unpriced', () => {
    const { code, out } = runGate(SCRIPT);
    expect(code).toBe(2);
    expect(out).toContain('HOLD (BLOCKED-APPROVAL)');
    // PROFESSIONAL is a deprecated alias normalised to PRO — it must NOT
    // appear as a BLOCKED line. Only SCALE (a live tier with no costs) blocks.
    expect(out).not.toContain('BLOCKED PROFESSIONAL');
    expect(out).toContain('BLOCKED SCALE');
    // Per-action table printed with honest MISSING markers, never invented rates.
    expect(out).toContain('SMS_SEND:');
    expect(out).toContain('SCALE=MISSING');
    // PROFESSIONAL=MISSING is expected in the table (the DB has no row for it),
    // but it is NOT a block — the app normalises PROFESSIONAL→PRO which IS priced.
    expect(out).toContain('PROFESSIONAL=MISSING');
    // Known tiers priced from their own rows (verbatim 080 values).
    expect(out).toContain('FREE=5');
    expect(out).toContain('ENTERPRISE=2');
    // HOLD message should reference 1 pricing item (SCALE only), not 2.
    expect(out).toContain('1 pricing item(s)');
    expect(out).not.toContain('2 pricing item');
  });

    it('reaches READY (exit 0) once SCALE rows exist — gate opens after approval', () => {
    const dir = join(tmpdir(), `pricing-gate-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    try {
      // Mirror the exact relative layout the gate reads from its app root.
      const dbDir = join(dir, 'db', 'migrations');
      const srcUtilsDir = join(dir, 'src', 'app', 'api', 'utils');
      const marketingDir = join(dir, 'src', 'app', '(marketing)', 'pricing');
      mkdirSync(dbDir, { recursive: true });
      mkdirSync(srcUtilsDir, { recursive: true });
      mkdirSync(marketingDir, { recursive: true });

      // 080 + synthetic post-approval SCALE rows (placeholder costs ONLY to exercise
      // the gate; never shipped, never asserted as correct prices). PROFESSIONAL
      // rows are intentionally omitted — the alias is normalised to PRO at
      // runtime, so adding PROFESSIONAL credit_costs rows would be a no-op.
      const seedSrc = readFileSync(SEED, 'utf8');
      const fixtureRows = [
        "  ('SMS_SEND', 'SCALE', 2),",
        "  ('EMAIL_SEND', 'SCALE', 1),",
        "  ('AI_REQUEST', 'SCALE', 3),",
        "  ('AI_NEGOTIATION', 'SCALE', 8),",
        "  ('CONTRACT_GENERATE', 'SCALE', 5),",
        "  ('LEAD_FIND', 'SCALE', 1)",
      ].join('\n');
      const pricedSeed =
        seedSrc.replace(
          'ON CONFLICT (action, tier) DO UPDATE SET cost = EXCLUDED.cost;',
          `ON CONFLICT (action, tier) DO NOTHING;\nINSERT INTO credit_costs (action, tier, cost) VALUES\n${fixtureRows}\nON CONFLICT (action, tier) DO NOTHING;`,
        ) + '\n';
      // Sanity: fixture really adds the 6 SCALE rows (30 -> 36) before running the gate.
      expect([...pricedSeed.matchAll(TUPLE_RE)].length).toBe(36);
      writeFileSync(join(dbDir, '080_credit_system.sql'), pricedSeed);

      // All other gate inputs: verbatim copies of the real sources.
      copyFileSync(
        join(APP_ROOT, 'src', 'app', 'api', 'utils', 'credits.ts'),
        join(srcUtilsDir, 'credits.ts'),
      );
      copyFileSync(
        join(APP_ROOT, 'src', 'app', 'api', 'utils', 'creditGuard.ts'),
        join(srcUtilsDir, 'creditGuard.ts'),
      );
      copyFileSync(
        join(APP_ROOT, 'src', 'app', '(marketing)', 'pricing', 'page.tsx'),
        join(marketingDir, 'page.tsx'),
      );
      copyFileSync(
        join(APP_ROOT, 'db', 'migrations', '067_value_based_pricing.sql'),
        join(dbDir, '067_value_based_pricing.sql'),
      );

      // Rewire the gate's appRoot to the fixture tree (string replace the one
      // derivation line; the rest of the script runs unmodified).
      const scriptSrc = readFileSync(SCRIPT, 'utf8');
      const anchor = "join(dirname(fileURLToPath(import.meta.url)), '..')";
      expect(scriptSrc).toContain(anchor);
      const gateSrc = scriptSrc.replace(anchor, JSON.stringify(dir)) + '\n';
      const gatePath = join(dir, 'scripts-gate.mjs');
      writeFileSync(gatePath, gateSrc);

      const { code, out } = runGate(gatePath);
      expect(out).toContain('READY');
      expect(code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
