'use client';

/**
 * Seasonal progression panel — the UI half of the `/api/seasons` route.
 *
 * HONESTY RULES (roman.agent.md), same as `app/rewards`:
 *  1. Every number here comes from the server. Nothing is recomputed, guessed,
 *     or fabricated. A season that is not running renders an explicit empty
 *     state, not an invented one.
 *  2. Gamification OFF surfaces as a 404 from the gate. That is rendered as
 *     "turned off" rather than a generic failure, so the panel does not claim a
 *     broken backend when the feature is simply disabled.
 *  3. Rewards are XP and cosmetic only. No cash value, no odds, no payout.
 *
 * The data is read-only by design: season XP is credited by server events only,
 * so this panel has no mutation. Battle-pass claims stay on `/api/rewards`.
 */
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Trophy, Users, Loader2, Timer } from 'lucide-react';
// Pure, client-safe module: the same countdown rules the server uses, so the
// label shown here cannot drift from the window the API enforces.
import { formatCountdown } from '@/app/api/utils/seasonalProgress';

interface Season {
  id: number;
  key: string;
  name: string;
  description: string;
  status: 'upcoming' | 'active' | 'ended';
  startsAt: string;
  endsAt: string;
  remainingSeconds: number;
}

interface SeasonProgress {
  seasonId: number;
  xp: number;
  rank: number | null;
}

interface BattlePass {
  seasonId: number;
  xp: number;
  currentTier: number;
  nextTier: number | null;
  xpToNextTier: number | null;
  reachedTiers: number[];
  claimedTiers: number[];
  ratio: number;
  complete: boolean;
}

interface OrgStanding {
  rank: number;
  name: string;
  xp: number;
}

interface Competition {
  id: number;
  key: string;
  name: string;
  description: string;
  metric: string;
  status: 'upcoming' | 'active' | 'ended';
  remainingSeconds: number;
}

interface SeasonsData {
  season: Season | null;
  seasons: Season[];
  progress: SeasonProgress | null;
  battlePass: BattlePass | null;
  standings: OrgStanding[];
  competitions: Competition[];
}

/**
 * Read an error response's JSON body without swallowing a parse failure.
 * A non-JSON body (a proxy 502) is logged and reported as the fallback rather
 * than silently rendered as an empty panel.
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error || fallback;
  } catch (cause) {
    console.error(`[seasons] non-JSON error body (HTTP ${res.status})`, cause);
    return fallback;
  }
}

export function SeasonStandings() {
  const { data, isLoading, error } = useQuery<SeasonsData>({
    queryKey: ['seasons'],
    queryFn: async () => {
      const res = await fetch('/api/seasons');
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'Seasons are turned off for your account.'
            : await errorMessage(res, 'Could not load the season.'),
        );
      }
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div data-testid="seasons-loading">
        <GlassCard className="mb-6">
          <div className="flex items-center justify-center py-8">
            <Loader2
              className="h-6 w-6 animate-spin text-[var(--accent-blue)]"
              aria-label="Loading season"
            />
          </div>
        </GlassCard>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="seasons-error">
        <GlassCard className="mb-6">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {error instanceof Error ? error.message : 'Could not load the season.'}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            You can turn seasons back on in Settings → Preferences.
          </p>
        </GlassCard>
      </div>
    );
  }

  // No live season: an explicit empty state, never a fabricated one.
  if (!data?.season) {
    return (
      <div data-testid="seasons-empty">
        <GlassCard className="mb-6">
          <div className="mb-1 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-[var(--accent-blue)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Season</h2>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            No season is running right now. Check back when the next one opens.
          </p>
        </GlassCard>
      </div>
    );
  }

  const season = data.season;
  const progress = data.progress;
  const battlePass = data.battlePass;
  const standings = data.standings ?? [];
  const competitions = data.competitions ?? [];

  return (
    <div data-testid="seasons-populated">
      <GlassCard className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-[var(--accent-blue)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{season.name}</h2>
        </div>
        {season.description && (
          <p className="mb-4 text-sm text-[var(--text-muted)]">{season.description}</p>
        )}

        {/* Season clock + the caller's own standing. Both server-computed. */}
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-center">
            <p className="mb-1 flex items-center justify-center gap-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <Timer className="h-3 w-3" /> Ends in
            </p>
            <p className="font-mono text-lg font-semibold text-[var(--text-primary)]">
              {formatCountdown(season.remainingSeconds * 1000)}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-center">
            <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
              Your season XP
            </p>
            <p className="font-mono text-lg font-semibold text-[var(--text-primary)]">
              {progress?.xp ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] p-3 text-center">
            <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">Your rank</p>
            <p className="font-mono text-lg font-semibold text-[var(--text-primary)]">
              {progress?.rank ?? '—'}
            </p>
          </div>
        </div>

        {/* Battle-pass progress, when this season has a tier track. */}
        {battlePass && (
          <div className="mb-4 rounded-lg border border-[var(--border-subtle)] p-3">
            <p className="mb-2 text-sm font-medium text-[var(--text-primary)]">
              Battle pass — Tier {battlePass.currentTier}
              {battlePass.complete
                ? ' (complete)'
                : battlePass.nextTier !== null && battlePass.xpToNextTier !== null
                  ? ` · ${battlePass.xpToNextTier} XP to Tier ${battlePass.nextTier}`
                  : ''}
            </p>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-secondary)]"
              role="progressbar"
              aria-valuenow={Math.round(battlePass.ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Battle pass progress"
            >
              <div
                className="h-2 rounded-full bg-[var(--accent-blue)] transition-all"
                style={{ width: `${Math.min(100, Math.round(battlePass.ratio * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* Org-scoped standings. Display names only — never raw user ids. */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-[var(--accent-blue)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Standings</h3>
          </div>
          {standings.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No one in your organization has earned season XP yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {standings.map((entry) => (
                <li
                  key={`${entry.rank}-${entry.name}`}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-6 font-mono text-[var(--text-muted)]">#{entry.rank}</span>
                    <span className="text-[var(--text-primary)]">{entry.name}</span>
                  </span>
                  <span className="font-mono text-[var(--text-secondary)]">{entry.xp} XP</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Live competitions. */}
        {competitions.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Competitions</h3>
            <ul className="space-y-2">
              {competitions.map((competition) => (
                <li
                  key={competition.id}
                  className="rounded-lg border border-[var(--border-subtle)] p-3"
                >
                  <p className="font-medium text-[var(--text-primary)]">{competition.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Ranked by {competition.metric.toUpperCase()} · ends in{' '}
                    {formatCountdown(competition.remainingSeconds * 1000)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
