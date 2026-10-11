// @vitest-environment jsdom
/**
 * Tests for `/crates` — the crate shop UI.
 *
 * WHAT THIS FILE GUARDS (mirrors the route.test.ts + rewards page invariants)
 * ---------------------------------------------------------------------------
 *   * 404 from the API renders as "turned off", NOT a generic failure — the
 *     page must not disclose that the feature exists when it is off.
 *   * Available crates, inventory, equipped items and XP come straight from the
 *     server; the page never invents a prize.
 *   * No rendered text may ever carry a monetary value (credit/cash/balance).
 *
 * The database-backed boundaries (401 / idempotence) are proven separately in
 * `api/crates/route.test.ts`; this file proves the UI honours the contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock('@/lib/auth-client', () => ({ useSession: (...a: unknown[]) => useSession(...a) }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

import CratesPage from './page';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CratesPage />
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CRATES_OK = {
  availableCrates: [{ key: 'daily', name: 'Daily Cache', canOpen: true, opensToday: 0 }],
  inventory: [],
  equipped: [],
  xp: 120,
};

describe('GET /crates UI — boundaries', () => {
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

  it('renders available crates and XP from the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(CRATES_OK)));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Daily Cache')).toBeTruthy();
    });
    expect(screen.getByText('120')).toBeTruthy();
  });

  it('never renders a monetary field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(CRATES_OK)));
    const { container } = renderPage();
    await waitFor(() => {
      expect(screen.getByText('Daily Cache')).toBeTruthy();
    });
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toMatch(/\bcredit\b/);
    expect(text).not.toMatch(/\bcash\b/);
    expect(text).not.toMatch(/\bbalance\b/);
  });
});
