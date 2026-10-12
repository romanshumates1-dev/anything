// @vitest-environment jsdom
/**
 * Tests for the seasonal progression panel (`SeasonStandings`).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The route test proves the API boundary; this file proves the PANEL is honest
 * and server-authoritative:
 *   * loading, error (incl. 404 "turned off"), empty, and populated states.
 *   * every displayed number (XP, rank, countdown, standings) comes from the
 *     server payload — nothing is recomputed or fabricated.
 *   * standings render display names, never raw user ids.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SeasonStandings } from './SeasonStandings';

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SeasonStandings />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const POPULATED = {
  season: {
    id: 7,
    key: 's1',
    name: 'Harvest Season',
    description: 'Earn XP this month.',
    status: 'active',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
    remainingSeconds: 90061, // 1d 1h 1m 1s
  },
  seasons: [],
  progress: { seasonId: 7, xp: 120, rank: 3 },
  battlePass: {
    seasonId: 7, xp: 120, currentTier: 2, nextTier: 3, xpToNextTier: 80,
    reachedTiers: [1, 2], claimedTiers: [1], ratio: 0.4, complete: false,
  },
  standings: [
    { rank: 1, name: 'Ada Lovelace', xp: 500 },
    { rank: 2, name: 'Grace Hopper', xp: 300 },
  ],
  competitions: [
    { id: 1, key: 'weekly', name: 'Weekly XP', description: '', metric: 'xp', status: 'active', remainingSeconds: 3600 },
  ],
};

describe('SeasonStandings panel — states + server authority', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(POPULATED)));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a loading state while the season query is in flight', async () => {
    // Never-resolving fetch keeps the query pending so the loader is observable.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderPanel();
    expect(screen.getByTestId('seasons-loading')).toBeTruthy();
  });

  it('renders "turned off" on a 404 (gamification OFF), not a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Not found' }, 404)));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('seasons-error')).toBeTruthy();
    });
    expect(screen.getByText(/turned off/i)).toBeTruthy();
  });

  it('renders an explicit empty state when no season is live (no fabricated data)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ season: null, seasons: [], progress: null, battlePass: null, standings: [], competitions: [] })));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('seasons-empty')).toBeTruthy();
    });
    expect(screen.getByText(/No season is running/i)).toBeTruthy();
  });

  it('renders season name, server-computed XP, rank, and countdown', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId('seasons-populated')).toBeTruthy();
    });
    expect(screen.getByText('Harvest Season')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy(); // season XP from server
    expect(screen.getByText('3')).toBeTruthy(); // rank from server
    // 90061s → 1d 1h, from the shared pure countdown rule.
    expect(screen.getByText(/1d 1h/)).toBeTruthy();
  });

  it('renders standings as display names (never raw user ids)', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    });
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.queryByText(/user_/)).toBeNull();
  });

  it('renders live competitions with their metric', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Weekly XP')).toBeTruthy();
    });
    expect(screen.getByText(/Ranked by XP/)).toBeTruthy();
  });

  it('renders a battle-pass progress bar with the server ratio when a track exists', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole('progressbar')).toBeTruthy();
    });
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('40'); // ratio 0.4 → 40%
    expect(screen.getByText(/80 XP to Tier 3/)).toBeTruthy();
  });

  it('shows an empty standings message when no one in the org has XP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...POPULATED, standings: [] })));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/No one in your organization/i)).toBeTruthy();
    });
  });
});
