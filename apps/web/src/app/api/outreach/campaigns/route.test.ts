/**
 * GET /api/outreach/campaigns — auth + tenant-isolation contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every sibling handler under `api/outreach/campaigns/[id]/*` (start, pause,
 * resume, stats, contacts, cancel) has a route test. The LIST handler — the one
 * `app/campaigns/page.tsx` actually calls to render the whole dashboard — was
 * the only one with no test, and it is the handler that returns rows from the
 * widest table. That is exactly the surface where a missing `organization_id`
 * filter would leak another tenant's campaigns, and nothing would catch it.
 *
 * The handler IS correct today (auth 401, org 403, `WHERE organization_id =
 * $orgId`). These tests pin that so it cannot silently regress into a
 * cross-tenant leak — the same class of defect as the phantom-column and
 * IDOR-scoping fixes already recorded in the matrix.
 *
 * WHAT IS ASSERTED
 * 1. 401 for an anonymous caller (no session).
 * 2. 403 when the session has no organization.
 * 3. 200 with the org's rows, and the org id is BOUND into the query.
 * 4. The query is SCOPED by organization_id (tenant isolation), never global.
 * 5. On a DB throw, 500 (no partial/cross-tenant leak).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

// The handler imports a few helpers that touch the DB only inside POST; stub
// them so importing the module has no side effects in this GET-only test.
vi.mock('@/app/api/utils/contactImport', () => ({
  parseContactList: vi.fn(() => []),
  dedupeContacts: vi.fn(() => []),
}));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({
  resolveLeadIdByPhone: vi.fn(async () => null),
}));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import { GET } from './route';

function req() {
  return new Request('http://t/api/outreach/campaigns') as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('GET /api/outreach/campaigns — list handler', () => {
  it('401s anonymous callers (no session)', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('403s a session with no organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it("200s with the org's campaigns and binds the org id into the query", async () => {
    const rows = [
      { id: 'c1', organization_id: 'org-1', name: 'Seller blast', total_contacts: 12 },
      { id: 'c2', organization_id: 'org-1', name: 'Buyer wave', total_contacts: 0 },
    ];
    mockSql.mockResolvedValueOnce(rows);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);

    // The org id must be passed as a bound parameter, not interpolated.
    const call = mockSql.mock.calls[0];
    expect(call).toContain('org-1');
  });

  it('SCOPES the query by organization_id — no global list leak', async () => {
    mockSql.mockResolvedValueOnce([]);
    await GET(req());
    // `sql` is a tagged template: call[0] is the TemplateStringsArray, so join
    // it to reconstruct the SQL text (same approach as achievements/route.test).
    const sqlText = String(mockSql.mock.calls[0]?.[0]?.join(' ') ?? '');
    expect(sqlText).toMatch(/organization_id/i);
    expect(sqlText).toMatch(/WHERE/i);
  });

  it('500s on a DB throw without leaking rows', async () => {
    mockSql.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
