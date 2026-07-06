/**
 * Item 2 — DNC compliance audit on campaign start (behavioral).
 *
 * Asserts the real side effect: the INSERT into compliance_audit emitted by
 * recordComplianceAction with the correct org/campaign/user/action/metadata,
 * for both the DNC-disabled and default-enabled cases, and asserts NO audit
 * row is written on the early-return (404 / zero-contacts) paths.
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

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent }));

// NOTE: compliance-audit is intentionally NOT mocked — we want to observe the
// actual INSERT it emits onto the mocked sql.
import { POST } from './route';

function req(id: string) {
  return new Request(`http://t/api/outreach/campaigns/${id}/start`, { method: 'POST' }) as any;
}

function findComplianceInsert() {
  return mockSql.mock.calls.find(
    (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('INSERT INTO compliance_audit')
  );
}

function seedHappyPath(dncEnabled: boolean) {
  mockSql
    .mockResolvedValueOnce([
      { id: 'camp-1', organization_id: 'org-1', status: 'DRAFT', dnc_scrub_enabled: dncEnabled, duration_days: 7, start_date: null },
    ]) // campaign lookup
    .mockResolvedValueOnce([{ cnt: 5 }]) // contact count
    .mockResolvedValueOnce([]) // INSERT compliance_audit
    .mockResolvedValueOnce([]); // UPDATE campaign
}

describe('Item 2 — DNC compliance audit on campaign start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ user: { id: 'user-1', organizationId: 'org-1' } });
  });

  it('writes DNC_SCRUB_DISABLED with correct fields when DNC is off', async () => {
    seedHappyPath(false);
    const res = await POST(req('camp-1'), { params: { id: 'camp-1' } } as any);
    expect(res.status).toBe(200);

    const insert = findComplianceInsert();
    expect(insert).toBeTruthy();
    const [, orgId, campId, userId, action, metaJson] = insert!;
    expect(orgId).toBe('org-1');
    expect(campId).toBe('camp-1');
    expect(userId).toBe('user-1');
    expect(action).toBe('DNC_SCRUB_DISABLED');

    const meta = JSON.parse(metaJson);
    expect(meta.confirmationText).toBe('DNC scrub has been disabled for this campaign');
    expect(typeof meta.timestamp).toBe('string');
    expect(Number.isNaN(new Date(meta.timestamp).getTime())).toBe(false);

    // the audit is also mirrored to the event log with the acting user id
    expect(logEvent).toHaveBeenCalledWith(
      'compliance_audit', 'campaign', 'camp-1', expect.any(Object), 'user-1'
    );
  });

  it('writes DNC_SCRUB_ENABLED (default ON) with correct fields', async () => {
    seedHappyPath(true);
    const res = await POST(req('camp-1'), { params: { id: 'camp-1' } } as any);
    expect(res.status).toBe(200);

    const [, , , , action, metaJson] = findComplianceInsert()!;
    expect(action).toBe('DNC_SCRUB_ENABLED');
    expect(JSON.parse(metaJson).confirmationText).toBe('DNC scrub is enabled by default for this campaign');
  });

  it('falls back organizationId to "default" when session has none', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-9' } });
    seedHappyPath(false);
    await POST(req('camp-1'), { params: { id: 'camp-1' } } as any);
    const [, orgId] = findComplianceInsert()!;
    expect(orgId).toBe('default');
  });

  it('writes NO audit row when the campaign is not found (404)', async () => {
    mockSql.mockResolvedValueOnce([]); // empty campaign lookup
    const res = await POST(req('missing'), { params: { id: 'missing' } } as any);
    expect(res.status).toBe(404);
    expect(findComplianceInsert()).toBeFalsy();
  });

  it('writes NO audit row when the campaign has zero contacts (400)', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'DRAFT', dnc_scrub_enabled: false, duration_days: 7, start_date: null }])
      .mockResolvedValueOnce([{ cnt: 0 }]);
    const res = await POST(req('camp-1'), { params: { id: 'camp-1' } } as any);
    expect(res.status).toBe(400);
    expect(findComplianceInsert()).toBeFalsy();
  });

  it('rejects anonymous callers (401) with no audit', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req('camp-1'), { params: { id: 'camp-1' } } as any);
    expect(res.status).toBe(401);
    expect(findComplianceInsert()).toBeFalsy();
  });
});
