/**
 * /api/admin/compliance — global suppression-list viewer (ADMIN-only, read-only).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This endpoint exposes the GLOBAL suppression list (every org's opt-out
 * records: phone/email targets). It is admin-gated and cross-tenant by design —
 * a failing-open gate would leak every suppressed contact (PII) to any
 * authenticated user. It had NO route test.
 *
 * It also exposes a search surface (`q`), which must be a BOUND parameter —
 * never string-built SQL — so the injection surface is pinned too.
 *
 * WHAT IS ASSERTED
 * 1. 403s a non-admin and runs NO query.
 * 2. 200s { suppressions, total } for an admin.
 * 3. Passes the `q` search as a BOUND param (SQL uses `ILIKE '%' || $n || '%'`
 *    with the value bound) — no string-built SQL.
 * 4. 500s with Internal Server Error and leaks nothing on a query failure.
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
  return new Request(`http://t/api/admin/compliance${qs}`) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  mockSql.mockResolvedValue([]);
});

describe('GET /api/admin/compliance', () => {
  it('403s a non-admin and runs NO query', async () => {
    requireAdmin.mockResolvedValue(DENY);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('200s the suppression list with a total', async () => {
    mockSql.mockResolvedValueOnce([
      { target: '+15551234567', channel: 'sms', metadata: {}, created_at: '2026-09-01T00:00:00Z' },
    ]);
    mockSql.mockResolvedValueOnce([{ total: 17 }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suppressions).toHaveLength(1);
    expect(body.total).toBe(17);
  });

  it('passes the q search as a BOUND param (no string-built SQL)', async () => {
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{ total: 0 }]);
    await GET(getReq("?q=' OR 1=1--"));
    const sqlText = String(mockSql.mock.calls[0]?.[0]?.join(' ') ?? '');
    // The LIKE pattern is assembled in SQL from a bound param, never interpolated.
    expect(sqlText).toMatch(/ILIKE/);
    expect(sqlText).not.toContain("' OR 1=1--");
    expect(mockSql.mock.calls[0]).toContain("' OR 1=1--");
  });

  it('500s with Internal Server Error and leaks nothing on a query failure', async () => {
    mockSql.mockRejectedValueOnce(new Error('connection string leaked?'));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal Server Error');
    expect(JSON.stringify(body)).not.toMatch(/connection string/);
  });
});
