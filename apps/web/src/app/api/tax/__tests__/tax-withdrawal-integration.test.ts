/**
 * Withdrawal x tax-withholding INTEGRATION.
 *
 * This is the test that matters most for financial integrity: it exercises the
 * one code path where withholding actually changes how much money a seller
 * receives.
 *
 * Properties asserted
 * -------------------
 *  LOSSLESS     : netPayout + taxWithheld === gross amountCents, always.
 *  BALANCE-FAIR : the gross debited from the seller's earnings is unchanged by
 *                 withholding. The seller is not charged twice.
 *  OPT-IN       : a seller with no configured rate has nothing withheld.
 *  REPLAY-SAFE  : a replayed ledger write cannot double-withhold.
 *  FAIL-OPEN    : if the tax store is unavailable the withdrawal still
 *                 completes un-withheld, rather than stranding the seller's
 *                 money behind a 500.
 *
 * The tax STORE is mocked so its behaviour (including an outage) can be driven
 * precisely. The money POLICY is NOT mocked - it runs for real, so these tests
 * exercise the actual arithmetic rather than a stub of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

vi.mock('@/app/api/utils/rateLimit', () => ({
  rateLimitByUser: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 10,
    resetAt: new Date(),
  }),
}));

const mockGetSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => mockGetSession() } },
}));

const mockGetOrganization = vi.fn();
vi.mock('@/lib/organization-context', () => ({
  getOrganization: () => mockGetOrganization(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const mockGetSettings = vi.fn();
const mockRecord = vi.fn();
vi.mock('@/app/api/utils/taxWithholdingStore', () => ({
  getWithholdingSettings: (...a: any[]) => mockGetSettings(...a),
  recordWithholding: (...a: any[]) => mockRecord(...a),
}));

const SELLER = { id: 'user_A', email: 'a@example.com' };
const ORG_A = { id: 'org_A', name: 'Org A' };

const WITHDRAWAL = 100_000; // $1,000.00 gross

function createRequest(amountCents: number) {
  return new Request('http://x/api/withdrawals', {
    method: 'POST',
    body: JSON.stringify({ amountCents }),
  });
}

/** Stage the eight sql responses a successful withdrawal consumes, in order. */
function stageSuccessfulWithdrawal(availableCents = 500_000) {
  mockSql.mockResolvedValueOnce([{ total: 0 }]); // daily limit
  mockSql.mockResolvedValueOnce([{ available: availableCents }]); // balance
  mockSql.mockResolvedValueOnce([]); // pending withdrawal
  mockSql.mockResolvedValueOnce([{ id: 'bank_1', verified: true }]); // bank
  mockSql.mockResolvedValueOnce([{ id: 'earn_1', amount_cents: WITHDRAWAL }]); // reserve
  mockSql.mockResolvedValueOnce([]); // insert withdrawal
  mockSql.mockResolvedValueOnce([]); // mark earnings withdrawn
  mockSql.mockResolvedValueOnce([]); // audit log
}

async function postWithdrawal(amountCents = WITHDRAWAL) {
  const { POST } = await import('@/app/api/withdrawals/route');
  const res = await POST(createRequest(amountCents));
  return { res, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: SELLER });
  mockGetOrganization.mockResolvedValue(ORG_A);
  mockGetSettings.mockResolvedValue(null);
  mockRecord.mockImplementation(async (w: any) => ({
    inserted: true,
    entry: {
      id: 'txw_1',
      kind: w.kind,
      amountCents: w.amountCents,
      rateBps: w.rateBps,
      periodQualified: '2026-Q3',
      createdAt: '2026-08-01T00:00:00.000Z',
      idempotencyKey: 'k',
    },
  }));
});

