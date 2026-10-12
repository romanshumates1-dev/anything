import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import { requireGamificationEnabled } from '@/app/api/utils/gamification.server';
import {
  activeSeason,
  listSeasons,
  getSeasonProgress,
  battlePassForUser,
  activeCompetitions,
  seasonStandingsForOrg,
} from '@/app/api/utils/seasonalProgress.server';

/**
 * GET /api/seasons — read-only view of seasonal progression for the caller.
 *
 * Returns the live season, the caller's season XP/rank, org-scoped standings
 * (display names only), battle-pass progress, and live competitions. Every value
 * is computed server-side by `seasonalProgress.server.ts`; the client never
 * supplies XP.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * No POST. `creditSeasonXp` takes a caller-supplied XP amount, so exposing it
 * over HTTP would mint XP from a request body. Season XP is credited only by
 * server-authoritative events (crates, spins, use codes, battle-pass claims).
 * Battle-pass reward claims already live on `/api/rewards` (`claim-tier`); a
 * second claim path here would fork the idempotency guard.
 *
 * TENANT ISOLATION (2026-09-26): standings are scoped to the caller's
 * organization via `seasonStandingsForOrg`. The platform-wide `seasonStandings`
 * returns raw user ids and would leak every tenant's activity, so it is never
 * called from a route.
 *
 * Gamification OFF returns the gate's 404 (not 403), so the route does not even
 * confirm the feature exists — matching `/api/leaderboard` and `/api/rewards`.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const disabled = await requireGamificationEnabled(session.userId);
  if (disabled) return disabled;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 100);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    const season = await activeSeason();
    const seasons = await listSeasons();
    const competitions = await activeCompetitions();

    // No live season: return the empty season shape (plus any past seasons and
    // any competitions that reference no season) rather than an error. The UI
    // renders an empty-state from this, and it matches the pure module's
    // "return null, never a stale season" contract.
    if (!season) {
      return NextResponse.json({
        season: null,
        seasons,
        progress: null,
        battlePass: null,
        standings: [],
        competitions,
      });
    }

    const [progress, battlePass, standings] = await Promise.all([
      getSeasonProgress(session.userId, season.id),
      battlePassForUser(session.userId, season.id),
      seasonStandingsForOrg(season.id, organization.id, { limit, offset }),
    ]);

    return NextResponse.json({
      season,
      seasons,
      progress,
      battlePass,
      standings,
      competitions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Could not load seasonal progress',
        detail: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
