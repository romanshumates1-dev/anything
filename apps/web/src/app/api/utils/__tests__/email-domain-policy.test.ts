/**
 * Email-domain policy regression tests — the dual-authority fix.
 *
 * Every case is asserted in BOTH directions so a gutted implementation cannot
 * pass vacuously:
 *   - database row ON   → only allowlisted domains pass
 *   - database row OFF  → restriction actually disabled (any valid email)
 *   - no row            → environment fallback reproduces historical behavior
 *   - database error    → environment fallback (fail CLOSED, never open)
 *   - caching           → one DB read per TTL, resettable for tests
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');

const mockSql = vi.mocked(sql);
const {
  getEmailDomainPolicy,
  isEmailDomainAllowedEffective,
  _resetEmailDomainPolicyCache,
} = await import('@/app/api/utils/email-domain-policy');

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

describe('database policy (authoritative when a row exists)', () => {
  it('ON: enforces only the allowlisted domains, case-insensitively', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: true, allowed_email_domains: ['Partner.CO', ' Sub.example '] } },
    ]);

    const policy = await getEmailDomainPolicy();
    expect(policy).toEqual({
      restricted: true,
      domains: ['partner.co', 'sub.example'],
      source: 'database',
    });

    expect(await isEmailDomainAllowedEffective('user@partner.co')).toBe(true);
    expect(await isEmailDomainAllowedEffective('USER@PARTNER.CO')).toBe(true);
    expect(await isEmailDomainAllowedEffective('user@sub.example')).toBe(true);

    // Rejected in the other direction — and the env default does NOT apply
    // once a database row exists.
    process.env.ALLOWED_EMAIL_DOMAINS = 'dealswiftautomation.com';
    expect(await isEmailDomainAllowedEffective('user@dealswiftautomation.com')).toBe(false);
    expect(await isEmailDomainAllowedEffective('user@gmail.com')).toBe(false);
  });

  it('OFF: restriction is actually disabled — any well-formed email passes', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: false, allowed_email_domains: ['dealswiftautomation.com'] } },
    ]);

    const policy = await getEmailDomainPolicy();
    expect(policy.restricted).toBe(false);
    expect(policy.source).toBe('database');

    expect(await isEmailDomainAllowedEffective('anyone@gmail.com')).toBe(true);
    expect(await isEmailDomainAllowedEffective('owner@random-domain.io')).toBe(true);

    // Fail closed on malformed input even with restriction OFF.
    expect(await isEmailDomainAllowedEffective('not-an-email')).toBe(false);
    expect(await isEmailDomainAllowedEffective(undefined as never)).toBe(false);
    expect(await isEmailDomainAllowedEffective('@nodomain')).toBe(false);
  });

  it('ON with an EMPTY allowlist fails closed (denies everyone)', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: true, allowed_email_domains: [] } },
    ]);

    expect(await isEmailDomainAllowedEffective('user@dealswiftautomation.com')).toBe(false);
    expect(await isEmailDomainAllowedEffective('user@gmail.com')).toBe(false);
  });
});

describe('environment fallback (no database row)', () => {
  it('defaults to the historical allowlist when no row exists', async () => {
    mockSql.mockResolvedValue([]);

    const policy = await getEmailDomainPolicy();
    expect(policy).toEqual({
      restricted: true,
      domains: ['dealswiftautomation.com'],
      source: 'environment',
    });

    expect(await isEmailDomainAllowedEffective('roman@dealswiftautomation.com')).toBe(true);
    expect(await isEmailDomainAllowedEffective('someone@gmail.com')).toBe(false);
  });

  it('honors a configured ALLOWED_EMAIL_DOMAINS list when no row exists', async () => {
    mockSql.mockResolvedValue([]);
    process.env.ALLOWED_EMAIL_DOMAINS = 'envtest.example, second.example';

    const policy = await getEmailDomainPolicy();
    expect(policy.source).toBe('environment');
    expect(policy.domains).toEqual(['envtest.example', 'second.example']);
    expect(await isEmailDomainAllowedEffective('a@envtest.example')).toBe(true);
    expect(await isEmailDomainAllowedEffective('a@dealswiftautomation.com')).toBe(false);
  });

  it('falls back to the environment policy when the database errors (fail closed)', async () => {
    mockSql.mockRejectedValue(new Error('connection refused'));

    const policy = await getEmailDomainPolicy();
    expect(policy.source).toBe('environment');
    expect(policy.restricted).toBe(true);
    expect(await isEmailDomainAllowedEffective('intruder@gmail.com')).toBe(false);
    expect(await isEmailDomainAllowedEffective('owner@dealswiftautomation.com')).toBe(true);
  });
});

describe('caching', () => {
  it('serves repeated reads from cache (single DB query per TTL)', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: true, allowed_email_domains: ['cached.example'] } },
    ]);

    await getEmailDomainPolicy();
    await getEmailDomainPolicy();
    await isEmailDomainAllowedEffective('a@cached.example');

    expect(mockSql).toHaveBeenCalledTimes(1);

    _resetEmailDomainPolicyCache();
    await getEmailDomainPolicy();
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it('single-flights concurrent readers into one query', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: false, allowed_email_domains: [] } },
    ]);

    const [a, b, c] = await Promise.all([
      getEmailDomainPolicy(),
      getEmailDomainPolicy(),
      getEmailDomainPolicy(),
    ]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});
