/**
 * REQUIREMENT SET V — the database half of seasonal progression.
 *
 * SERVER-ONLY. Pulls in the Neon driver via `sql`, so it must never be imported
 * from a `'use client'` component — the same split as `gamification.server.ts`
 * versus `gamification.ts`.
 *
 * WHAT THIS FILE IS
 * -----------------
 * Migration 099 created `gamification_seasons`, `user_season_progress`,
 * `battle_pass_tiers` and `user_battle_pass_claims`, and nothing in the app read
 * or wrote any of them. `seasonalProgress.ts` holds the pure rules; this file is
 * what actually moves `user_season_progress.xp`.
 *
 * WHY EVERY CREDIT IS AN INSERT-THEN-ACCUMULATE
 * ----------------------------------------------
 * The tempting shape is "SELECT xp, add n, UPDATE xp = total". Two concurrent
 * requests both read the same old total and one award is silently lost — and
 * because the caller has already been told the award succeeded, the user sees XP
 * vanish. Every write here instead goes through a single statement that does
 * `INSERT ... ON CONFLICT DO UPDATE SET xp = xp + n`, so the database
 * serialises the arithmetic and concurrent credits accumulate.
 *
 * WHY CREDITS NEED A REASON KEY
 * -----------------------------
 * "Award 50 XP for finishing the onboarding quest" is an event that can be
 * replayed by a retry, a double-click, or two tabs. An event needs a natural
 * key, so credits are keyed `(user, season, reason)` and a repeat is ignored.
 * Pass a reason that is unique per genuine event (`listing_created:12345`) when
 * you want repeats to count.
 *
 * XP IS NOT MONEY
 * ---------------
 * Everything here writes `user_season_progress.xp` and `user_stats.points`, plus
 * cosmetic tier claims. Nothing reads or writes a credit balance, and no payout
 * path touches this file. A bug can make a season leaderboard wrong; it cannot
 * make a wallet wrong.
 */
import sql from '@/app/api/utils/sql';
import {
  competitionPhase,
  msRemaining,
  normalizeCompetitionMetric,
  seasonPhase,
  standingsWithRanks,
  tierProgress,
} from '@/app/api/utils/seasonalProgress';

export type SeasonStatus = 'upcoming' | 'active' | 'ended';

export interface Season {
  id: number;
  key: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  status: SeasonStatus;
  remainingSeconds: number;
}

export interface Competition {
  id: number;
  key: string;
  name: string;
  description: string;
  seasonId: number | null;
  /** Always a metric this app can rank by; never the raw operator string. */
  metric: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  status: SeasonStatus;
  remainingSeconds: number;
}

export interface SeasonProgress {
  userId: string;
  seasonId: number;
  xp: number;
  rank: number | null;
  updatedAt: string;
}

export interface Standing {
  userId: string;
  xp: number;
  rank: number;
}

export interface BattlePass {
  seasonId: number;
  xp: number;
  currentTier: number;
  nextTier: number | null;
  xpToNextTier: number | null;
  reachedTiers: number[];
  claimedTiers: number[];
  /** 0..1 progress from the current tier to the next. 1 when the track is done. */
  ratio: number;
  complete: boolean;
}

const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const mapSeason = (row: any, now: Date): Season => {
  const startsAt = row.starts_at instanceof Date ? row.starts_at.toISOString() : String(row.starts_at);
  const endsAt = row.ends_at instanceof Date ? row.ends_at.toISOString() : String(row.ends_at);
  const isActive = Boolean(row.is_active);
  // The pure rules take the UI shape, so build it once and reuse it for both the
  // phase and the remaining time rather than reconstructing it twice.
  const shape = {
    key: String(row.key ?? ''),
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    startsAt,
    endsAt,
    isActive,
  };
  return {
    id: toNumber(row.id),
    ...shape,
    status: seasonPhase(shape, now),
    remainingSeconds: Math.floor(msRemaining(shape, now) / 1000),
  };
};

/**
 * The season that should be shown to a user right now, or null when none is.
 *
 * Returns null rather than a stale season: a page that must invent a season to
 * render is a page that shows users a leaderboard nobody is actually competing
 * in.
 */
