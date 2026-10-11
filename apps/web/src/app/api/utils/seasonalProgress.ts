/**
 * REQUIREMENT SET V - seasonal progression and competitions: the pure rules.
 *
 * Source of truth: `.github/agents/roman.agent.md` lines 1272-1284. Migration
 * 099 created the schema (`gamification_seasons`, `user_season_progress`,
 * `battle_pass_tiers`, `competitions`) but nothing read or wrote it, so a
 * season was a row that could never be shown to anyone. This module and
 * `seasonalProgress.server.ts` are that missing half.
 *
 * CLIENT-SAFE BY CONSTRUCTION
 * ---------------------------
 * Imports NOTHING, for the same reason as `gamification.ts`: the `/season` page
 * is a client component and needs the window/phase rules to decide what to
 * render, and a `sql` import here would pull the Neon driver into the browser
 * bundle. The database half lives in `seasonalProgress.server.ts`.
 *
 * WHAT "SEASONAL" ACTUALLY MEANS HERE
 * -----------------------------------
 * A season is a time window with its own XP track. Season XP is a SEPARATE
 * balance from lifetime `user_stats.points`, and it resets per season by
 * construction: `user_season_progress` is keyed on (user, season), so a new
 * season row starts at zero. Nothing needs to "reset" anything, which is the
 * usual source of off-by-one-season bugs.
 *
 * HONESTY RULES THIS FILE ENFORCES
 * --------------------------------
 *   * No function here invents a number. `standingsWithRanks` assigns ranks to
 *     rows it is GIVEN; it never queries, estimates or interpolates. A user with
 *     no season progress appears in no standings list at all rather than being
 *     shown a fabricated zero.
 *   * `normalizeCompetitionMetric` falls back to `xp` for anything unrecognised.
 *     The `metric` column is free text written by an operator, so a typo must
 *     not be able to name a metric this app has no data for.
 *   * No monetary value appears anywhere in this file. Season rewards are XP and
 *     cosmetic codes, matching migration 099's safety posture.
 */

/** Where a window sits relative to "now". */
export type Phase = 'upcoming' | 'active' | 'ended';

