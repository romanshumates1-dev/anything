/**
 * FINANCIAL-AUTHORITY REGRESSION (independent re-review, 2026-09-26).
 *
 * 1. POST /api/payments/mark-paid  — the ledger row is selected and updated by
 *    a caller-supplied paymentId with NO tenant predicate (payments_ledger has
 *    no organization_id column), so any org admin could flip another tenant's
 *    payment to `paid` and move real money in the books.
 *
 * 2. POST /api/payments/charge-assignment — the assignment fee CHARGED to the
 *    buyer's card/ACH came verbatim from the request body (floor-checked only),
 *    so an admin session could charge an arbitrary figure. The amount is now
 *    derived from the contract, with the request value used only as a
 *    consistency check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

const { adminAudit, clientIp, logEvent } = vi.hoisted(() => ({
  adminAudit: vi.fn(async () => {}),
  clientIp: vi.fn(() => '127.0.0.1'),
  logEvent: vi.fn(async () => {}),
}));
vi.mock('@/app/api/utils/adminAudit', () => ({ adminAudit, clientIp }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent }));

const { alertAssignmentFeePaid, alertPaymentFailed } = vi.hoisted(() => ({
  alertAssignmentFeePaid: vi.fn(async () => {}),
  alertPaymentFailed: vi.fn(async () => {}),
}));
vi.mock('@/app/api/alerts/notification-engine', () => ({
  alertAssignmentFeePaid,
  alertPaymentFailed,
}));

import { POST as markPaidPOST } from '@/app/api/payments/mark-paid/route';
import { POST as chargeAssignmentPOST } from '@/app/api/payments/charge-assignment/route';

const req = (url: string, body: unknown, method = 'POST') =>
  new Request(url, { method, body: JSON.stringify(body) }) as any;

const sqlText = (call: unknown[]) => String(call[0] ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-b' });
  getOrganization.mockResolvedValue({ id: 'org_b', name: 'Org B' });
});

describe('POST /api/payments/mark-paid — ledger rows are tenant-bound', () => {
  it('404s for a payment whose contract belongs to another tenant (no UPDATE)', async () => {
    mockSql.mockResolvedValue([]); // join to contracts yields nothing for org_b
    const res = await markPaidPOST(
      req('http://t/api/payments/mark-paid', { paymentId: 'pay_a', reason: 'wire received' })
    );
    expect(res.status).toBe(404);
    expect(mockSql.mock.calls.map(sqlText).some((t) => /UPDATE\s+payments_ledger/.test(t))).toBe(
      false
    );
  });

  it('binds BOTH the lookup and the UPDATE to the caller org', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'pay_b', contract_id: 'c_b', status: 'sent' }])
      .mockResolvedValueOnce([{ id: 'pay_b', contract_id: 'c_b', amount_cents: 750000 }]);
    const res = await markPaidPOST(
      req('http://t/api/payments/mark-paid', { paymentId: 'pay_b', reason: 'wire received' })
    );
    expect(res.status).toBe(200);
    const [lookup, update] = mockSql.mock.calls;
    expect(String(lookup[0])).toMatch(/c\.organization_id/);
    expect(String(update[0])).toMatch(/organization_id/);
    // org id must be a BOUND value, not interpolated text
    expect(lookup.slice(1)).toContain('org_b');
    expect(update.slice(1)).toContain('org_b');
  });

  it('still requires an audit reason', async () => {
    const res = await markPaidPOST(req('http://t/api/payments/mark-paid', { paymentId: 'pay_b' }));
    expect(res.status).toBe(400);
  });
});


describe('POST /api/payments/charge-assignment — the charged fee is server-derived', () => {
  const signedContract = (feeCents: number | null) => [
    {
      id: 'c_b',
      status: 'SIGNED',
      signed_at: '2026-09-01T00:00:00Z',
      assignment_fee_cents: feeCents,
      deal_metadata: {},
      property_address: '1 Main St',
    },
  ];

  it('refuses a client amount that does not match the contract (and charges nothing)', async () => {
    mockSql.mockResolvedValue(signedContract(750000));
    const res = await chargeAssignmentPOST(
      req('http://t/api/payments/charge-assignment', {
        dealId: 'lead_b',
        buyerId: 'buyer_b',
        paymentType: 'wire',
        amount: 900000, // attacker-chosen, above the floor
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.expectedAmount).toBe(750000);
  });

  it('still refuses a below-floor request up front (no contract lookup side effects)', async () => {
    mockSql.mockResolvedValue(signedContract(750000));
    const res = await chargeAssignmentPOST(
      req('http://t/api/payments/charge-assignment', {
        dealId: 'lead_b',
        buyerId: 'buyer_b',
        paymentType: 'wire',
        amount: 100,
      })
    );
    expect(res.status).toBe(400);
    expect(alertAssignmentFeePaid).not.toHaveBeenCalled();
  });

  it('fails closed when the contract records no fee at all', async () => {
    mockSql.mockResolvedValue(signedContract(null));
    const res = await chargeAssignmentPOST(
      req('http://t/api/payments/charge-assignment', {
        dealId: 'lead_b',
        buyerId: 'buyer_b',
        paymentType: 'wire',
        amount: 750000,
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/could not be determined/i);
  });

  it('uses the CONTRACT fee for a matching request', async () => {
    mockSql.mockResolvedValue(signedContract(750000));
    const res = await chargeAssignmentPOST(
      req('http://t/api/payments/charge-assignment', {
        dealId: 'lead_b',
        buyerId: 'buyer_b',
        paymentType: 'wire',
        amount: 750000,
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).amount).toBe(750000);
  });

  it('never charges when the contract fee itself is below the platform floor', async () => {
    mockSql.mockResolvedValue(signedContract(1000));
    const res = await chargeAssignmentPOST(
      req('http://t/api/payments/charge-assignment', {
        dealId: 'lead_b',
        buyerId: 'buyer_b',
        paymentType: 'wire',
        amount: 900000,
      })
    );
    // Mismatch (and the floor) both refuse; either way nothing is charged.
    expect(res.status).toBe(409);
    expect(alertAssignmentFeePaid).not.toHaveBeenCalled();
  });

  it('never reaches a charge or alert when the fee cannot be trusted', async () => {
    mockSql.mockResolvedValue(signedContract(750000));
    await chargeAssignmentPOST(
      req('http://t/api/payments/charge-assignment', {
        dealId: 'lead_b',
        buyerId: 'buyer_b',
        paymentType: 'card',
        paymentMethodId: 'pm_test',
        amount: 999999999,
      })
    );
    expect(mockSql.mock.calls.map(sqlText).some((t) => /UPDATE\s+contracts/.test(t))).toBe(false);
    expect(alertAssignmentFeePaid).not.toHaveBeenCalled();
  });
});
