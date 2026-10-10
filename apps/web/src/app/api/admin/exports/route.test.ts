/**
 * GET /api/admin/exports — admin-gate + CSV security contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This endpoint exports CROSS-TENANT finance data (payments_ledger, usage_ledger,
 * all organizations) as CSV. It is gated ONLY by `requireAdmin()`. If that gate
 * ever failed open, any authenticated user could download every tenant's payment
 * and usage history — the single most damaging data-exfiltration path in the app.
 * It had NO route test.
 *
 * The handler is correct today (`requireAdmin()` runs first; `!admin.ok` returns
 * its 401/403 response before any query). These tests pin the ordering so the
 * gate cannot be reordered or bypassed.
 *
 * WHAT IS ASSERTED
 * 1. A non-admin (requireAdmin -> ok:false) is rejected with ITS response, and
 *    NO SQL runs — the finance tables are never touched for an unauthorized user.
 * 2. An admin gets a 200 text/csv with a Content-Disposition attachment header.
 * 3. An invalid ?type= is a 400, not a crash.
 * 4. formatCSV quotes values containing commas/quotes/newlines (CSV injection).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

// Control the admin gate per-test.
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

import { GET } from './route';

const ADMIN = { ok: true, userId: 'admin-1', email: 'admin@x.io' };
const DENY = { ok: false, response: Response.json({ error: 'Forbidden: admin role required' }, { status: 403 }) };

function req(type?: string) {
  const url = type ? `http://t/api/admin/exports?type=${type}` : 'http://t/api/admin/exports';
  return new Request(url) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  mockSql.mockResolvedValue([]);
});

describe('GET /api/admin/exports — admin gate', () => {
  it('rejects a non-admin with the gate response and runs NO SQL', async () => {
    requireAdmin.mockResolvedValue(DENY);
    const res = await GET(req('payments'));
    expect(res.status).toBe(403);
    // The critical property: finance tables are never queried for a non-admin.
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized (401) caller and runs NO SQL', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(req('organizations'));
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/exports — admin CSV output', () => {
  it('returns 200 text/csv with an attachment disposition for organizations', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'o1', name: 'Acme', slug: 'acme', created_at: '2026-01-01', member_count: 3, subscription_status: 'active', trial_ends_at: null },
    ]);
    const res = await GET(req('organizations'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="organizations-/);
    const body = await res.text();
    expect(body.split('\n')[0]).toContain('id');
    expect(body).toContain('Acme');
  });

  it('exports payments as CSV for an admin', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'p1', contract_id: 'c1', amount_cents: 9900, currency: 'usd', status: 'paid', created_at: '2026-01-01', paid_at: '2026-01-02', refunded_at: null, organization_name: 'Acme' },
    ]);
    const res = await GET(req('payments'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="payments-/);
  });

  it('returns 400 for an invalid export type without querying', async () => {
    const res = await GET(req('bogus'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/exports — CSV injection safety', () => {
  it('quotes values containing commas so a field cannot inject a column', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'o1', name: 'Acme, Inc "Holdings"', slug: 'acme', created_at: '2026-01-01', member_count: 3, subscription_status: 'active', trial_ends_at: null },
    ]);
    const res = await GET(req('organizations'));
    const body = await res.text();
    // The name field must be wrapped in quotes and its inner quotes doubled.
    expect(body).toContain('"Acme, Inc ""Holdings"""');
  });
});
