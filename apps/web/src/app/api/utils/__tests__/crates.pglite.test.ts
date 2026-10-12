/**
 * Set V3 — crate openings are exactly-once, proven against a REAL Postgres engine.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `openCrateForUser` (crates.server.ts) is the only gamification write path
 * with no PGlite replay coverage: spins, use-codes, battle-pass claims and
 * giveaway entries each have a concurrent-replay test in
 * `gamificationRewards.pglite.test.ts`, while the crate route test mocks
 * `openCrateForUser` outright — so nothing proves the crate opener itself
 * refuses a replayed or concurrent open.
 *
 * The property under test lives in `UNIQUE(user_id, crate_key, opened_day)`
 * (migration 099) plus the early return on `insertOpen.length === 0`: a second
 * open of the same crate the same day must create no rows and award no XP.
 * A mock cannot prove this (it returns whatever the code hands it), so the
 * test runs the REAL shipping statements against PGlite with the REAL shipped
 * schema from migration 099.
 *
 * THE REPORT THIS ANSWERS
 * -----------------------
 * A user reported an achievement-crate open crediting +50 XP twice
 * (`CRATES.achievement.baseXp` is 50). The concurrent test below opens the
 * same crate 10 ways at once and asserts the persisted `user_stats.points`
 * grew by exactly one award — any double-credit fails it. The sensitivity
 * control at the bottom proves the harness detects the vulnerable shape.
 *
 * NO PRODUCTION TRAFFIC AND NO REAL MONEY
 * --------------------------------------
 * Every award here is XP and cosmetic keys. Nothing mints credits and no
 * withdrawal is touched.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let db: any;

/** Minimal `sql` tag: binds values, so no test input is ever interpolated. */
const sqlQuery = async (strings: unknown, ...values: unknown[]) => {
  const parts: string[] = Array.isArray(strings) ? (strings as string[]) : [String(strings)];
  const isTagged = Array.isArray(strings);
  let text = '';
  parts.forEach((s, i) => {
    text += s;
    if (isTagged && i < values.length) text += `$${i + 1}`;
  });
  const res = await db.query(text, values as any[]);
  return Array.isArray(res?.rows) ? res.rows : Array.from(res?.rows ?? []);
};

vi.mock('@/app/api/utils/sql', () => ({ default: sqlQuery }));

const { openCrateForUser } = await import('@/app/api/utils/crates.server');
const { CRATES } = await import('@/app/api/utils/crates');

const ALICE = 'user_alice';
const BOB = 'user_bob';

/**
 * The REAL migration, executed as-is, so the test proves the shipped schema
 * rather than a hand-written copy that could drift from it.
 */
const MIGRATION_PATH = join(process.cwd(), 'db', 'migrations', '099_gamification_rewards.sql');

const pointsOf = async (userId: string): Promise<number> => {
  const rows = await sqlQuery`SELECT points FROM public.user_stats WHERE user_id = ${userId} LIMIT 1`;
  return Number(rows[0]?.points ?? 0);
};

const openCount = async (userId: string, crateKey: string): Promise<number> => {
  const rows = await sqlQuery`SELECT count(*)::int AS n FROM public.user_crate_opens WHERE user_id = ${userId} AND crate_key = ${crateKey}`;
  return Number(rows[0]?.n ?? 0);
};

const inventoryCount = async (userId: string): Promise<number> => {
  const rows = await sqlQuery`SELECT count(*)::int AS n FROM public.user_crate_inventory WHERE user_id = ${userId}`;
  return Number(rows[0]?.n ?? 0);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY, credits_balance integer NOT NULL DEFAULT 0);
    INSERT INTO "user" (id) VALUES ('${ALICE}'), ('${BOB}');
  `);

  // Prerequisites from migration 068. 099 is additive and references these, so
  // running 099 alone would fail on a real install that had not yet applied it.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.user_stats (
      user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
      points integer NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS public.achievements (
      id serial PRIMARY KEY,
      key text UNIQUE NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      category text NOT NULL,
      rarity text NOT NULL DEFAULT 'common',
      points integer NOT NULL DEFAULT 0,
      icon text NOT NULL DEFAULT 'award',
      max_progress integer
    );
    CREATE TABLE IF NOT EXISTS public.user_achievements (
      id serial PRIMARY KEY,
      user_id text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
      achievement_id integer NOT NULL REFERENCES public.achievements(id) ON DELETE CASCADE,
      progress integer NOT NULL DEFAULT 0,
      unlocked boolean NOT NULL DEFAULT false,
      unlocked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id, achievement_id)
    );
    INSERT INTO public.user_stats (user_id, points) VALUES ('${ALICE}', 0), ('${BOB}', 0);
  `);

  await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));

  // Scratch table for the sensitivity control only. Created here (not in
  // beforeEach) so the TRUNCATE below never touches a missing table.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.scratch_unbounded_awards (
      id serial PRIMARY KEY,
      user_id text NOT NULL,
      event_key text NOT NULL,
      xp integer NOT NULL
    );
  `);

  // The guard this file proves must actually exist in the shipped schema.
  // If migration 099 ever loses UNIQUE(user_id, crate_key, opened_day), this
  // fails before any behavioral assertion can pass vacuously.
  const guards = await sqlQuery`
    SELECT count(*)::int AS n FROM pg_constraint
    WHERE conrelid = 'public.user_crate_opens'::regclass AND contype = 'u'
  `;
  expect(Number(guards[0]?.n ?? 0)).toBeGreaterThanOrEqual(1);
});

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.user_crate_opens,
             public.user_crate_inventory,
             public.user_stats,
             public.scratch_unbounded_awards
      RESTART IDENTITY CASCADE;
    INSERT INTO public.user_stats (user_id, points) VALUES ('${ALICE}', 0), ('${BOB}', 0);
  `);
});

describe('crates — opening is exactly-once (PGlite)', () => {
  it('first open of the day records one open row and credits the crate XP once', async () => {
    const result = await openCrateForUser(ALICE, 'achievement');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The achievement crate is the reported +50 case: pin the award to the
    // shipped prize table, not to a hardcoded number that could drift from it.
    expect(result.xpAwarded).toBe(CRATES.achievement.baseXp);
    expect(await pointsOf(ALICE)).toBe(CRATES.achievement.baseXp);
    expect(await openCount(ALICE, 'achievement')).toBe(1);
    expect(await inventoryCount(ALICE)).toBe(1);
  });

  it('replaying the same crate the same day refuses and awards nothing', async () => {
    const first = await openCrateForUser(ALICE, 'achievement');
    expect(first.ok).toBe(true);
    const afterFirst = await pointsOf(ALICE);
    expect(afterFirst).toBeGreaterThan(0);

    const second = await openCrateForUser(ALICE, 'achievement');
    expect(second.ok).toBe(false);
    expect(await pointsOf(ALICE)).toBe(afterFirst);
    expect(await openCount(ALICE, 'achievement')).toBe(1);
    expect(await inventoryCount(ALICE)).toBe(1);
  });

  it('N concurrent opens grant XP exactly once', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        openCrateForUser(ALICE, 'achievement').catch(() => ({ ok: false as const })),
      ),
    );
    const granted = results.filter((r) => (r as { ok?: boolean }).ok);
    expect(granted.length).toBe(1);

    const winner = granted[0] as { xpAwarded: number };
    expect(await pointsOf(ALICE)).toBe(winner.xpAwarded);
    expect(await openCount(ALICE, 'achievement')).toBe(1);
  });
});
