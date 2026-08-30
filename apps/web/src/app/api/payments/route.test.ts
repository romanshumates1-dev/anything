/**
 * IDOR fix (bug #35, explicitly named "/api/payments?contractId"):
 * GET /api/payments?contractId=xxx filtered payments_ledger on contract_id
 * ALONE — no organization check at all. Any authenticated user from ANY org
 * could read another org's payment amounts, buyer ids, and Stripe payment
 * intent ids just by passing a different contractId. Fixed by joining to
 * contracts and requiring c.organization_id to match the caller's own org,
 * matching the (already-correct) unfiltered branch below it.
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

import { GET } from './route';

function req(contractId: string) {
  return new Request(`http://t/api/payments?contractId=${contractId}`) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('GET /api/payments?contractId', () => {
  it('scopes the contractId-filtered branch by the caller\'s own org', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'pay-1', contract_id: 'contract-owned-by-org-A', amount_cents: 500000 }]);

    const res = await GET(req('contract-owned-by-org-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);

    const call = mockSql.mock.calls[0];
    const query = call[0].join('?');
    expect(query).toContain('JOIN contracts');
    expect(query).toMatch(/organization_id/);
    expect(call).toContain('org-A');
  });

  it('returns nothing for a contract belonging to a DIFFERENT org (never leaks org B\'s payment data)', async () => {
    // The real query includes `AND c.organization_id = org` — simulate what
    // Postgres would actually return: zero rows, because the join+filter
    // excludes contract rows owned by another org.
    mockSql.mockResolvedValueOnce([]);

    const res = await GET(req('contract-owned-by-org-B'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);

    // The query itself must have been bound with OUR org, not org B's — this
    // is what makes the empty result a real filter, not a lucky empty table.
    const call = mockSql.mock.calls[0];
    expect(call).toContain('org-A');
  });

  it('401s anonymous callers', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req('contract-1'));
    expect(res.status).toBe(401);
  });

  it('403s when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET(req('contract-1'));
    expect(res.status).toBe(403);
  });
});