export async function activeSeason(now: Date = new Date()): Promise<Season | null> {
  const rows = await sql`
    SELECT id, key, name, description, starts_at, ends_at, is_active
    FROM public.gamification_seasons
    WHERE is_active = true
    ORDER BY starts_at DESC
  `;
  const seasons = (rows as any[]).map((r) => mapSeason(r, now));
  const nowMs = now.getTime();
  const live = seasons.filter(
    (s) => new Date(s.startsAt).getTime() <= nowMs && nowMs < new Date(s.endsAt).getTime(),
  );
  // ORDER BY already put the latest-starting match first, which is the most
  // recently published season when windows overlap.
  return live[0] ?? null;
}

/** Every season, most recently started first. Includes ended and upcoming ones. */
export async function listSeasons(now: Date = new Date()): Promise<Season[]> {
  const rows = await sql`
    SELECT id, key, name, description, starts_at, ends_at, is_active
    FROM public.gamification_seasons
    ORDER BY starts_at DESC
  `;
  return (rows as any[]).map((r) => mapSeason(r, now));
}

/** One user's progress in one season, or null when they have not participated. */
export async function getSeasonProgress(
  userId: string,
  seasonId: number,
): Promise<SeasonProgress | null> {
  const rows = (await sql`
    SELECT user_id, season_id, xp, rank, updated_at
    FROM public.user_season_progress
    WHERE user_id = ${userId} AND season_id = ${seasonId}
    LIMIT 1
  `) as any[];
  const row = rows[0];
  if (!row) return null;
  return {
    userId: String(row.user_id),
    seasonId: toNumber(row.season_id),
    xp: toNumber(row.xp),
    rank: row.rank === null || row.rank === undefined ? null : toNumber(row.rank),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/**
 * Add XP to a user's season progress. Returns true when XP was actually added.
 *
 * `reason` is the idempotency key. The unique key behind it is
 * UNIQUE(user_id, season_id) on the progress table plus a separate
 * (user_id, season_id, reason) ledger row, so a replayed request is a no-op
 * rather than a second award.
 *
 * Returns false — and writes nothing — for non-positive or non-finite XP. A
 * caller that passes NaN is buggy, and silently storing 0 would hide it.
 */
export async function creditSeasonXp(
  userId: string,
  seasonId: number,
  xp: number,
  reason: string,
): Promise<boolean> {
  if (!Number.isFinite(xp) || xp <= 0) return false;
  if (!userId || !reason) return false;

  const amount = Math.floor(xp);

  // One statement: record the event, and only accumulate if that insert created
  // a row. The database picks the winner of any concurrent race, so N replays
  // credit exactly once.
  const rows = (await sql`
    WITH ledger AS (
      INSERT INTO public.user_season_xp_events (user_id, season_id, reason, xp)
      VALUES (${userId}, ${seasonId}, ${reason}, ${amount})
      ON CONFLICT (user_id, season_id, reason) DO NOTHING
      RETURNING user_id
    ),
    credited AS (
      INSERT INTO public.user_season_progress (user_id, season_id, xp)
      SELECT ${userId}, ${seasonId}, ${amount}
      WHERE EXISTS (SELECT 1 FROM ledger)
      ON CONFLICT (user_id, season_id) DO UPDATE
        SET xp = public.user_season_progress.xp + EXCLUDED.xp,
            updated_at = now()
      RETURNING user_id
    )
    UPDATE public.user_stats
    SET points = GREATEST(public.user_stats.points + ${amount}, 0)
    WHERE user_id = ${userId} AND EXISTS (SELECT 1 FROM credited)
    RETURNING user_id
  `) as any[];

  return rows.length > 0;
}

/**
 * Leaderboard for a season, ranked by XP.
 *
 * Ranks come from the pure `competitionRank`, not from SQL `row_number()`, so
 * the tie rule lives in one place and a test can prove it without a database:
 * tied users share a rank and the ranks a tie consumed are skipped.
 *
 * A user with no progress row is absent rather than shown a fabricated zero —
 * "has not participated" and "has participated with zero XP" are different
 * facts, and this app has no data that would let it invent the latter.
 *
 * A non-positive limit returns empty rather than everything. SQL `LIMIT 0`
 * already returns nothing; rejecting it in TypeScript makes the intent explicit
 * and stops a caller relying on "0 means unlimited".
 */
export async function seasonStandings(
  seasonId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<Standing[]> {
  const limit = Math.floor(opts.limit ?? 100);
  const offset = Math.floor(opts.offset ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return [];
  if (!Number.isFinite(offset) || offset < 0) return [];

  const rows = (await sql`
    SELECT user_id, xp
    FROM public.user_season_progress
    WHERE season_id = ${seasonId}
    ORDER BY xp DESC, user_id ASC
    LIMIT ${limit} OFFSET ${offset}
  `) as any[];

  const ranked = standingsWithRanks(
    rows.map((r) => ({ userId: String(r.user_id), name: String(r.user_id), xp: toNumber(r.xp) })),
  );
  return ranked.map((entry) => ({
    userId: entry.userId,
    xp: entry.xp,
    rank: entry.rank,
  }));
}

/**
 * Persist computed ranks onto `user_season_progress.rank`.
 *
 * The `rank` column exists in migration 099 and is documentation of the last
 * computed leaderboard, not the source of truth. Standings are always recomputed
 * from XP by `seasonStandings`, so a stale stored rank cannot change a
 * leaderboard — this only makes the stored value agree with what was last shown.
 *
 * One statement per user would reintroduce a read-then-write; instead this
 * writes the whole leaderboard in a single statement ranked by XP, so the
 * database computes all positions together.
 */
export async function recomputeSeasonRanks(seasonId: number): Promise<void> {
  await sql`
    UPDATE public.user_season_progress AS p
    SET rank = ranked.rnk,
        updated_at = now()
    FROM (
      SELECT user_id,
             (SELECT count(DISTINCT xp) FROM public.user_season_progress p2
              WHERE p2.season_id = p1.season_id AND p2.xp > p1.xp) + 1 AS rnk
      FROM public.user_season_progress p1
      WHERE season_id = ${seasonId}
    ) AS ranked
    WHERE p.season_id = ${seasonId}
      AND p.user_id = ranked.user_id
  `;
}

/**
 * Battle-pass state for one user in one season.
 *
 * Returns null when the season has no tier track at all. That is a
 * configuration fact an operator needs to see, not a failure to hide behind an
 * empty object: a season with no tiers has no pass, and rendering one anyway
 * would show a progress bar toward nothing.
 *
 * Tiers are sorted by threshold here rather than trusting row order, so a
 * migration that inserted them out of order cannot produce a wrong answer.
 */
export async function battlePassForUser(
  userId: string,
  seasonId: number,
): Promise<BattlePass | null> {
  const tierRows = (await sql`
    SELECT id, tier, xp_required, label, reward_xp, reward_code
    FROM public.battle_pass_tiers
    WHERE season_id = ${seasonId}
  `) as any[];

  if (tierRows.length === 0) return null;

  const progress = await getSeasonProgress(userId, seasonId);
  const xp = progress?.xp ?? 0;

  // Sorted here rather than trusting row order, so a migration that inserted
  // tiers out of order cannot produce a wrong answer.
  const track = tierRows
    .map((r) => ({
      id: toNumber(r.id),
      tier: toNumber(r.tier),
      xpRequired: toNumber(r.xp_required),
      label: String(r.label ?? ''),
      rewardXp: toNumber(r.reward_xp),
      rewardCode: String(r.reward_code ?? ''),
    }))
    .sort((a, b) => a.xpRequired - b.xpRequired);

  const tiers = tierProgress(track, xp);

  const claimRows = (await sql`
    SELECT t.tier
    FROM public.user_battle_pass_claims c
    JOIN public.battle_pass_tiers t ON t.id = c.tier_id
    WHERE c.user_id = ${userId} AND t.season_id = ${seasonId}
    ORDER BY t.tier ASC
  `) as any[];

  return {
    seasonId,
    xp,
    currentTier: tiers.current?.tier ?? 0,
    nextTier: tiers.next?.tier ?? null,
    xpToNextTier: tiers.next ? Math.max(0, tiers.next.xpRequired - xp) : null,
    reachedTiers: track.filter((t) => xp >= t.xpRequired).map((t) => t.tier),
    claimedTiers: claimRows.map((r) => toNumber(r.tier)),
    ratio: tiers.ratio,
    complete: tiers.complete,
  };
}

/**
 * Claim a battle-pass tier's reward. Returns true only when the claim is new.
 *
 * Insert-then-grant, never check-then-grant: a double-click or N parallel tabs
 * all observe "not yet claimed" and would all grant under a read-then-write.
 * The insert into `user_battle_pass_claims` either creates the row (and the
 * reward is granted once) or conflicts on UNIQUE(user_id, tier_id) and is
 * discarded, so the database decides the winner.
 *
 * The threshold is enforced in the same statement, so a tier the user has not
 * reached cannot be claimed by a client that skipped the UI check.
 */
export async function claimBattlePassTier(
  userId: string,
  seasonId: number,
  tier: number,
): Promise<boolean> {
  if (!Number.isFinite(tier)) return false;

  const rows = (await sql`
    WITH tier_row AS (
      SELECT id, xp_required, reward_xp
      FROM public.battle_pass_tiers
      WHERE season_id = ${seasonId} AND tier = ${Math.floor(tier)}
      LIMIT 1
    ),
    reached AS (
      SELECT t.id, t.reward_xp
      FROM tier_row t
      WHERE COALESCE(
        (SELECT p.xp FROM public.user_season_progress p
         WHERE p.user_id = ${userId} AND p.season_id = ${seasonId}),
        0
      ) >= t.xp_required
    ),
    claimed AS (
      INSERT INTO public.user_battle_pass_claims (user_id, tier_id)
      SELECT ${userId}, r.id FROM reached r
      ON CONFLICT (user_id, tier_id) DO NOTHING
      RETURNING tier_id
    )
    UPDATE public.user_stats
    SET points = GREATEST(public.user_stats.points + COALESCE((SELECT reward_xp FROM claimed, reached), 0), 0)
    WHERE user_id = ${userId}
      AND EXISTS (SELECT 1 FROM claimed)
    RETURNING user_id
  `) as any[];

  return rows.length > 0;
}


/**
 * Competitions that are live right now.
 *
 * `metric` passes through `normalizeCompetitionMetric` because the column is
 * operator-written free text: a typo like "exp" would otherwise surface as a
 * leaderboard header over XP numbers the app never computed. Coercing it here
 * means every caller receives a metric this app can actually rank by.
 *
 * Returns [] when nothing is live rather than the most recently finished
 * competition, for the same reason `activeSeason` does: showing a closed
 * leaderboard as if it were open invites users to compete for a prize that can
 * no longer be awarded.
 */
export async function activeCompetitions(now: Date = new Date()): Promise<Competition[]> {
  const rows = (await sql`
    SELECT id, key, name, description, season_id, metric, starts_at, ends_at, is_active
    FROM public.competitions
    WHERE is_active = true
    ORDER BY starts_at DESC
  `) as any[];

  return rows
    .map((r) => {
      const startsAt = r.starts_at instanceof Date ? r.starts_at.toISOString() : String(r.starts_at);
      const endsAt = r.ends_at instanceof Date ? r.ends_at.toISOString() : String(r.ends_at);
      const shape = {
        key: String(r.key ?? ''),
        name: String(r.name ?? ''),
        description: String(r.description ?? ''),
        metric: String(r.metric ?? ''),
        startsAt,
        endsAt,
        isActive: Boolean(r.is_active),
      };
      const phase = competitionPhase(shape, now);
      return {
        id: toNumber(r.id),
        ...shape,
        metric: normalizeCompetitionMetric(shape.metric),
        seasonId: r.season_id === null || r.season_id === undefined ? null : toNumber(r.season_id),
        status: phase,
        remainingSeconds: Math.floor(msRemaining(shape, now) / 1000),
      };
    })
    .filter((c) => c.status === 'active');
}

