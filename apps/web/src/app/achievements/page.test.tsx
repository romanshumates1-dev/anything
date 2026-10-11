// @vitest-environment jsdom
/**
 * Tests for `/achievements` — the achievements UI.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The page previously rendered FABRICATED numbers (synthetic delay, never
 * called the API). It now reads `GET /api/achievements`. These tests pin that
 * contract at the UI layer:
 *   * 404 renders as "turned off" (gamification OFF), not a generic failure.
 *   * Achievement names come from the SERVER response, not invented locally.
 *   * The empty state renders when there is nothing to show.
 *
 * API-level auth/org/gamification gating is proven in the route test; this
 * file proves the page honours the response it is given.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({ useSession: (...a: unknown[]) => useSession(...a) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import AchievementsPage from './page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AchievementsPage />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const OK = {
  achievements: [
    {
      id: 'a1',
      name: 'First Deal Closed',
      description: 'Close your first deal',
      category: 'Deals',
      rarity: 'common',
      points: 10,
      icon: 'trophy',
      unlocked: true,
    },
  ],
  summary: {
    totalPoints: 10,
    totalUnlocked: 1,
    totalAchievements: 1,
    progressPercent: 100,
    byCategory: { Deals: { earned: 10, total: 10 } },
  },
};

describe('Achievements page — server-authoritative + boundaries', () => {
  beforeEach(() => {
    useSession.mockReturnValue({ data: { userId: 'user-1' }, isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders "turned off" when the API returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Not found' }, 404)));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/turned off/i)).toBeTruthy();
    });
  });

  it('renders the achievement name returned by the server (not fabricated)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(OK)));
    renderPage();
    await waitFor(() => {
      // Appears in both the "Rarest Unlocked" summary and the achievement card.
      expect(screen.getAllByText('First Deal Closed').length).toBeGreaterThan(0);
    });
  });

  it('renders the empty state when there are no achievements', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          achievements: [],
          summary: { totalPoints: 0, totalUnlocked: 0, totalAchievements: 0, progressPercent: 0, byCategory: {} },
        }),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no achievements available yet/i)).toBeTruthy();
    });
  });
});