/** A season as the UI needs it. Dates are ISO strings from Postgres. */
export interface SeasonWindow {
  key: string;
  name: string;
  description: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

/** A competition as the UI needs it. */
export interface CompetitionWindow {
  key: string;
  name: string;
  description: string;
  metric: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

/** One rung of the battle-pass track. Mirrors `battle_pass_tiers`. */
export interface TierDefinition {
  id: number;
  tier: number;
  xpRequired: number;
  label: string;
  rewardXp: number;
  rewardCode: string;
}

/** A standings row before ranking. */
export interface StandingRow {
  userId: string;
  name: string;
  xp: number;
}

/** A standings row after ranking. */
export interface RankedStanding extends StandingRow {
  rank: number;
}

/** The metrics this app can actually rank by. Anything else is not a metric. */
const KNOWN_METRICS = ['xp'] as const;

/**
 * Coerce a stored `competitions.metric` string to something this app can rank.
 *
 * Defaults to `xp` rather than throwing or returning the raw value, because the
 * column is operator-written free text: a typo like "XP " or "exp" must degrade
 * to the only metric that exists, not surface as a header over a number the app
 * never computed.
 */
export function normalizeCompetitionMetric(value: unknown): string {
  if (typeof value !== 'string') return 'xp';
  const normalized = value.trim().toLowerCase();
  return (KNOWN_METRICS as readonly string[]).includes(normalized) ? normalized : 'xp';
}
/**
 * Phase of a season at `now`.
 *
 * `is_active = false` forces `ended`. That is deliberate: an operator who
 * switches a season off mid-flight is saying "this window is over", and the
 * alternative -- honouring the dates -- would keep a disabled season on screen.
 *
 * The boundaries are half-open: `[starts_at, ends_at)`. The end instant is
 * OUTSIDE the window, so two back-to-back seasons never both claim the exact
 * handover second, and a countdown that reaches zero reads "Ended" rather than
 * "0s".
 */
export function seasonPhase(season: SeasonWindow, now: Date): Phase {
  if (!season.isActive) return 'ended';
  return windowPhase(season.startsAt, season.endsAt, now);
}

/** Phase of a competition window. Same half-open rule as `seasonPhase`. */
export function competitionPhase(competition: CompetitionWindow, now: Date): Phase {
  if (!competition.isActive) return 'ended';
  return windowPhase(competition.startsAt, competition.endsAt, now);
}

function windowPhase(startsAt: string, endsAt: string, now: Date): Phase {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const at = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'ended';
  if (at < start) return 'upcoming';
  if (at >= end) return 'ended';
  return 'active';
}

/**
 * The single season covering `now`, or null.
 *
 * When windows overlap the LATEST-starting one wins, because a season that
 * begins later is the one an operator most recently published, and showing the
 * older one would hide live content.
 *
 * Returns null rather than the most recent past season when nothing is live.
 * A page that rendered "last season" as if it were current would invite users
 * to earn XP that can no longer count.
 */
export function activeSeason<T extends SeasonWindow>(seasons: T[], now: Date): T | null {
  let best: T | null = null;
  for (const candidate of seasons) {
    if (seasonPhase(candidate, now) !== 'active') continue;
    if (!best || new Date(candidate.startsAt).getTime() > new Date(best.startsAt).getTime()) {
      best = candidate;
    }
  }
  return best;
}

/** The active competitions for a season, soonest-closing first. */
export function activeCompetitions<T extends CompetitionWindow>(
  competitions: T[],
  now: Date,
): T[] {
  return competitions
    .filter((competition) => competitionPhase(competition, now) === 'active')
    .sort((a, b) => new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime());
}

/**
 * Milliseconds left in a window, clamped at zero.
 *
 * Clamped in both directions: an upcoming window has no time "remaining" to a
 * user (they cannot spend it yet), and a finished one must never return a
 * negative that would render as "-3d".
 */
export function msRemaining(season: SeasonWindow, now: Date): number {
  const start = new Date(season.startsAt).getTime();
  const end = new Date(season.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (now.getTime() < start) return 0;
  return Math.max(0, end - now.getTime());
}

/**
 * Render a countdown for humans: "2d 4h", "4h 12m", "12m 30s", "Ended".
 *
 * Two segments only. A full `DD:HH:MM:SS` readout is not more precise in any
 * way that matters to a user and is considerably harder to scan.
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Ended';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds % 60}s`;
}

export interface TierProgressResult {
  current: TierDefinition | null;
  next: TierDefinition | null;
  ratio: number;
  complete: boolean;
}

export function tierProgress(
  track: TierDefinition[],
  xp: number,
): TierProgressResult {
  const safeXp = Number.isFinite(xp) ? Math.max(0, Number(xp)) : 0;
  const ordered = [...track].sort((a, b) => a.xpRequired - b.xpRequired);
  if (ordered.length === 0) {
    return { current: null, next: null, ratio: 0, complete: false };
  }

  const current = ordered.filter((tier) => safeXp >= tier.xpRequired).at(-1) ?? null;
  const lastTier = ordered[ordered.length - 1];
  const next = safeXp <= ordered[0].xpRequired
    ? ordered[0]
    : safeXp >= lastTier.xpRequired
      ? null
      : ordered.find((tier) => safeXp < tier.xpRequired) ?? ordered[0] ?? null;

  if (!next) {
    return { current, next: null, ratio: 1, complete: true };
  }

  const start = current?.xpRequired ?? ordered[0].xpRequired;
  const end = next.xpRequired;
  const gap = end - start;
  const progress = Math.max(0, safeXp - start);
  return {
    current,
    next,
    ratio: gap > 0 ? progress / gap : 0,
    complete: false,
  };
}

export function standingsWithRanks(rows: StandingRow[]): RankedStanding[] {
  const normalized = rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    xp: Number.isFinite(row.xp) ? Number(row.xp) : 0,
  }));

  const sorted = [...normalized].sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0));
  const ranked: RankedStanding[] = [];
  let previousRank = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];

    let rank = index + 1;
    if (previous && previous.xp === current.xp) {
      rank = previousRank;
    }

    previousRank = rank;
    ranked.push({
      userId: current.userId,
      name: current.name,
      xp: current.xp,
      rank,
    });
  }

  return ranked;
}

