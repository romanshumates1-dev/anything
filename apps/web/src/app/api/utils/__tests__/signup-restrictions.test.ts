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

  /**
   * THE FULL TOGGLE CYCLE (item L, specified as ON -> OFF -> ON).
   *
   * The other tests each prove ONE state in isolation. That is not the same
   * thing as proving the setting is a real, reversible, server-authoritative
   * control: a setting that latched ON, or that only ever read its first value,
   * would still pass every single-state test above.
   *
   * Each step re-queries with a FRESH cache, which is what a different edge
   * isolate or a restarted process sees. The DB is the single authority and the
   * 10 s in-process cache only ever shortens the propagation delay - it is never
   * the source of truth, and nothing here depends on `_resetEmailDomainPolicyCache`
   * being called in between.
   */
  it('ON -> OFF -> ON really flips server-side enforcement each time', async () => {
    const row = (restricted: boolean) => ({
      value: {
        signup_restricted: restricted,
        allowed_email_domains: ['dealswiftautomation.com'],
      },
    });

    // --- step 1: ON -------------------------------------------------------
    mockSql.mockResolvedValue([row(true)]);
    expect((await checkSignupAllowed('stranger@gmail.com')).allowed).toBe(false);
    expect((await checkSignupAllowed('owner@dealswiftautomation.com')).allowed).toBe(true);

    // --- step 2: OFF ------------------------------------------------------
    // A fresh isolate: the policy is re-read, and the restriction is genuinely
    // lifted rather than the UI merely being told it is.
    _resetEmailDomainPolicyCache();
    mockSql.mockResolvedValue([row(false)]);
    expect((await checkSignupAllowed('stranger@gmail.com')).allowed).toBe(true);
    expect((await checkSignupAllowed('anyone@any-domain.test')).allowed).toBe(true);

    // --- step 3: ON again --------------------------------------------------
    // Guards against a one-way latch: turning it back on must restrict again.
    _resetEmailDomainPolicyCache();
    mockSql.mockResolvedValue([row(true)]);
    expect((await checkSignupAllowed('stranger@gmail.com')).allowed).toBe(false);
    expect((await checkSignupAllowed('owner@dealswiftautomation.com')).allowed).toBe(true);
  });

  it('the allowlist itself is honoured and is case-insensitive', async () => {
    mockSql.mockResolvedValue([
      { value: { signup_restricted: true, allowed_email_domains: ['DealSwiftAutomation.com'] } },
    ]);

    // Uppercase in the setting must not exclude a lowercase address.
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
