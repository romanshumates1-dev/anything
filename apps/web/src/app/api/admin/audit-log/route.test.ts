/**
 * /api/admin/audit-log — admin audit log viewer (ADMIN-only).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The audit log is the forensic record of every admin action (refunds,
 * exports, subscription changes). It is cross-tenant, admin-gated — if the
 * gate failed open, anyone could read who did what across all orgs. It had NO
 * route test, and its header documents a real prior bug (BREAKAGE_TABLE #29):
 * the old version declared `let total` then reassigned a shadowing inner
 * destructure, so `pagination.total` was ALWAYS undefined. The rewrite fixed
 * that; this suite pins the fix and the gate.
 *
 * WHAT IS ASSERTED
 * 1. 403s a non-admin and runs NO query.
 * 2. 200s { logs, pagination: { limit, offset, total } } where `total` is the
 *    COUNT query's integer — the documented "always undefined" regression.
 * 3. Passes action/targetType filters as BOUND params (`::text IS NULL` guards).
 * 4. Clamps limit to <= 500, defaults to 100; floors negative offset at 0.
 * 5. 500s with INTERNAL_ERROR and leaks nothing on a query failure.
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

import { GET } from './route';

const ADMIN = { ok: true, userId: 'admin-1', email: 'a@x.io' };
const DENY = { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) };

function getReq(qs = '') {
  return new Request(`http://t/api/admin/audit-log${qs}`) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  mockSql.mockResolvedValue([]);
});

describe('GET /api/admin/audit-log', () => {
  it('403s a non-admin and runs NO query', async () => {
    requireAdmin.mockResolvedValue(DENY);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('200s logs with a DEFINITE pagination.total (the "always undefined" regression)', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'a1', action: 'refund_created' }]); // rows
    mockSql.mockResolvedValueOnce([{ total: 42 }]); // COUNT
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toHaveLength(1);
    // BREAKAGE_TABLE #29: total was ALWAYS undefined due to shadowing. Pin the fix.
    expect(body.pagination.total).toBe(42);
    expect(body.pagination.limit).toBe(100); // default
    expect(body.pagination.offset).toBe(0);
  });

  it('passes action/targetType as BOUND params (no string-built SQL)', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ total: 0 }]);
    await GET(getReq('?action=refund_created&targetType=payment'));
    const sqlText = String(mockSql.mock.calls[0]?.[0]?.join(' ') ?? '');
    expect(sqlText).toMatch(/::text IS NULL/);
    expect(mockSql.mock.calls[0]).toContain('refund_created');
    expect(mockSql.mock.calls[0]).toContain('payment');
  });

  it('clamps limit to <= 500 and floors negative offset at 0', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ total: 0 }]);
    const res = await GET(getReq('?limit=9999&offset=-5'));
    const body = await res.json();
    expect(body.pagination.limit).toBe(500);
    expect(body.pagination.offset).toBe(0);
  });

  it('500s with INTERNAL_ERROR and leaks nothing on a query failure', async () => {
    mockSql.mockRejectedValueOnce(new Error('secret db detail'));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toMatch(/secret db detail/);
  });
});
