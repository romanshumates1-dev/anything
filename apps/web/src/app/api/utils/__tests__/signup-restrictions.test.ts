/**
 * Signup-restriction semantics tests — checkSignupAllowed over the unified
 * email-domain policy (the dual-authority fix).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');

const mockSql = vi.mocked(sql);
const { checkSignupAllowed, getSignupRestrictions } = await import(
  '@/app/api/utils/signup-restrictions'
);
const { _resetEmailDomainPolicyCache } = await import('@/app/api/utils/email-domain-policy');

const ENV_KEY = 'ALLOWED_EMAIL_DOMAINS';
const savedEnv = process.env[ENV_KEY];

beforeEach(() => {
  vi.clearAllMocks();
  _resetEmailDomainPolicyCache();
  delete process.env[ENV_KEY];
});
afterAll(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe('checkSignupAllowed', () => {
  it('OFF: allows any email (restriction actually disabled)', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: false, allowed_email_domains: ['dealswiftautomation.com'] } },
    ]);

    const result = await checkSignupAllowed('newuser@gmail.com');
    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('ON: allows allowlisted domains and rejects others with a message', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: true, allowed_email_domains: ['dealswiftautomation.com'] } },
    ]);

    const ok = await checkSignupAllowed('admin@dealswiftautomation.com');
    expect(ok.allowed).toBe(true);

    const denied = await checkSignupAllowed('newuser@gmail.com');
    expect(denied.allowed).toBe(false);
    expect(denied.message).toMatch(/restricted/i);
  });

  it('no row: behaves like the historical env allowlist (restricted)', async () => {
    mockSql.mockResolvedValue([]);

    expect((await checkSignupAllowed('owner@dealswiftautomation.com')).allowed).toBe(true);
    expect((await checkSignupAllowed('stranger@gmail.com')).allowed).toBe(false);
  });
});

describe('getSignupRestrictions', () => {
  it('reports the effective policy, not a hardcoded default', async () => {
    mockSql.mockResolvedValue([]);

    // Regression: with no DB row the old implementation returned
    // signup_restricted:false while middleware enforced the env allowlist —
    // the UI said OFF while the backend said ON.
    const settings = await getSignupRestrictions();
    expect(settings.signup_restricted).toBe(true);
    expect(settings.allowed_email_domains).toContain('dealswiftautomation.com');
  });

  it('reflects an explicit OFF row', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: false, allowed_email_domains: [] } },
    ]);

    const settings = await getSignupRestrictions();
    expect(settings.signup_restricted).toBe(false);
  });
});
