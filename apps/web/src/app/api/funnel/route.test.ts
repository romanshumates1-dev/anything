/**
 * Bug #36 — /api/funnel joined `stage_transitions st ON c.id = st.contract_id`,
 * but stage_transitions has no contract_id column at all (it keys off
 * lead_id/campaign_id — see db/migrations/021_stage_transitions.sql) and one
 * query's ORDER BY referenced a column outside its GROUP BY. Both meant this
 * route 500'd on every call. Fixed: org scope comes from the lead
 * (stage_transitions.lead_id -> leads.organization_id), and the per-campaign
 * breakdown groups on stage_transitions' own campaign_id column directly.
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

function req() {
  return new Request('http://t/api/funnel') as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('GET /api/funnel', () => {
  it('does not reference a nonexistent contract_id column and returns 200', async () => {
    mockSql
      .mockResolvedValueOnce([{ to_stage: 'NEW', count: 10 }, { to_stage: 'ENGAGED', count: 4 }]) // stageCounts
      .mockResolvedValueOnce([{ campaign_id: 'camp-1', to_stage: 'NEW', count: 10 }]) // perCampaign
      .mockResolvedValueOnce([{ date: '2026-07-20', transitions: 3 }]); // timeseries

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.funnel.NEW).toBe(10);
    expect(body.funnel.ENGAGED).toBe(4);
    expect(body.perCampaign[0].campaign_id).toBe('camp-1');

    // Every query issued must join on leads (via lead_id), never contracts
    // via a contract_id column stage_transitions doesn't have.
    for (const call of mockSql.mock.calls) {
      const text = call[0].join('?');
      expect(text).not.toContain('st.contract_id');
      expect(text).not.toMatch(/JOIN contracts/);
    }
    const stageCountsQuery = mockSql.mock.calls[0][0].join('?');
    expect(stageCountsQuery).toContain('JOIN leads');
  });

  it('401s anonymous callers', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('403s when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});
