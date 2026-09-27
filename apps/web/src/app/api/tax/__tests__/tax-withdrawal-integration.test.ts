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
 *  ATOMIC       : the ledger row commits in the SAME batch as the money
 *                 movement, so a payout can never commit un-withheld.
 *  GATED        : the ledger row is written only if the withdrawal row exists,
 *                 so a rejected request records tax on no money at all.
 *  FAIL-CLOSED  : if the tax policy cannot be read, or the ledger write fails,
 *                 the withdrawal is REFUSED. An unavailable tax store must never
 *                 degrade into a payout that left the platform untaxed - that
 *                 outcome is unrecoverable and undetectable after the fact.
 *
 * Only the money POLICY and the settings READ are real/mocked respectively; the
 * rest is exercised through a harness that reproduces the driver contract.
 *
 * WHY THE HARNESS SIMULATES SQL RATHER THAN COUNTING CALLS
 * --------------------------------------------------------
 * The properties that actually protect money - the insert being inside the
 * batch, and being gated on the withdrawal existing - live in the SHAPE of the
 * generated SQL. The harness therefore reproduces the driver contract (a tagged
 * template is lazy and thenable; a batch returns one result per statement) and
 * derives each result from the statement's TEXT, so the tests assert what the
 * route asks the database to do rather than the order in which it asks. Stubbing
 * `prepareWithholdingInsert` would assert nothing about the gate it exists to
 * create, which is exactly the class of bug this file guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildIdempotencyKey } from '@/app/api/utils/taxWithholding';

/** The lazy thenable a tagged template returns, as this harness models it. */
type LazyQuery = {
  __sql: { text: string; values: readonly unknown[] };
  then: (
    onFulfilled?: (v: unknown[]) => unknown,
    onRejected?: (e: unknown) => unknown
  ) => unknown;
};

interface DbState {
  dailyTotalCents: number;
  availableCents: number;
  pendingWithdrawal: boolean;
  bankAccount: { id: string; verified: boolean } | null;
  /** Rows the atomic claim (`reserved`) handed back for this request. */
  claimRows: Array<{ id: string; amount_cents: number }>;
  /** Did the atomic claim cover the request? Drives the `created` statement. */
  withdrawalCreated: boolean;
  /** Did the ledger INSERT return a row? false = replay absorbed by UNIQUE. */
  ledgerInserted: boolean;
  /** The ledger INSERT fails inside the batch, so the batch rolls back. */
  ledgerFails: boolean;
}

function defaultDb(): DbState {
  return {
    dailyTotalCents: 0,
    availableCents: 500_000,
    pendingWithdrawal: false,
    bankAccount: { id: 'bank_1', verified: true },
    claimRows: [{ id: 'earn_1', amount_cents: 100_000 }],
    withdrawalCreated: true,
    ledgerInserted: true,
    ledgerFails: false,
  };
}

let db: DbState = defaultDb();

/** Results for statements the route awaits on its own (the pre-flight reads). */
function directResult(text: string): unknown[] {
  if (text.includes('as total')) return [{ total: db.dailyTotalCents }];
  if (text.includes('as available')) return [{ available: db.availableCents }];
  if (text.includes('FROM bank_accounts')) return db.bankAccount ? [db.bankAccount] : [];
  if (text.includes('status IN')) return db.pendingWithdrawal ? [{ id: 'wdr_pending' }] : [];
  return [];
}

/**
 * Results for statements inside `sql.transaction([...])`, derived from the
 * statement text so the harness tracks what the route asks the database to DO.
 */
function batchedResult(text: string): unknown[] {
  if (text.includes('INSERT INTO tax_withholding_ledger')) {
    if (db.ledgerFails) throw new Error('ledger insert failed: connection reset');
    // The real statement is gated on the withdrawal row existing, so a rejected
    // request can never leave a ledger row behind.
    return db.withdrawalCreated && db.ledgerInserted ? [{ id: 'txw_1' }] : [];
  }
  if (text.includes('INSERT INTO withdrawals')) {
    return db.withdrawalCreated ? [{ id: 'wdr_1' }] : [];
  }
  if (text.includes('RETURNING id, amount_cents')) {
    return db.claimRows;
  }
  return [];
}

// A tagged template is LAZY and thenable, so one object can be awaited directly
// or spliced into a batch - the contract the real driver offers. Awaiting is what
// resolves a result, which is why BUILDING the ledger query costs nothing.
const mockSql = vi.fn((strings: any, ...values: unknown[]): LazyQuery => {
  const text = Array.isArray(strings?.raw) ? strings.raw.join('?') : String(strings);
  return {
    __sql: { text, values },
    then: (onFulfilled, onRejected) =>
      Promise.resolve(directResult(text)).then(onFulfilled, onRejected),
  };
}) as any;

