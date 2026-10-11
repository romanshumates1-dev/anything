// @vitest-environment jsdom
/**
 * Tests for `/rewards` — the rewards UI (spin, codes, battle pass, giveaways).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The route test proves the API boundaries; this file proves the PAGE is
 * server-authoritative and honest:
 *   * 404 renders as "turned off" (gamification OFF), not a generic failure.
 *   * XP / level / spins come from the server, never fabricated.
 *   * A mutation (redeem) POSTs to the API and then REFETCHES — the page never
 *     optimistically claims a reward the backend may have refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({ useSession: (...a: unknown[]) => useSession(...a) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import RewardsPage from './page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RewardsPage />
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
  xp: 500,
  level: 3,
  achievementPoints: 4,
  spinsRemaining: 2,
  battlePass: [],
  giveaways: [],
};

describe('Rewards page — server-authoritative + boundaries', () => {
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

  it('renders XP and spins returned by the server (not fabricated)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(OK)));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('500')).toBeTruthy();
    });
    // Spins available reflects spinsRemaining from the API.
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('redeem POSTs to the API and refetches rather than inventing the reward', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse({ ok: true, xpAwarded: 50 }, 200);
      }
      return jsonResponse(OK, 200);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('500')).toBeTruthy();
    });

    const getsBefore = fetchMock.mock.calls.filter((c) => !c[1]?.method).length;

    fireEvent.change(screen.getByLabelText('Reward code'), { target: { value: 'TESTCODE' } });
    fireEvent.click(screen.getByText('Redeem'));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(postCall![0]).toBe('/api/rewards');
      const body = JSON.parse(String(postCall![1]?.body));
      expect(body).toMatchObject({ action: 'redeem', code: 'TESTCODE' });
    });

    // Server-authoritative: a successful mutation invalidates and refetches.
    await waitFor(() => {
      const getsAfter = fetchMock.mock.calls.filter((c) => !c[1]?.method).length;
      expect(getsAfter).toBeGreaterThan(getsBefore);
    });
  });
});
