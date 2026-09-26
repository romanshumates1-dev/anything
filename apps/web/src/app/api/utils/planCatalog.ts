/**
 * Plan-catalog resolution helpers — deterministic selection when a tier maps
 * to more than one subscription_plans row.
 *
 * WHY (production-hardening audit 2026-09-24):
 * Migration 066 intentionally RETAINED `plan_professional` as a "Pro (Legacy)"
 * alias (tier='pro', $79) alongside the canonical `plan_pro` (tier='pro',
 * $299 after 071). Lookups of the form `WHERE tier = 'pro' LIMIT 1` (no
 * ORDER BY) are then nondeterministic: Postgres may return either row, so the
 * billing page could quote $79 or $299 for the same plan and the webhook
 * activation path could grant the legacy row's limits. The rows diverged
 * after 066 (plan_professional kept 5,000 SMS; plan_pro now ships 500), so a
 * wrong pick is a real entitlement/charge mismatch.
 *
 * RULES (no rows are deleted; legacy subscribers keep working):
 *   1. An exact primary-key match always wins (`plan_professional` requested
 *      by id still resolves to itself — backward compatible).
 *   2. Otherwise the CANONICAL row wins: id === 'plan_' || tier (matches the
 *      naming convention every canonical migration uses: plan_free,
 *      plan_starter, plan_pro, plan_business, plan_scale).
 *   3. Otherwise the lowest id wins (stable, never input-order dependent).
 *
 * Pure functions — unit-tested in utils/__tests__/planCatalog.test.ts.
 */

export interface PlanKeyedRow {
  id: string;
  tier: string;
}

/** True when the row follows the canonical `plan_<tier>` naming convention. */
export function isCanonicalPlanRow(row: PlanKeyedRow): boolean {
  return row.id === `plan_${row.tier}`;
}

/**
 * Pick THE row for a plan key (primary key OR tier). Selection is fully
 * deterministic regardless of the order rows arrive in.
 * Returns null when nothing matches.
 */
export function selectPlanRow<T extends PlanKeyedRow>(rows: T[], key: string): T | null {
  const matches = rows.filter((row) => row.id === key || row.tier === key);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // 1. exact primary-key match
  const exact = matches.filter((row) => row.id === key);
  const pool = exact.length > 0 ? exact : matches;

  // 2. canonical row for the tier
  const canonical = pool.filter(isCanonicalPlanRow);
  const winnerPool = canonical.length > 0 ? canonical : pool;

  // 3. stable tiebreak
  return [...winnerPool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/**
 * Reduce a plan list to ONE row per tier (canonical preferred, stable
 * otherwise). Used by catalog endpoints so a "Pro (Legacy)" alias can never
 * be advertised next to — or overwrite — the canonical Pro.
 * Input order of the surviving rows is preserved.
 */
export function dedupePlansByTier<T extends PlanKeyedRow>(rows: T[]): T[] {
  const chosenByTier = new Map<string, T>();
  for (const row of rows) {
    const current = chosenByTier.get(row.tier);
    if (!current) {
      chosenByTier.set(row.tier, row);
      continue;
    }
    const candidate = selectPlanRow([current, row], row.tier);
    chosenByTier.set(row.tier, candidate as T);
  }
  return rows.filter((row) => chosenByTier.get(row.tier) === row);
}