describe('POST /api/withdrawals - tax withholding', () => {
  it('withholds nothing when the seller has never configured a rate (opt-in)', async () => {
    stageSuccessfulWithdrawal();
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(200);
    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
    // Nothing should have been written to the ledger at all.
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('withholds nothing when the seller has withholding explicitly disabled', async () => {
    mockGetSettings.mockResolvedValue({ enabled: false, rateBps: 2500, jurisdiction: null });
    stageSuccessfulWithdrawal();
    const { body } = await postWithdrawal();

    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('withholds the configured rate and pays the NET to the seller', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: 'US-CA' });
    stageSuccessfulWithdrawal();
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(200);
    // 15% of $1,000.00 = $150.00
    expect(body.taxWithheldCents).toBe(15_000);
    expect(body.netPayoutCents).toBe(85_000);
    expect(body.taxRateBps).toBe(1500);
  });

  it('LOSSLESS: net payout + withheld always equals the gross withdrawal', async () => {
    for (const rateBps of [0, 1, 7, 100, 1500, 2250, 3333, 9999, 10000]) {
      vi.clearAllMocks();
      mockGetSession.mockResolvedValue({ user: SELLER });
      mockGetOrganization.mockResolvedValue(ORG_A);
      mockGetSettings.mockResolvedValue({ enabled: rateBps > 0, rateBps, jurisdiction: null });
      stageSuccessfulWithdrawal();

      const { body } = await postWithdrawal();
      // No cent may be created or destroyed, at any rate.
      expect(body.netPayoutCents + body.taxWithheldCents, `rateBps=${rateBps}`).toBe(
        WITHDRAWAL
      );
      expect(body.netPayoutCents).toBeGreaterThanOrEqual(0);
      expect(body.taxWithheldCents).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the GROSS balance debit unchanged - the seller is not charged twice', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    stageSuccessfulWithdrawal();
    const { body } = await postWithdrawal();

    // The withdrawal record is still the full gross; only the payout is net.
    expect(body.amountCents).toBe(WITHDRAWAL);
    expect(body.netPayoutCents).toBeLessThan(body.amountCents);
  });

  it('scopes the ledger write to the withdrawal id for replay safety', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    stageSuccessfulWithdrawal();
    const { body } = await postWithdrawal();

    expect(mockRecord).toHaveBeenCalledTimes(1);
    const write = mockRecord.mock.calls[0][0];
    expect(write.kind).toBe('WITHHELD');
    expect(write.withdrawalId).toBe(body.withdrawalId);
    // The idempotency scope MUST be the stable withdrawal id, never a timestamp
    // or random value, or a replay would not be rejected by the UNIQUE index.
    expect(write.scope).toBe(body.withdrawalId);
    expect(write.userId).toBe(SELLER.id);
    expect(write.organizationId).toBe(ORG_A.id);
  });

  it('REPLAY-SAFE: a duplicate ledger write withholds nothing a second time', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    // The store reports the row already existed (ON CONFLICT DO NOTHING).
    mockRecord.mockResolvedValue({
      inserted: false,
      entry: {
        id: 'txw_existing',
        kind: 'WITHHELD',
        amountCents: 15_000,
        rateBps: 1500,
        periodQualified: '2026-Q3',
        createdAt: '2026-08-01T00:00:00.000Z',
        idempotencyKey: 'k',
      },
    });
    stageSuccessfulWithdrawal();
    const { body } = await postWithdrawal();

    // The gross withdrawal still happened, but we must not ALSO report a
    // withholding the ledger already recorded on a previous attempt.
    expect(body.amountCents).toBe(WITHDRAWAL);
    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
  });

  it('FAIL-OPEN: a tax-store outage still completes the withdrawal', async () => {
    mockGetSettings.mockRejectedValue(new Error('tax settings table unavailable'));
    stageSuccessfulWithdrawal();
    const { res, body } = await postWithdrawal();

    // The seller's money is already in a PENDING withdrawal; a 500 here would
    // strand it. The withdrawal must complete, un-withheld.
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.withdrawalId).toMatch(/^wdr_/);
    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
  });

  it('FAIL-OPEN: a ledger-write outage still completes the withdrawal', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    mockRecord.mockRejectedValue(new Error('ledger insert failed'));
    stageSuccessfulWithdrawal();
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(200);
    expect(body.amountCents).toBe(WITHDRAWAL);
    expect(body.taxWithheldCents).toBe(0);
  });

  it('withholds nothing at 0% even when enabled', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 0, jurisdiction: null });
    stageSuccessfulWithdrawal();
    const { body } = await postWithdrawal();
    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
  });

  it('withholds the whole amount at 100% without producing a negative payout', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 10000, jurisdiction: null });
    stageSuccessfulWithdrawal();
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(200);
    expect(body.taxWithheldCents).toBe(WITHDRAWAL);
    expect(body.netPayoutCents).toBe(0);
  });
});