mockSql.transaction = vi.fn(async (statements: LazyQuery[]) =>
  statements.map((s) => batchedResult(s.__sql.text))
);

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

// Only the settings READ is faked. `prepareWithholdingInsert` and
// `readWithholdingResult` are the REAL implementations the route imports, so
// the statements this harness inspects are the ones production would send.
const mockGetSettings = vi.fn();
vi.mock('@/app/api/utils/taxWithholdingStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/api/utils/taxWithholdingStore')>();
  return {
    ...actual,
    getWithholdingSettings: (...a: any[]) => mockGetSettings(...a),
  };
});

const SELLER = { id: 'user_A', email: 'a@example.com' };
const ORG_A = { id: 'org_A', name: 'Org A' };

const WITHDRAWAL = 100_000; // $1,000.00 gross

function createRequest(amountCents: number) {
  return new Request('http://x/api/withdrawals', {
    method: 'POST',
    body: JSON.stringify({ amountCents }),
  });
}

async function postWithdrawal(amountCents = WITHDRAWAL) {
  const { POST } = await import('@/app/api/withdrawals/route');
  const res = await POST(createRequest(amountCents));
  return { res, body: await res.json() };
}

type SqlStatement = { text: string; values: readonly unknown[] };

function isTaxInsert(q: SqlStatement) {
  return q.text.includes('INSERT INTO tax_withholding_ledger');
}

/** The statements the route asked the driver to commit as ONE batch. */
function batchStatements(): SqlStatement[] {
  const calls = mockSql.transaction.mock.calls as Array<[LazyQuery[]]>;
  const call = calls[calls.length - 1];
  if (!call) throw new Error('sql.transaction was never called');
  return call[0].map((s) => s.__sql);
}

/** Withholding statements in the committed batch (at most one, by design). */
function taxInserts(): SqlStatement[] {
  return batchStatements().filter(isTaxInsert);
}

/** The withholding statement, asserting one is part of the committed batch. */
function taxInsert(): SqlStatement {
  const q = batchStatements().find(isTaxInsert);
  if (!q) throw new Error('no withholding INSERT in the committed batch');
  return q;
}

/** The withdrawal row insert - the money leaving the seller's balance. */
function withdrawalInsert(): SqlStatement {
  const q = batchStatements().find((s) => s.text.includes('INSERT INTO withdrawals'));
  if (!q) throw new Error('no withdrawals INSERT in the committed batch');
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = defaultDb();
  mockGetSession.mockResolvedValue({ user: SELLER });
  mockGetOrganization.mockResolvedValue(ORG_A);
  mockGetSettings.mockResolvedValue(null);
});

