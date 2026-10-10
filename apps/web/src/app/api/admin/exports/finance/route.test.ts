/**
 * /api/admin/exports/finance — accountant-facing finance CSV export.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This endpoint streams the REAL payments ledger (payments_ledger joined
 * through contracts -> organizations -> owner "user") as a CSV download. It is
 * admin-gated and cross-tenant by design — so if the gate failed open, any
 * authenticated user could exfiltrate every organization's payment history,
 * owner emails, and Stripe intent ids. It had NO route test.
 *
 * It also had a documented history of breakage (BREAKAGE_TABLE #29: it once
 * queried a `transactions` table that exists in no migration, 500-ing every
 * call), and its date filters are deliberately bound parameters (never
 * string-built SQL). Both properties are pinned here.
 *
 * WHAT IS ASSERTED
 * 1. 403s a non-admin and runs NO query.
 * 2. 200s a text/csv attachment with the expected header row for an admin.
 * 3. Converts amount_cents to a 2-decimal dollar figure and defaults the
 *    currency to 'usd' (empty currency column must not become 'undefined').
 * 4. ESCAPES CSV cells: a value containing a comma/quote/newline is quoted with
 *    doubled internal quotes (the naive join that motivated the rewrite).
 * 5. Passes startDate/endDate as BOUND params (the SQL uses `::date IS NULL`
 *    guards) — no string-built SQL.
 * 6. Writes an admin audit entry for the export.
 * 7. On a query failure, 500s with INTERNAL_ERROR and leaks nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

const { adminAudit, clientIp } = vi.hoisted(() => ({ adminAudit: vi.fn(), clientIp: vi.fn(() => '1.2.3.4') }));
vi.mock('@/app/api/utils/adminAudit', () => ({
  adminAudit: (...a: any[]) => adminAudit(...a),
  clientIp: (...a: any[]) => clientIp(...a),
}));

import { GET } from './route';

const ADMIN = { ok: true, userId: 'admin-1', email: 'a@x.io' };
const DENY = { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) };

function getReq(qs = '') {
  return new Request(`http://t/api/admin/exports/finance${qs}`) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  adminAudit.mockResolvedValue(undefined);
  mockSql.mockResolvedValue([]);
});

describe('GET /api/admin/exports/finance', () => {
  it('403s a non-admin and runs NO query', async () => {
    requireAdmin.mockResolvedValue(DENY);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
    expect(adminAudit).not.toHaveBeenCalled();
  });

  it('200s a CSV attachment with the expected header row', async () => {
    mockSql.mockResolvedValueOnce([
      {
        id: 'p1', date: '2026-09-01T00:00:00Z', owner_email: 'o@x.io', organization: 'Acme',
        contract_id: 'k-1', amount_cents: 150000, currency: 'usd', status: 'paid',
        stripe_payment_intent_id: 'pi_1', refunded_at: null,
      },
    ]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Content-Disposition')).toMatch(/finance-export\.csv/);
    const csv = await res.text();
    const header = csv.split('\n')[0];
    expect(header).toContain('owner_email');
    expect(header).toContain('gross_amount');
    // amount_cents -> 2-decimal dollars.
    expect(csv).toContain('1500.00');
  });

  it('defaults a missing currency to usd (never "undefined")', async () => {
    mockSql.mockResolvedValueOnce([
      {
        id: 'p2', date: '2026-09-02T00:00:00Z', owner_email: 'o@x.io', organization: 'Acme',
        contract_id: 'k-1', amount_cents: 100, currency: null, status: 'paid',
        stripe_payment_intent_id: 'pi_2', refunded_at: null,
      },
    ]);
    const csv = await (await GET(getReq())).text();
    expect(csv).not.toMatch(/undefined/);
    expect(csv).toContain('usd');
  });

  it('ESCAPES cells containing commas/quotes (quoted, internal quotes doubled)', async () => {
    mockSql.mockResolvedValueOnce([
      {
        id: 'p3', date: '2026-09-03T00:00:00Z', owner_email: 'o@x.io', organization: 'Acme "HQ", East',
        contract_id: 'k-1', amount_cents: 100, currency: 'usd', status: 'paid',
        stripe_payment_intent_id: 'pi_3', refunded_at: null,
      },
    ]);
    const csv = await (await GET(getReq())).text();
    // The org name becomes a single quoted CSV field with doubled quotes.
    expect(csv).toContain('"Acme ""HQ"", East"');
  });

  it('passes startDate/endDate as BOUND params (no string-built SQL)', async () => {
    await GET(getReq('?startDate=2026-09-01&endDate=2026-09-30'));
    const sqlText = String(mockSql.mock.calls[0]?.[0]?.join(' ') ?? '');
    // The query must guard dates with parameterized NULL checks.
    expect(sqlText).toMatch(/::date IS NULL/);
    // And the actual values are bound, not interpolated into the SQL text.
    expect(mockSql.mock.calls[0]).toContain('2026-09-01');
    expect(mockSql.mock.calls[0]).toContain('2026-09-30');
  });

  it('writes an admin audit entry for the export', async () => {
    mockSql.mockResolvedValueOnce([]);
    await GET(getReq());
    expect(adminAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'admin-1', action: 'finance_export' }),
    );
  });

  it('500s with INTERNAL_ERROR and leaks nothing on a query failure', async () => {
    mockSql.mockRejectedValueOnce(new Error('db password is hunter2'));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // The internal error message must NOT reach the client.
    expect(JSON.stringify(body)).not.toMatch(/hunter2/);
  });
});
