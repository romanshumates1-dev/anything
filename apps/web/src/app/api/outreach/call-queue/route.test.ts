/**
 * GET /api/outreach/call-queue — manual-dial list.
 *
 * The compliance guarantee is EXCLUSION IN THE QUERY. A suppressed or
 * DNC-listed number must be structurally unable to reach the client; filtering
 * after the fetch would leave the row on the wire and one `if` away from being
 * dialed. These tests assert the SQL itself carries both NOT EXISTS clauses,
 * because a mocked driver cannot prove row-level exclusion on its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn: vi.fn(async () => false) }));
vi.mock('./brief', () => ({ getOrGenerateBrief: vi.fn(async () => null) }));

import { GET } from './route';

const req = (qs = '') => new Request(`http://t/api/outreach/call-queue${qs}`) as any;

const lead = (id: number, score: number, phone = '+15025550123') => ({
  id,
  name: `Owner ${id}`,
  phone,
  score,
  metadata: { distress_score: score, signals: ['probate', 'vacant'], property_address: '9 Oak St' },
});

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([]);
});

describe('compliance exclusion is in the QUERY, not the client', () => {
  it('excludes opted-out numbers via NOT EXISTS on compliance_records', async () => {
    await GET(req());
    const q = mockSql.mock.calls[0][0].join('?');
    expect(q).toMatch(/NOT EXISTS[\s\S]*compliance_records/);
    expect(q).toMatch(/type = 'opt-out'/);
  });

  it('excludes DNC-listed numbers via NOT EXISTS on dnc_registry', async () => {
    await GET(req());
    const q = mockSql.mock.calls[0][0].join('?');
    expect(q).toMatch(/NOT EXISTS[\s\S]*dnc_registry/);
  });

  it('scopes to the caller org', async () => {
    await GET(req());
    expect(mockSql.mock.calls[0]).toContain('org_1');
  });

  it('never returns a lead without a phone — nothing to dial', async () => {
    await GET(req());
    const q = mockSql.mock.calls[0][0].join('?');
    expect(q).toMatch(/l\.phone IS NOT NULL/);
  });
});

describe('prioritisation and shape', () => {
  it('orders by distress score descending', async () => {
    await GET(req());
    expect(mockSql.mock.calls[0][0].join('?')).toMatch(/ORDER BY score DESC/);
  });

  it('returns brief context per lead for the human caller', async () => {
    mockSql.mockResolvedValueOnce([lead(1, 90)]);
    const b = await (await GET(req())).json();
    expect(b.queue[0]).toMatchObject({
      leadId: 1,
      score: 90,
      signals: ['probate', 'vacant'],
      propertyAddress: '9 Oak St',
    });
    expect(Array.isArray(b.queue[0].timezones)).toBe(true);
    expect(typeof b.queue[0].callableNow).toBe('boolean');
  });

  it('advertises quiet hours rather than filtering rows out', async () => {
    // A human may review at 6am and call at 10am; removing rows would hide work.
    mockSql.mockResolvedValueOnce([lead(1, 90), lead(2, 80)]);
    const b = await (await GET(req())).json();
    expect(b.count).toBe(2);
    expect(b).toHaveProperty('callableNow');
  });

  it('caps the limit', async () => {
    await GET(req('?limit=99999'));
    expect(mockSql.mock.calls[0]).toContain(200);
  });

  it('states the manual-dial constraint in the payload', async () => {
    const b = await (await GET(req())).json();
    expect(b.disclaimer).toMatch(/MANUAL DIAL ONLY/);
    expect(b.disclaimer).toMatch(/no AI voice/i);
  });
});

describe('authz', () => {
  it('rejects non-admins and orgless callers', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await GET(req())).status).toBe(403);

    requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
    getOrganization.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(403);
  });
});