describe('POST /api/withdrawals - tax withholding', () => {
  it('withholds nothing when the seller has never configured a rate (opt-in)', async () => {
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(200);
    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
    // Nothing may be written to the ledger when no rate is configured.
    expect(taxInserts()).toHaveLength(0);
  });

  it('withholds nothing when the seller has withholding explicitly disabled', async () => {
    mockGetSettings.mockResolvedValue({ enabled: false, rateBps: 2500, jurisdiction: null });
    const { body } = await postWithdrawal();

    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
    expect(taxInserts()).toHaveLength(0);
  });

  it('withholds nothing at 0% even when enabled', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 0, jurisdiction: null });
    const { body } = await postWithdrawal();

    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
    // Zero-rate must mean zero rows: the ledger CHECK requires amount > 0.
    expect(taxInserts()).toHaveLength(0);
  });

  it('withholds the configured rate and pays the NET to the seller', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: 'US-CA' });
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(200);
    // 15% of $1,000.00 = $150.00
    expect(body.taxWithheldCents).toBe(15_000);
    expect(body.netPayoutCents).toBe(85_000);
    expect(body.taxRateBps).toBe(1500);
    // LOSSLESS: the split can never create or destroy a cent.
    expect(body.netPayoutCents + body.taxWithheldCents).toBe(body.amountCents);
    expect(body.netPayoutCents).toBe(WITHDRAWAL - 15_000);
  });

  it('ATOMIC: the ledger row rides in the SAME batch as the money movement', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    const { body } = await postWithdrawal();

    const texts = batchStatements().map((s) => s.text);
    // One commit covers both, so a payout can never be recorded un-withheld.
    expect(texts.some((t) => t.includes('INSERT INTO withdrawals'))).toBe(true);
    expect(texts.some((t) => t.includes('INSERT INTO tax_withholding_ledger'))).toBe(true);

    const ledger = taxInsert();
    // GATED: the row is written only if the withdrawal row it taxes exists.
    expect(ledger.text).toContain(
      'WHERE EXISTS (SELECT 1 FROM withdrawals WHERE id = ?)'
    );
    expect(ledger.values[ledger.values.length - 1]).toBe(body.withdrawalId);
    // REPLAY-SAFE scope: the key is the stable withdrawal id, never a timestamp,
    // so the UNIQUE index rejects a replay instead of withholding twice.
    expect(ledger.values).toContain(
      buildIdempotencyKey(body.withdrawalId, 'WITHHELD', 15_000)
    );
    // Integer cents and basis points, as migration 090's CHECKs require.
    expect(ledger.values).toContain(15_000);
    expect(ledger.values).toContain(1500);
  });

  it('BALANCE-FAIR: the gross debited is unchanged by withholding', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    const { body } = await postWithdrawal();

    // The withdrawal record - the money actually leaving the balance - is the
    // full gross; only what reaches the seller is net of tax.
    expect(body.amountCents).toBe(WITHDRAWAL);
    expect(withdrawalInsert().values).toContain(WITHDRAWAL);
    expect(body.netPayoutCents).toBeLessThan(body.amountCents);
  });

  it('REPLAY-SAFE: a duplicate ledger write withholds nothing a second time', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    // ON CONFLICT DO NOTHING returned no row: this exact key already exists.
    db.ledgerInserted = false;
    const { body } = await postWithdrawal();

    // The gross withdrawal is real, but the response must NOT report a second
    // withholding the ledger never recorded - that would double-report tax the
    // seller was already charged for on the first attempt.
    expect(body.success).toBe(true);
    expect(body.amountCents).toBe(WITHDRAWAL);
    expect(body.taxWithheldCents).toBe(0);
    expect(body.netPayoutCents).toBe(WITHDRAWAL);
    // A rate next to a zero withholding would imply tax was taken when none was.
    expect(body.taxRateBps).toBe(0);
    // The statement was still submitted; the UNIQUE index absorbed the replay.
    expect(taxInserts()).toHaveLength(1);
  });

  it('GATED: a rejected withdrawal records tax on no money at all', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    // The claim could not cover the request, so no withdrawal row exists.
    db.claimRows = [];
    db.withdrawalCreated = false;
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Insufficient balance/);
    expect(body.taxWithheldCents).toBeUndefined();
    // The ledger INSERT is submitted, but its EXISTS gate over the withdrawal
    // row yields no row, so no tax is recorded on money that never left the
    // platform - the seller's withheld balance cannot be inflated by a reject.
    expect(taxInsert().text).toContain(
      'WHERE EXISTS (SELECT 1 FROM withdrawals WHERE id = ?)'
    );
  });

  it('FAIL-CLOSED: an unreadable tax policy refuses the withdrawal', async () => {
    mockGetSettings.mockRejectedValue(new Error('tax settings table unavailable'));

    const { res, body } = await postWithdrawal();

    // Degrading to a gross payout would leave the platform untaxed with nothing
    // to detect it from after the fact, so the request is refused instead.
    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    // Refused BEFORE any money moved: the batch was never submitted.
    expect(mockSql.transaction).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: a failed ledger write rolls the whole payout back', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 1500, jurisdiction: null });
    db.ledgerFails = true;

    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(500);
    expect(body.success).toBeUndefined();
    // The batch DID contain the money movement; its rejection is precisely what
    // prevents an un-withheld payout from committing.
    expect(withdrawalInsert()).toBeTruthy();
  });

  it('rounds the withheld amount DOWN so the seller is never over-withheld', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 3, jurisdiction: null });
    // 3 bps of 100_001c is 30.0003c: floor keeps the fraction with the seller.
    const amount = 100_001;
    db.claimRows = [{ id: 'earn_1', amount_cents: amount }];
    const { body } = await postWithdrawal(amount);

    expect(body.taxWithheldCents).toBe(30);
    expect(body.netPayoutCents).toBe(amount - 30);
    // LOSSLESS even off the exact-cent grid.
    expect(body.netPayoutCents + body.taxWithheldCents).toBe(amount);
  });

  it('withholds the whole amount at 100% without producing a negative payout', async () => {
    mockGetSettings.mockResolvedValue({ enabled: true, rateBps: 10000, jurisdiction: null });
    const { res, body } = await postWithdrawal();

    expect(res.status).toBe(200);
    expect(body.taxWithheldCents).toBe(WITHDRAWAL);
    expect(body.netPayoutCents).toBe(0);
  });
});
