// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { TaxReportPanel, type TaxReport } from './TaxReportPanel';

/**
 * TaxReportPanel contract tests (requirements #16-#17):
 * - fetches the server-bucketed report for the selected period,
 * - renders money ONLY from the API payload (no local money math),
 * - period switch re-requests and updates the CSV export link,
 * - a stale in-flight response is aborted on period change,
 * - failures surface an error with a working Retry.
 */

function makeReport(overrides: Partial<TaxReport> = {}): TaxReport {
  return {
    period: 'quarter',
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-09-30T00:00:00.000Z',
    totals: {
      grossCents: 123456,
      refundedCents: 1000,
      withheldCents: 5000,
      releasedCents: 500,
      netWithheldCents: 4500,
      withdrawnCents: 60000,
      netReceivedCents: 55000,
      currentlyHeldCents: 4500,
    },
    balances: { pendingCents: 100, availableCents: 200, withdrawnCents: 60000 },
    settings: { enabled: true, rateBps: 500, jurisdiction: 'CA' },
    periods: [
      {
        period: '2026-07-01 00:00:00',
        grossCents: 123456,
        refundedCents: 1000,
        pendingCents: 0,
        availableCents: 0,
        withdrawnCents: 60000,
        withheldCents: 5000,
        releasedCents: 500,
        netWithheldCents: 4500,
      },
    ],
    disclaimer:
      'This is a platform earnings report, not an official tax return.',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('TaxReportPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('requests the default (quarter) period on mount and renders totals from the payload', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(makeReport()));

    render(<TaxReportPanel fetcher={fetcher as unknown as typeof fetch} />);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/tax/report?period=quarter');

    await waitFor(() => {
      // $1,234.56 gross appears in BOTH the totals card and the period row -
      // assert on the set of matches, not a single node.
      expect(screen.getAllByText('$1,234.56').length).toBeGreaterThan(0);
      expect(screen.getAllByText('$45.00').length).toBeGreaterThan(0); // tax held
      expect(screen.getAllByText('$550.00').length).toBeGreaterThan(0); // net received
    });
    expect(
      screen.getByText(/not an official tax return/i)
    ).toBeTruthy();
    expect(screen.getByText(/Withholding ON · 5\.00%/)).toBeTruthy();
  });

  it('switching period re-requests with the new period and updates the CSV link', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(jsonResponse(makeReport({ period: 'month' })));

    render(<TaxReportPanel fetcher={fetcher as unknown as typeof fetch} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    const monthButton = screen.getByRole('button', { name: 'Month' });
    fireEvent.click(monthButton);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(fetcher.mock.calls[1][0]).toBe('/api/tax/report?period=month');

    await waitFor(() => {
      const csv = screen.getByRole('link', { name: /CSV/ }) as HTMLAnchorElement;
      expect(csv.getAttribute('href')).toBe(
        '/api/tax/report?period=month&format=csv'
      );
    });
  });

  it('aborts the stale in-flight request when the period changes', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetcher = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (fetcher.mock.calls.length === 1) {
        firstSignal = init?.signal ?? undefined;
      }
      return Promise.resolve(jsonResponse(makeReport()));
    });

    render(<TaxReportPanel fetcher={fetcher as unknown as typeof fetch} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Year' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    // The quarter request must have been cancelled the moment Year was
    // clicked, so its (potentially slower) response cannot overwrite state.
    expect(firstSignal).toBeDefined();
    expect(firstSignal!.aborted).toBe(true);
  });

  it('surfaces a fetch failure with a working Retry', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 500))
      .mockResolvedValueOnce(jsonResponse(makeReport()));

    render(<TaxReportPanel fetcher={fetcher as unknown as typeof fetch} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Report request failed \(500\)/)
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getAllByText('$1,234.56').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/Report request failed/)).toBeNull();
  });

  it('renders an empty-state row when the period has no activity', async () => {
    const empty = makeReport({ periods: [] });
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(empty));

    render(<TaxReportPanel fetcher={fetcher as unknown as typeof fetch} />);

    await waitFor(() => {
      expect(screen.getByText('No activity in this period')).toBeTruthy();
    });
  });
});

