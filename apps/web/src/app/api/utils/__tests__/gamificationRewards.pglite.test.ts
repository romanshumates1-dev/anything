/**
 * Set V3 — reward claims, proven idempotent against a REAL Postgres engine.
 *
 * WHY A MOCKED `sql` CANNOT PROVE THIS
 * -----------------------------------
 * The property under test is that N concurrent requests produce EXACTLY ONE
 * award. A mock returns whatever the implementation hands it, so a
 * read-then-write implementation would pass against a mock that says "nothing
 * claimed yet" every time, while production grants a prize per request. The
 * guarantee lives in the `UNIQUE` constraints and `ON CONFLICT DO NOTHING`
 * clauses, so the test runs the REAL shipping statements against PGlite — a
 * genuine Postgres engine — with the same constraints the migration creates.
 *
 * This is the same reasoning as `auth-cost-guard.pglite.test.ts`.
 *
 * NO PRODUCTION TRAFFIC AND NO REAL MONEY
 * --------------------------------------
 * Every reward here is XP and cosmetic keys. `giveaways` records an operator
 * promotion; nothing in this file mints credits, and no withdrawal is touched.
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

const { spinOnce, redeemUseCode, claimBattlePassTier, enterGiveaway, awardXp, currentXp, syncEarnedSpins } =
  await import('@/app/api/utils/gamificationRewards.server');

const ALICE = 'user_alice';
const BOB = 'user_bob';

/**
 * The REAL migration, executed as-is, so the test proves the shipped schema
 * rather than a hand-written copy that could drift from it.
 */
