/**
 * Admin signup-restriction API tests — authorization, validation, persistence.
 *
 * Covers the required matrix: toggle ON, toggle OFF, API-manipulation attempts
 * (bad types / bad domains / empty allowlist while ON), unauthorized access,
 * and the effective-policy GET (UI can never disagree with enforcement).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');
vi.mock('@/app/api/utils/authz', () => ({
  requireAdmin: vi.fn(),
}));

const mockSql = vi.mocked(sql);
const { requireAdmin } = await import('@/app/api/utils/authz');
const { _resetEmailDomainPolicyCache } = await import('@/app/api/utils/email-domain-policy');
const route = await import('./route');

const ENV_KEY = 'ALLOWED_EMAIL_DOMAINS';
const savedEnv = process.env[ENV_KEY];

const ADMIN = { ok: true, userId: 'admin1', email: 'admin@dealswiftautomation.com' } as const;
const DENIED = { ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) } as const;

function put(body: unknown): Request {
  return new Request('http://test/api/admin/settings/signup', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetEmailDomainPolicyCache();
  delete process.env[ENV_KEY];
});
afterAll(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe('GET /api/admin/settings/signup', () => {
  it('returns 401 for a non-admin caller', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(DENIED);
    const res = await route.GET();
    expect(res.status).toBe(401);
  });

  it('returns the effective DATABASE policy when a row exists', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    mockSql.mockResolvedValue([
      { value: { signup_restricted: true, allowed_email_domains: ['dealswiftautomation.com'] } },
    ]);

    const res = await route.GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({
      signup_restricted: true,
      allowed_email_domains: ['dealswiftautomation.com'],
      source: 'database',
    });
  });

  it('regression: with NO row, reports the effective ENV policy (ON), not a hardcoded OFF', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    mockSql.mockResolvedValue([]);

    const res = await route.GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    // Previously this returned signup_restricted:false while middleware
    // enforced the env allowlist — the exact UI/backend divergence bug.
    expect(data.signup_restricted).toBe(true);
    expect(data.source).toBe('environment');
    expect(data.allowed_email_domains).toContain('dealswiftautomation.com');
  });
});

describe('PUT /api/admin/settings/signup', () => {
  it('rejects non-admin callers (no direct API manipulation)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(DENIED);
    const res = await route.PUT(put({ signup_restricted: false, allowed_email_domains: [] }));
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean signup_restricted', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    const res = await route.PUT(put({ signup_restricted: 'yes', allowed_email_domains: ['a.co'] }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects non-array domains', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    const res = await route.PUT(put({ signup_restricted: true, allowed_email_domains: 'a.co' }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed domains', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    const res = await route.PUT(put({ signup_restricted: true, allowed_email_domains: ['not a domain'] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/invalid domain/i);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects ON with an empty allowlist', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    const res = await route.PUT(put({ signup_restricted: true, allowed_email_domains: [] }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('persists toggle ON with normalized domains + writes an audit row', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    mockSql.mockResolvedValue([]);

    const res = await route.PUT(
      put({ signup_restricted: true, allowed_email_domains: [' Example.COM ', 'example.com'] })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.signup_restricted).toBe(true);
    expect(data.allowed_email_domains).toEqual(['example.com']);
    expect(data.source).toBe('database');
    // settings upsert + admin_audit_log insert
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it('persists toggle OFF (restriction actually disabled)', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
    mockSql.mockResolvedValue([]);

    const res = await route.PUT(put({ signup_restricted: false, allowed_email_domains: [] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.signup_restricted).toBe(false);
    expect(data.source).toBe('database');
  });
});
