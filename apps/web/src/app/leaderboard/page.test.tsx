// @vitest-environment jsdom
/**
 * Tests for `/leaderboard` — the leaderboard UI.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The page previously rendered FABRICATED people (mock/demo rows). It now reads
 * `GET /api/leaderboard` (organization-scoped) and shows an honest empty state
 * on a failed or empty response. These tests pin that at the UI layer:
 *   * Entry names come from the SERVER response, never invented.
 *   * An empty response renders "No leaderboard activity yet" — no placeholders.
 *   * An API error does not fabricate rows either.
 *
 * The Radix Select is mocked so the test targets page logic, not popover
 * positioning (mirrors how Shell.test.tsx mocks heavy chrome).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({ useSession: (...a: unknown[]) => useSession(...a) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => children,
  SelectTrigger: ({ children }: any) => children,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => children,
  SelectItem: ({ children }: any) => children,
}));

import LeaderboardPage from './page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardPage />
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
  leaderboard: [
    {
      id: 'u1',
      name: 'Alice Rivera',
      deals: 5,
      revenue: 500000,
      response_rate: 82,
      points: 640,
      trend: 'up',
      streak: 4,
      rank_change: 2,
      is_current_user: false,
    },
  ],
};

describe('Leaderboard page — server-authoritative + no fabrication', () => {
  beforeEach(() => {
    useSession.mockReturnValue({ data: { userId: 'user-1' }, isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders entry names returned by the server (not mock people)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(OK)));
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('Alice Rivera').length).toBeGreaterThan(0);
    });
  });

  it('renders the honest empty state when there are no entries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ leaderboard: [] })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/no leaderboard activity yet/i)).toBeTruthy();
    });
  });

  it('does not fabricate rows when the API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'boom' }, 500)));
    renderPage();
    // A failed load must surface the empty/error state, never placeholder people.
    await waitFor(() => {
      expect(screen.getByText(/no leaderboard activity yet/i)).toBeTruthy();
    });
    expect(screen.queryByText('Alice Rivera')).toBeNull();
  });
});

