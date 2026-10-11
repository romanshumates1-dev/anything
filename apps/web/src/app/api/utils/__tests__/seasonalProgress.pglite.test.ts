/**
 * REQUIREMENT SET V - the database half of seasonal progression, proven against
 * a REAL Postgres engine.
 *
 * WHY NOT A MOCK
 * ---------------
 * The gap this closes is that migration 099's `user_season_progress.xp` column
 * was never written. A mocked `sql` would happily "prove" a write that no real
 * table accepts. The properties that matter here - the UNIQUE(user_id,
 * season_id) idempotency, the `xp >= 0` CHECK, the ON DELETE CASCADE from a
 * season, and the `(season_id, xp DESC)` index actually being used for
 * standings - only exist if the statements run against real Postgres. Same
 * reasoning as `gamificationRewards.pglite.test.ts`.
 *
 * Every assertion is XP and cosmetics. No credits, no balances, no payouts.
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

const seasonal = await import('@/app/api/utils/seasonalProgress.server');

const ALICE = 'user_alice';
const BOB = 'user_bob';
const CAROL = 'user_carol';

const MIGRATION_PATH = join(process.cwd(), 'db', 'migrations', '099_gamification_rewards.sql');
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE "user" (id text PRIMARY KEY, credits_balance integer NOT NULL DEFAULT 0);
    INSERT INTO "user" (id) VALUES ('${ALICE}'), ('${BOB}'), ('${CAROL}');
  `);

  // Migration 068 prerequisite that 099 references.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS public.user_stats (
      user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
      points integer NOT NULL DEFAULT 0
    );
  `);

  // The REAL migrations, executed as-is, so the test proves the shipped schema
  // rather than a hand-written copy that could drift from it. 099 creates the
  // season tables; 100 adds the idempotency ledger the credit path depends on.
  await db.exec(readFileSync(MIGRATION_PATH, 'utf8'));
  await db.exec(
    readFileSync(join(process.cwd(), 'db', 'migrations', '100_season_xp_events.sql'), 'utf8'),
  );

  await db.exec(`
    INSERT INTO public.gamification_seasons (key, name, starts_at, ends_at)
    VALUES ('s1', 'Season 1', now() - interval '1 day', now() + interval '29 days'),
           ('past', 'Season 0', now() - interval '60 days', now() - interval '30 days'),
           ('next', 'Season 2', now() + interval '30 days', now() + interval '60 days');

    INSERT INTO public.battle_pass_tiers (season_id, tier, xp_required, reward_xp, label)
    SELECT id, t.tier, t.xp, t.reward, 'Tier ' || t.tier
    FROM public.gamification_seasons,
         (VALUES (1, 0, 50), (2, 100, 100), (3, 250, 200)) AS t(tier, xp, reward)
    WHERE key = 's1';

    INSERT INTO public.competitions (key, name, metric, starts_at, ends_at)
    VALUES ('weekly', 'Weekly XP', 'xp', now() - interval '1 day', now() + interval '6 days'),
           ('closed', 'Last Week', 'xp', now() - interval '14 days', now() - interval '7 days');
  `);
});

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.user_season_xp_events,
             public.user_season_progress,
             public.user_stats
      RESTART IDENTITY CASCADE;

    -- Re-seeded each test so the season XP mirror into user_stats starts from a
    -- known balance rather than whatever the previous test left behind.
    INSERT INTO public.user_stats (user_id, points)
    VALUES ('${ALICE}', 0), ('${BOB}', 0), ('${CAROL}', 0);
  `);
});


describe('season window and selection', () => {
  it('selects the live season and reports remaining time', async () => {
    const season = await seasonal.activeSeason();
    expect(season).not.toBeNull();
    expect(season!.key).toBe('s1');
    // 'next' starts in the future and 'past' already ended, so neither is live.
    const keys = (await seasonal.listSeasons()).map((s: any) => s.key);
    expect(keys).toContain('past');
    expect(keys).toContain('next');

    // The window rules are the pure module's job; the server just carries its
    // answer. Asserting through the server proves the two are wired together.
    expect(season.status).toBe('active');
    expect(season.remainingSeconds).toBeGreaterThan(0);

    // The half-open rule: an ended season reports 'ended' with nothing left,
    // even though its row still says is_active.
    const ended = (await seasonal.listSeasons()).find((s: any) => s.key === 'past');
    expect(ended!.status).toBe('ended');
    expect(ended!.remainingSeconds).toBe(0);

    // A season that has not started yet reports 'upcoming'.
    const upcoming = (await seasonal.listSeasons()).find((s: any) => s.key === 'next');
    expect(upcoming!.status).toBe('upcoming');
  });

  it('credits season XP exactly once per (user, season, reason)', async () => {
    const season = await seasonal.activeSeason();

    expect(await seasonal.creditSeasonXp(ALICE, season.id, 40, 'signup_bonus')).toBe(true);
    // A duplicate call with the same reason must not add XP again.
    expect(await seasonal.creditSeasonXp(ALICE, season.id, 40, 'signup_bonus')).toBe(false);
    // A different reason is a distinct event and does add.
    expect(await seasonal.creditSeasonXp(ALICE, season.id, 10, 'first_listing')).toBe(true);

    const row = await seasonal.getSeasonProgress(ALICE, season.id);
    expect(row.xp).toBe(50);
  });

  it('refuses non-positive and non-finite XP rather than writing a bad row', async () => {
    const season = await seasonal.activeSeason();
    expect(await seasonal.creditSeasonXp(ALICE, season.id, 0, 'zero')).toBe(false);
    expect(await seasonal.creditSeasonXp(ALICE, season.id, -5, 'negative')).toBe(false);
    expect(await seasonal.creditSeasonXp(ALICE, season.id, Number.NaN, 'nan')).toBe(false);

    const row = await seasonal.getSeasonProgress(ALICE, season.id);
    // No row at all, not a fabricated zero row.
    expect(row).toBeNull();
  });

  it('credits XP to a user who has no row yet, creating one', async () => {
    const season = await seasonal.activeSeason();
    expect(await seasonal.getSeasonProgress(BOB, season.id)).toBeNull();
    expect(await seasonal.creditSeasonXp(BOB, season.id, 7, 'welcome')).toBe(true);
    const row = await seasonal.getSeasonProgress(BOB, season.id);
    expect(row).not.toBeNull();
    expect(row.xp).toBe(7);
  });

  it('mirrors credited season XP into user_stats.points', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 30, 'quest_1');
    await seasonal.creditSeasonXp(ALICE, season.id, 20, 'quest_2');

    const rows = await sqlQuery`SELECT points FROM public.user_stats WHERE user_id = ${ALICE}`;
    expect(Number(rows[0].points)).toBe(50);
  });

  it('returns empty standings for a season with no participants', async () => {
    const season = await seasonal.activeSeason();
    const standings = await seasonal.seasonStandings(season.id);
    expect(standings).toEqual([]);
  });
});

describe('standings and ranking', () => {
  it('ranks users by XP and skips ranks consumed by a tie', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 300, 'a1');
    await seasonal.creditSeasonXp(BOB, season.id, 300, 'b1');
    await seasonal.creditSeasonXp(CAROL, season.id, 100, 'c1');

    const standings = await seasonal.seasonStandings(season.id);
    // Competition ranking: two users tied at rank 1, next is rank 3.
    expect(standings.map((s: any) => s.userId)).toEqual([ALICE, BOB, CAROL]);
    expect(standings[0].rank).toBe(1);
    expect(standings[1].rank).toBe(1);
    expect(standings[2].rank).toBe(3);
  });

  it('omits users with no progress instead of inventing a zero for them', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 5, 'only');
    const standings = await seasonal.seasonStandings(season.id);
    expect(standings.map((s: any) => s.userId)).toEqual([ALICE]);
  });

  it('paginates standings without repeating or dropping a user', async () => {
    const season = await seasonal.activeSeason();
    const users = [ALICE, BOB, CAROL];
    for (const [i, u] of users.entries()) {
      await seasonal.creditSeasonXp(u, season.id, 100 - i * 10, `seed-${i}`);
    }

    const page1 = await seasonal.seasonStandings(season.id, { limit: 2, offset: 0 });
    const page2 = await seasonal.seasonStandings(season.id, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    expect([...page1, ...page2].map((s: any) => s.userId).sort()).toEqual([...users].sort());
  });

  it('rejects a non-positive limit rather than silently returning everything', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 10, 'seed');
    const bad = await seasonal.seasonStandings(season.id, { limit: 0, offset: 0 });
    expect(bad).toEqual([]);
  });

  it('writes the computed rank back to user_season_progress', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 200, 'a1');
    await seasonal.creditSeasonXp(BOB, season.id, 50, 'b1');

    await seasonal.recomputeSeasonRanks(season.id);

    const rows = await sqlQuery`
      SELECT user_id, rank FROM public.user_season_progress
      WHERE season_id = ${season.id} ORDER BY rank ASC
    `;
    expect(rows.map((r: any) => r.user_id)).toEqual([ALICE, BOB]);
    expect(Number(rows[0].rank)).toBe(1);
    expect(Number(rows[1].rank)).toBe(2);
  });
});

describe('battle pass tiers', () => {
  it('reports the highest tier reached and the XP needed for the next one', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 120, 'a1');

    const pass = await seasonal.battlePassForUser(ALICE, season.id);
    // Tier 1 needs 0, tier 2 needs 100 -> 120 XP reaches tier 2.
    expect(pass.currentTier).toBe(2);
    expect(pass.nextTier).toBe(3);
    expect(pass.xpToNextTier).toBe(130);
    expect(pass.reachedTiers).toEqual([1, 2]);
    expect(pass.claimedTiers).toEqual([]);
  });

  it('returns null tier data for a season with no tier track', async () => {
    const pass = await seasonal.battlePassForUser(ALICE, 999_999);
    expect(pass).toBeNull();
  });

  it('claims a reached tier exactly once', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 150, 'a1');

    expect(await seasonal.claimBattlePassTier(ALICE, season.id, 1)).toBe(true);
    // Second claim of the same tier must not repeat the reward.
    expect(await seasonal.claimBattlePassTier(ALICE, season.id, 1)).toBe(false);

    const pass = await seasonal.battlePassForUser(ALICE, season.id);
    expect(pass.claimedTiers).toEqual([1]);
  });

  it('refuses to claim a tier the user has not reached', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 10, 'a1');
    // Tier 3 needs 250 XP.
    expect(await seasonal.claimBattlePassTier(ALICE, season.id, 3)).toBe(false);
  });

  it('grants reward_xp for a claimed tier into user_stats.points', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 150, 'a1');
    await seasonal.claimBattlePassTier(ALICE, season.id, 2); // reward_xp 100

    const rows = await sqlQuery`SELECT points FROM public.user_stats WHERE user_id = ${ALICE}`;
    expect(Number(rows[0].points)).toBe(250);
  });
});

describe('competitions', () => {
  it('returns only live competitions, closed ones excluded', async () => {
    const live = await seasonal.activeCompetitions();
    expect(live.map((c: any) => c.key)).toEqual(['weekly']);
    expect(live[0].status).toBe('active');
    expect(live[0].remainingSeconds).toBeGreaterThan(0);
  });

  it('coerces an operator typo in `metric` to the only metric that exists', async () => {
    await sqlQuery`
      INSERT INTO public.competitions (key, name, metric, starts_at, ends_at)
      VALUES ('typo', 'Misspelled', 'exp', now() - interval '1 day', now() + interval '5 days')
    `;

    const live = await seasonal.activeCompetitions();
    const typo = live.find((c: any) => c.key === 'typo');
    // 'exp' must not surface as a header over XP numbers never computed.
    expect(typo.metric).toBe('xp');
  });

  it('returns empty rather than a closed competition when nothing is live', async () => {
    // Both seeded rows are ended or future-dated, so nothing here is live.
    await sqlQuery`UPDATE public.competitions SET is_active = false`;
    const live = await seasonal.activeCompetitions();
    expect(live).toEqual([]);
  });
});

describe('season teardown', () => {
  it('drops a season participants progress with it, by CASCADE', async () => {
    const season = await seasonal.activeSeason();
    await seasonal.creditSeasonXp(ALICE, season.id, 60, 'a1');

    await sqlQuery`DELETE FROM public.gamification_seasons WHERE key = 's1'`;

    const rows = await sqlQuery`
      SELECT count(*)::int AS n FROM public.user_season_progress WHERE season_id = ${season.id}
    `;
    expect(rows[0].n).toBe(0);
  });
});
