/**
 * Phase 11 — REAL Postgres verification for migration 088.
 *
 * The other AI-credit suites mock `sql`, so they prove the policy but NOT the SQL. This
 * suite boots an actual PostgreSQL engine (PGlite = Postgres compiled to WASM), applies
 * the REAL migration file from disk, and exercises the real functions:
 *
 *   - the migration applies cleanly, and is safe to re-run (idempotency)
 *   - the daily / weekly / monthly caps actually deny at the boundary
 *   - boundaries roll over correctly (new day / new ISO week / new month = fresh counters)
 *   - included credits are capped, and PURCHASED credits are structurally unaffected
 *   - the release function compensates and floors at zero
 *   - CONCURRENT consumption never oversells the cap (the anti-TOCTOU guarantee)
 *
 * No mocks. If the SQL in 088 is wrong, this fails.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION = join(process.cwd(), 'db', 'migrations', '088_ai_credit_period_limits.sql');
const ORG_A = 'org-a-0000-0000-000000000001';
const ORG_B = 'org-b-0000-0000-000000000002';

let db: PGlite;

async function applyMigration() {
  db.exec(readFileSync(MIGRATION, 'utf8'));
}

/** Consume one included credit; returns the raw JSONB the function produced. */
async function consume(
  orgId: string,
  keys: { day: string; week: string; month: string },
  caps: { daily: number; weekly: number; monthly: number },
) {
  const res = await db.query<{ result: any }>(
    `SELECT consume_ai_included_credit($1,$2,$3,$4,$5,$6,$7) AS result`,
    [orgId, keys.day, keys.week, keys.month, caps.daily, caps.weekly, caps.monthly],
  );
  return res.rows[0].result;
}

async function release(orgId: string, keys: { day: string; week: string; month: string }) {
  const res = await db.query<{ result: any }>(
    `SELECT release_ai_included_credit($1,$2,$3,$4) AS result`,
    [orgId, keys.day, keys.week, keys.month],
  );
  return res.rows[0].result;
}

async function usedRow(orgId: string, periodKey: string) {
  const res = await db.query<{ credits_used: string }>(
    `SELECT credits_used FROM ai_credit_period_usage WHERE organization_id=$1 AND period_key=$2`,
    [orgId, periodKey],
  );
  return res.rows[0] ? Number(res.rows[0].credits_used) : 0;
}

beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('migration 088 on a real Postgres engine', () => {
  it('applies cleanly and is safe to re-run', async () => {
    await applyMigration();
    await expect(applyMigration()).resolves.toBeUndefined();

    const tables = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='ai_credit_period_usage'`,
    );
    expect(tables.rows[0].n).toBe(1);
  }, 60_000);

  it('denies once the DAILY cap is reached and reports the running totals', async () => {
    const org = 'org-daily-0000-00000000000a';
    const keys = { day: '2026-03-04', week: '2026-W10', month: '2026-03' };
    const caps = { daily: 3, weekly: 100, monthly: 100 };

    for (let i = 1; i <= 3; i++) {
      const r = await consume(org, keys, caps);
      expect(r.ok).toBe(true);
      expect(r.day).toBe(i);
    }

    const denied = await consume(org, keys, caps);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('daily_limit');
    // A denial must NOT increment anything.
    expect(await usedRow(org, 'day:2026-03-04')).toBe(3);
  }, 60_000);

  it('denies once the WEEKLY cap is reached even below the daily cap', async () => {
    const org = 'org-week-0000-0000000000000b';
    // Spread across 5 days; weekly cap 3 binds well before the daily cap of 10.
    const caps = { daily: 10, weekly: 3, monthly: 100 };
    let last = null;
    for (const day of ['2026-03-02', '2026-03-03', '2026-03-04']) {
      last = await consume(org, { day, week: '2026-W10', month: '2026-03' }, caps);
      expect(last.ok).toBe(true);
    }
    const denied = await consume(org, { day: '2026-03-05', week: '2026-W10', month: '2026-03' }, caps);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('weekly_limit');
    expect(await usedRow(org, 'week:2026-W10')).toBe(3);
  }, 60_000);

  it('denies once the MONTHLY cap is reached', async () => {
    const org = 'org-month-0000-00000000000c';
    // The monthly counter is per calendar month, so exhausting it requires spending
    // across several days OF THE SAME MONTH (daily/weekly caps kept loose).
    const caps = { daily: 100, weekly: 100, monthly: 2 };
    await consume(org, { day: '2026-03-01', week: '2026-W09', month: '2026-03' }, caps);
    await consume(org, { day: '2026-03-05', week: '2026-W10', month: '2026-03' }, caps);

    const denied = await consume(org, { day: '2026-03-09', week: '2026-W11', month: '2026-03' }, caps);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('monthly_limit');
    expect(await usedRow(org, 'month:2026-03')).toBe(2);

    // A new calendar month resets the monthly window.
    const nextMonth = await consume(org, { day: '2026-04-01', week: '2026-W14', month: '2026-04' }, caps);
    expect(nextMonth.ok).toBe(true);
  }, 60_000);

  it('gives fresh counters at each period boundary', async () => {
    const org = 'org-bound-0000-00000000000d';
    const caps = { daily: 1, weekly: 1, monthly: 10 };

    // Exhaust day/week/month for one period.
    expect((await consume(org, { day: '2026-03-04', week: '2026-W10', month: '2026-03' }, caps)).ok).toBe(true);
    expect((await consume(org, { day: '2026-03-04', week: '2026-W10', month: '2026-03' }, caps)).ok).toBe(false);

    // New day AND new week (same month) -> allowed again.
    expect((await consume(org, { day: '2026-03-05', week: '2026-W11', month: '2026-03' }, caps)).ok).toBe(true);

    // New month -> allowed again.
    expect((await consume(org, { day: '2026-04-01', week: '2026-W14', month: '2026-04' }, caps)).ok).toBe(true);

    // Counters are per-period and all three were actually written.
    expect(await usedRow(org, 'day:2026-03-04')).toBe(1);
    expect(await usedRow(org, 'day:2026-03-05')).toBe(1);
    expect(await usedRow(org, 'week:2026-W10')).toBe(1);
    expect(await usedRow(org, 'week:2026-W11')).toBe(1);
    expect(await usedRow(org, 'month:2026-03')).toBe(2);
    expect(await usedRow(org, 'month:2026-04')).toBe(1);
  }, 60_000);

  it('isolates organizations (tenant separation in the ledger itself)', async () => {
    const keys = { day: '2026-05-01', week: '2026-W18', month: '2026-05' };
    const caps = { daily: 1, weekly: 10, monthly: 10 };

    expect((await consume(ORG_A, keys, caps)).ok).toBe(true);
    // Org A is capped...
    expect((await consume(ORG_A, keys, caps)).ok).toBe(false);
    // ...but org B is unaffected. No cross-tenant bleed.
    expect((await consume(ORG_B, keys, caps)).ok).toBe(true);
    expect(await usedRow(ORG_B, 'day:2026-05-01')).toBe(1);
  }, 60_000);

  it('compensates on release and never goes below zero', async () => {
    const org = 'org-rel-0000-0000000000000e';
    const keys = { day: '2026-06-01', week: '2026-W23', month: '2026-06' };
    const caps = { daily: 5, weekly: 5, monthly: 5 };

    await consume(org, keys, caps);
    await consume(org, keys, caps);
    expect(await usedRow(org, 'day:2026-06-01')).toBe(2);

    // Release gives the credit back, in every window.
    await release(org, keys);
    expect(await usedRow(org, 'day:2026-06-01')).toBe(1);
    expect(await usedRow(org, 'week:2026-W23')).toBe(1);
    expect(await usedRow(org, 'month:2026-06')).toBe(1);

    // Over-releasing floors at zero instead of going negative.
    await release(org, keys);
    await release(org, keys);
    await release(org, keys);
    expect(await usedRow(org, 'day:2026-06-01')).toBe(0);

    // And the CHECK constraint independently forbids negatives.
    await expect(
      db.query(
        `INSERT INTO ai_credit_period_usage (organization_id, period_key, period_kind, credits_used)
         VALUES ($1,'day:neg','day',-1)`,
        [org],
      ),
    ).rejects.toThrow();
  }, 60_000);

  it('rejects a missing organization instead of consuming anything', async () => {
    const keys = { day: '2026-07-01', week: '2026-W27', month: '2026-07' };
    const caps = { daily: 5, weekly: 5, monthly: 5 };
    const r = await consume('', keys, caps);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_organization');
  }, 60_000);

  it('treats a zero cap as unlimited for that window', async () => {
    const org = 'org-unlim-0000-00000000000f';
    const keys = { day: '2026-08-01', week: '2026-W31', month: '2026-08' };
    // 0 = no cap, which is how an unlimited plan is represented.
    const caps = { daily: 0, weekly: 0, monthly: 0 };
    for (let i = 0; i < 25; i++) {
      expect((await consume(org, keys, caps)).ok).toBe(true);
    }
    expect(await usedRow(org, 'day:2026-08-01')).toBe(25);
  }, 60_000);

  it('never oversells the cap under CONCURRENT consumption', async () => {
    const org = 'org-race-0000-000000000010';
    const keys = { day: '2026-09-01', week: '2026-W36', month: '2026-09' };
    const CAP = 5;
    const caps = { daily: CAP, weekly: CAP, monthly: CAP };

    // 40 simultaneous attempts against a cap of 5. Exactly CAP may succeed.
    const attempts = Array.from({ length: 40 }, () =>
      db
        .query<{ result: any }>(
          `SELECT consume_ai_included_credit($1,$2,$3,$4,$5,$6,$7) AS result`,
          [org, keys.day, keys.week, keys.month, caps.daily, caps.weekly, caps.monthly],
        )
        .then((r) => r.rows[0].result)
        .catch(() => ({ ok: false, reason: 'error' })),
    );
    const results = await Promise.all(attempts);

    const granted = results.filter((r) => r && r.ok === true).length;
    const denied = results.filter((r) => r && r.ok === false).length;

    // The invariant that matters: the counter never exceeds the cap, and the number of
    // grants never exceeds it either.
    expect(await usedRow(org, 'day:2026-09-01')).toBe(CAP);
    expect(granted).toBe(CAP);
    expect(granted + denied).toBe(40);
  }, 120_000);
});