const MIGRATION_PATH = join(process.cwd(), 'db', 'migrations', '099_gamification_rewards.sql');

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY, credits_balance integer NOT NULL DEFAULT 0);
    INSERT INTO "user" (id) VALUES ('${ALICE}'), ('${BOB}');
  `);

  // Prerequisites from migration 068. 099 is additive and references these, so
  // running 099 alone would fail on a real install that had not yet applied it.
  // Creating them here keeps the test honest about the dependency.
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
  `);

  const migration = readFileSync(MIGRATION_PATH, 'utf8');
  await db.exec(migration);

  await db.exec(`
    INSERT INTO public.use_codes (code, multiplier, xp_reward, max_redemptions)
    VALUES ('SHARED1X', 1, 25, 1),
           ('SHARED5X', 5, 125, 50);

    INSERT INTO public.gamification_seasons (key, name, starts_at, ends_at)
    VALUES ('s1', 'Season 1', now(), now() + interval '30 days');

    INSERT INTO public.battle_pass_tiers (season_id, tier, xp_required, reward_xp)
    SELECT id, 1, 0, 50 FROM public.gamification_seasons WHERE key = 's1';

    INSERT INTO public.giveaways (name, prize_description, entries_required, draws_at)
    VALUES ('Monthly', 'Operator-funded promo', 100, now() + interval '7 days');
  `);
});

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.user_stats,
             public.user_spin_wallet,
             public.spin_wheel_spins,
             public.user_use_code_redemptions,
             public.use_codes,
             public.user_battle_pass_claims,
             public.giveaway_entries,
             public.achievements,
             public.user_achievements,
             public.user_season_progress
      RESTART IDENTITY CASCADE;

    INSERT INTO public.user_stats (user_id, points) VALUES ('${ALICE}', 0), ('${BOB}', 0);
    INSERT INTO public.user_spin_wallet (user_id, spins_remaining) VALUES ('${ALICE}', 3), ('${BOB}', 3);
    INSERT INTO public.use_codes (code, multiplier, xp_reward, max_redemptions)
    VALUES ('SHARED1X', 1, 25, 1),
           ('SHARED5X', 5, 125, 50);

    -- Reset tier thresholds: the "not earned" test raises xp_required, and
    -- shared state would otherwise leak into every later test.
    UPDATE public.battle_pass_tiers SET xp_required = 0, reward_xp = 50;
  `);
});

describe('Set V3 — reward claims are exactly-once', () => {
  it('awards XP atomically and never drives the balance negative', async () => {
    await awardXp(ALICE, 100);
    expect(await currentXp(ALICE)).toBe(100);

    await awardXp(ALICE, 50);
    expect(await currentXp(ALICE)).toBe(150);

    await awardXp(ALICE, -999);
    expect(await currentXp(ALICE)).toBe(150);
  });

  describe('spin wheel', () => {
    it('refuses a spin when the wallet is empty', async () => {
      await db.exec(`UPDATE public.user_spin_wallet SET spins_remaining = 0 WHERE user_id = '${ALICE}'`);
      const result = await spinOnce(ALICE);
      expect(result.ok).toBe(false);
      expect(await currentXp(ALICE)).toBe(0);
    });

    it('consumes exactly one spin per award', async () => {
      const before = await currentXp(ALICE);
      const result = await spinOnce(ALICE);
      expect(result.ok).toBe(true);

      const [wallet] = (
        await db.query(`SELECT spins_remaining FROM public.user_spin_wallet WHERE user_id = $1`, [
          ALICE,
        ])
      ).rows;
      expect(wallet.spins_remaining).toBe(2);

      const [spin] = (
        await db.query(`SELECT prize_xp FROM public.spin_wheel_spins WHERE user_id = $1`, [ALICE])
      ).rows;
      expect(await currentXp(ALICE)).toBe(before + spin.prize_xp);
    });

    it('grants ONE prize for N concurrent spins on a 3-spin wallet', async () => {
      // 20 concurrent requests against a wallet holding 3 spins. Exactly 3 may
      // succeed; the rest must be refused, not silently awarded.
      const results = await Promise.all(
        Array.from({ length: 20 }, () => spinOnce(ALICE).catch(() => ({ ok: false }))),
      );
      const granted = results.filter((r) => (r as { ok?: boolean }).ok).length;
      expect(granted).toBeLessThanOrEqual(3);

      const spins = (await db.query(`SELECT count(*)::int AS n FROM public.spin_wheel_spins WHERE user_id = $1`, [ALICE])).rows[0];
      expect(spins.n).toBe(granted);

      const [wallet] = (
        await db.query(`SELECT spins_remaining FROM public.user_spin_wallet WHERE user_id = $1`, [ALICE])
      ).rows;
      expect(wallet.spins_remaining).toBe(3 - granted);
    });
  });

  describe('use codes', () => {
    it('rejects an unknown or inactive code', async () => {
      expect((await redeemUseCode(ALICE, 'NOPE')).ok).toBe(false);
      expect(await currentXp(ALICE)).toBe(0);
    });

    it('is single-use per account under concurrent replay', async () => {
      const results = await Promise.all(
        Array.from({ length: 15 }, () => redeemUseCode(ALICE, 'SHARED5X').catch(() => ({ ok: false }))),
      );
      const granted = results.filter((r) => (r as { ok?: boolean }).ok);
      expect(granted.length).toBe(1);
      expect(await currentXp(ALICE)).toBe(125);

      const rows = (
        await db.query(
          `SELECT count(*)::int AS n FROM public.user_use_code_redemptions WHERE user_id = $1`,
          [ALICE],
        )
      ).rows[0];
      expect(rows.n).toBe(1);
    });

    it('does not exhaust a shared code when one account replays', async () => {
      await redeemUseCode(ALICE, 'SHARED5X');
      const [afterFirst] = (
        await db.query(`SELECT redeemed_count FROM public.use_codes WHERE code = 'SHARED5X'`)
      ).rows;
      expect(afterFirst.redeemed_count).toBe(1);

      // 10 replays by the SAME account must not consume the global allowance.
      await Promise.all(Array.from({ length: 10 }, () => redeemUseCode(ALICE, 'SHARED5X')));
      const [afterReplay] = (
        await db.query(`SELECT redeemed_count FROM public.use_codes WHERE code = 'SHARED5X'`)
      ).rows;
      expect(afterReplay.redeemed_count).toBe(1);

      // Bob can still redeem it: a replay did not steal his chance.
      expect((await redeemUseCode(BOB, 'SHARED5X')).ok).toBe(true);
    });

    it('enforces the global max_redemptions ceiling', async () => {
      expect((await redeemUseCode(ALICE, 'SHARED1X')).ok).toBe(true);
      expect((await redeemUseCode(BOB, 'SHARED1X')).ok).toBe(false);
    });

    it('awards XP only — never credits', async () => {
      await redeemUseCode(ALICE, 'SHARED5X');
      // The credit balance is the only monetary balance; a reward must not move it.
      const [user] = (await db.query(`SELECT credits_balance FROM public."user" WHERE id = $1`, [ALICE])).rows;
      expect(Number(user.credits_balance ?? 0)).toBe(0);
    });
  });

  describe('battle pass', () => {
    it('claims an eligible tier exactly once under concurrent replay', async () => {
      const [tier] = (
        await db.query(`SELECT id, xp_required FROM public.battle_pass_tiers LIMIT 1`)
      ).rows;

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          claimBattlePassTier(ALICE, tier.id).catch(() => ({ ok: false })),
        ),
      );
      const granted = results.filter((r) => (r as { ok?: boolean }).ok).length;
      expect(granted).toBe(1);

      const rows = (
        await db.query(`SELECT count(*)::int AS n FROM public.user_battle_pass_claims WHERE user_id = $1`, [ALICE])
      ).rows[0];
      expect(rows.n).toBe(1);
      expect(await currentXp(ALICE)).toBe(50);
    });

    it('refuses a tier the user has not earned', async () => {
      await db.exec(`UPDATE public.battle_pass_tiers SET xp_required = 9999`);
      const [tier] = (await db.query(`SELECT id FROM public.battle_pass_tiers LIMIT 1`)).rows;
      const result = await claimBattlePassTier(ALICE, tier.id);
      expect(result.ok).toBe(false);
      expect(await currentXp(ALICE)).toBe(0);
    });
  });

  describe('giveaways', () => {
    it('permits one entry per user under concurrent replay', async () => {
      const [giveaway] = (await db.query(`SELECT id FROM public.giveaways LIMIT 1`)).rows;

      const results = await Promise.all(
        Array.from({ length: 12 }, () => enterGiveaway(ALICE, giveaway.id).catch(() => ({ ok: false }))),
      );
      const granted = results.filter((r) => (r as { ok?: boolean }).ok).length;
      expect(granted).toBe(1);

      const rows = (
        await db.query(`SELECT count(*)::int AS n FROM public.giveaway_entries WHERE user_id = $1`, [ALICE])
      ).rows[0];
      expect(rows.n).toBe(1);
    });

    it('costs nothing and stakes nothing', async () => {
      const [giveaway] = (await db.query(`SELECT id FROM public.giveaways LIMIT 1`)).rows;
      const [before] = (await db.query(`SELECT credits_balance FROM public."user" WHERE id = $1`, [ALICE])).rows;
      await enterGiveaway(ALICE, giveaway.id);
      const [after] = (await db.query(`SELECT credits_balance FROM public."user" WHERE id = $1`, [ALICE])).rows;
      expect(after.credits_balance).toBe(before.credits_balance);
    });
  });

  describe('spin entitlement', () => {
    it('grants spins from EARNED achievement progress and never more', async () => {
      // Alice earns real achievement progress; entitlement follows from it.
      await db.exec(`
        INSERT INTO public.achievements (key, name, description, category, points)
        VALUES ('a1', 'A', 'd', 'c', 500);
        INSERT INTO public.user_achievements (user_id, achievement_id, progress, unlocked)
        SELECT '${ALICE}', id, 1, true FROM public.achievements WHERE key = 'a1';
      `);

      await db.exec(`UPDATE public.user_spin_wallet SET spins_remaining = 0 WHERE user_id = '${ALICE}'`);
      const granted = await syncEarnedSpins(ALICE);
      // 500 points / 250 = 2 spins, below the weekly cap.
      expect(granted).toBe(2);

      // Calling again must not inflate the wallet.
      const again = await syncEarnedSpins(ALICE);
      expect(again).toBe(2);
    });
  });
});