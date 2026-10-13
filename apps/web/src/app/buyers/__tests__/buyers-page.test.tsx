/**
 * @vitest-environment jsdom
 *
 * Regression test for defect #41.
 *
 * `GET /api/buyers` responds with `{ buyers: [...] }`, but `buyers/page.tsx`
 * previously typed the response as `Buyer[]` and called `.map()` on it
 * directly — `TypeError: buyers.map is not a function` — which took down the
 * entire page via the error boundary.
 *
 * Two bugs, not one:
 *   1. The response shape was ignored (object vs. array).
 *   2. A non-2xx response was swallowed into `[]`, so a genuine API failure
 *      rendered as "No buyers in your network yet" — an empty state faking
 *      a success.
 *
 * This test pins the fix: the `{ buyers }` key is extracted, and a failure
 * renders an error card instead of a fake empty state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BuyersPage from '@/app/buyers/page';

// next/navigation: redirect is a no-op in tests. vi.hoisted because vi.mock
// is hoisted above the top-level mockSession constant.
const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}));

// The page calls useSession to gate rendering behind auth.
const mockSession = { user: { id: 'user-1', email: 'test@test.com' } };
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: mockSession,
    isPending: false,
  }),
}));

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
}

const SAMPLE_BUYERS = [
  {
    id: 'buyer_1',
    name: 'Cash Buyer LLC',
    email: 'cash@test.com',
    phone: '+15550100',
    zip_codes: ['30301', '30303'],
    min_price: 150000,
    max_price: 400000,
    property_types: ['single_family', 'multi_family'],
    verified: true,
    created_at: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'buyer_2',
    name: 'Investor Group',
    email: 'investor@test.com',
    zip_codes: ['30305'],
    min_price: 300000,
    max_price: 800000,
    property_types: ['commercial'],
    verified: false,
    created_at: '2026-10-02T10:00:00.000Z',
  },
];

describe('buyers page — defect #41 regression', () => {
  beforeEach(() => {
    mockRedirect.mockClear();
  });

  it('renders buyers from the `{ buyers: [...] }` response shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buyers: SAMPLE_BUYERS }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={makeClient()}>
        <BuyersPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Cash Buyer LLC')).toBeTruthy();
      expect(screen.getByText('Investor Group')).toBeTruthy();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/buyers');
  });

  it('renders an error card — not an empty state — when the API fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Database connection lost' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={makeClient()}>
        <BuyersPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Could not load buyers')).toBeTruthy();
    });

    expect(screen.queryByText('No buyers in your network yet.')).toBeNull();
    expect(screen.getByText(/Database connection lost/i)).toBeTruthy();
  });

  it('renders an empty state only when the API genuinely returns zero buyers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buyers: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <QueryClientProvider client={makeClient()}>
        <BuyersPage />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('No buyers in your network yet.')).toBeTruthy();
    });
  });
});
