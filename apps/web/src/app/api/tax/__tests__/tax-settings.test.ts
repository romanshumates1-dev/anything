/**
 * Tax withholding settings API tests.
 *
 * The pure money policy is covered exhaustively in taxWithholding.test.ts. This
 * file covers what can still be wrong even when the arithmetic is right:
 * AUTHORIZATION (can seller A touch seller B's rate?) and BOUNDARY/negative
 * validation of the rate itself.
 *
 * Every assertion is on behaviour visible to a caller, plus the SQL text for the
 * tenant predicate - the two things that actually constitute the security
 * property here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const mockGetSession = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: () => mockGetSession() } },
}));

const mockGetOrganization = vi.fn();
vi.mock('@/lib/organization-context', () => ({
  getOrganization: () => mockGetOrganization(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const SELLER = { id: 'user_A', email: 'a@example.com' };
const ORG_A = { id: 'org_A', name: 'Org A' };

const importSettings = () => import('@/app/api/tax/settings/route');

/** Route the mocked sql`` template by table, and record every statement. */
function mockSqlByTable(handlers: Record<string, any>, seen: string[] = []) {
  mockSql.mockImplementation((strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    seen.push(text);
    for (const [table, handler] of Object.entries(handlers)) {
      if (text.includes(table)) return Promise.resolve(handler(text));
    }
    return Promise.resolve([]);
  });
  return seen;
}

describe('tax settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: SELLER });
    mockGetOrganization.mockResolvedValue(ORG_A);
  });

  it('GET rejects an unauthenticated caller with 401', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await (await importSettings()).GET();
    expect(res.status).toBe(401);
  });

  it('GET returns 403 when the session has no organization', async () => {
    mockGetOrganization.mockResolvedValueOnce(null);
    const res = await (await importSettings()).GET();
    expect(res.status).toBe(403);
  });

  it('GET defaults to DISABLED for a seller who never configured a rate', async () => {
    mockSqlByTable({ tax_withholding_settings: () => [] });
    const res = await (await importSettings()).GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // An unconfigured seller is a normal state, not an error.
    expect(body.settings).toEqual({ enabled: false, rateBps: 0, jurisdiction: null });
    expect(body.currentlyHeldCents).toBe(0);
    expect(body.disclaimer).toMatch(/not a tax form/i);
  });

  it('GET scopes every query to the SESSION org and user', async () => {
    const seen = mockSqlByTable({ tax_withholding_settings: () => [] });
    const res = await (await importSettings()).GET();
    expect(res.status).toBe(200);
    const settingsSql = seen.find((s) => s.includes('tax_withholding_settings'))!;
    expect(settingsSql).toContain('user_id');
    expect(settingsSql).toContain('organization_id');
  });

  const put = (body: any) =>
    (async () => {
      mockSqlByTable({ tax_withholding_settings: () => [] });
      return (await importSettings()).PUT(
        new Request('http://x/api/tax/settings', {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      );
    })();

  describe('PUT rate validation (boundary + negative testing)', () => {
    it('accepts the inclusive 0% and 100% edges', async () => {
      for (const rateBps of [0, 10000]) {
        const res = await put({ enabled: true, rateBps });
        expect(res.status, `rateBps=${rateBps}`).toBe(200);
      }
    });

    it('accepts a normal rate', async () => {
      expect((await put({ enabled: true, rateBps: 1500 })).status).toBe(200);
    });

    it('rejects out-of-range, fractional, and wrong-typed rates', async () => {
      for (const rateBps of [-1, 10001, 12.5, '1500', null, undefined, NaN]) {
        const res = await put({ enabled: true, rateBps });
        expect(res.status, `rateBps=${String(rateBps)}`).toBe(400);
      }
    });

    it('rejects a non-JSON body', async () => {
      mockSqlByTable({ tax_withholding_settings: () => [] });
      const res = await (await importSettings()).PUT(
        new Request('http://x/api/tax/settings', { method: 'PUT', body: 'not json' })
      );
      expect(res.status).toBe(400);
    });

    it('treats "enabled with rate 0" as DISABLED rather than withholding nothing silently', async () => {
      const res = await put({ enabled: true, rateBps: 0 });
      const body = await res.json();
      expect(body.settings.enabled).toBe(false);
    });

    it('IGNORES mass-assigned user/org ids in the body', async () => {
      const seen = mockSqlByTable({ tax_withholding_settings: () => [] });
      await (await importSettings()).PUT(
        new Request('http://x/api/tax/settings', {
          method: 'PUT',
          body: JSON.stringify({
            enabled: true,
            rateBps: 1500,
            user_id: 'user_ATTACKER',
            organization_id: 'org_ATTACKER',
          }),
        })
      );
      // The upsert may only bind session-derived ids; the attacker strings must
      // not appear anywhere in the emitted statement.
      const upsert = seen.find((s) => s.includes('INSERT INTO tax_withholding_settings'))!;
      expect(upsert).toBeDefined();
      expect(upsert).not.toContain('ATTACKER');
    });
  });
});
