/**
 * Access policy unit tests — email-domain allowlist + role gate config.
 * Env is read at call time, so each case sets/clears process.env directly.
 * Every rule is asserted in BOTH directions (accept + reject) so a gutted
 * implementation cannot pass vacuously.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  emailDomain,
  getAllowedEmailDomains,
  getMinAccessRole,
  getSeedAdminEmails,
  hasRequiredRole,
  isAdminRole,
  isEmailDomainAllowed,
  isSeedAdminEmail,
  roleRank,
} from '../access-control';

const ENV_KEYS = ['ALLOWED_EMAIL_DOMAINS', 'MIN_ACCESS_ROLE', 'SEED_ADMIN_EMAILS'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('email domain allowlist', () => {
  it('defaults to dealswiftautomation.com only', () => {
    expect(getAllowedEmailDomains()).toEqual(['dealswiftautomation.com']);
    expect(isEmailDomainAllowed('roman.shumate@dealswiftautomation.com')).toBe(true);
    expect(isEmailDomainAllowed('someone@gmail.com')).toBe(false);
    expect(isEmailDomainAllowed('someone@dealswiftautomation.com.evil.com')).toBe(false);
  });

  it('is case-insensitive on both sides', () => {
    expect(isEmailDomainAllowed('X@DealSwiftAutomation.COM')).toBe(true);
    process.env.ALLOWED_EMAIL_DOMAINS = 'Example.ORG';
    expect(isEmailDomainAllowed('a@example.org')).toBe(true);
  });

  it('supports comma-separated multi-domain config (future loosening without code changes)', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = 'dealswiftautomation.com, partner.co';
    expect(isEmailDomainAllowed('a@partner.co')).toBe(true);
    expect(isEmailDomainAllowed('a@dealswiftautomation.com')).toBe(true);
    expect(isEmailDomainAllowed('a@gmail.com')).toBe(false);
  });

  it('rejects malformed emails and non-strings (fail closed)', () => {
    for (const bad of ['', 'nodomain', '@only-domain.com', 'trailing@', null, undefined, 42]) {
      expect(isEmailDomainAllowed(bad as never)).toBe(false);
    }
  });

  it('an empty/whitespace env value falls back to the default rather than allowing everything', () => {
    process.env.ALLOWED_EMAIL_DOMAINS = '  , ,';
    expect(getAllowedEmailDomains()).toEqual(['dealswiftautomation.com']);
  });

  it('emailDomain extracts after the LAST @ (no local-part @ smuggling)', () => {
    expect(emailDomain('a@b@gmail.com')).toBe('gmail.com');
    expect(emailDomain('x@dealswiftautomation.com')).toBe('dealswiftautomation.com');
  });
});

describe('role gate', () => {
  it('ranks ADMIN > MEMBER > unknown', () => {
    expect(roleRank('ADMIN')).toBeGreaterThan(roleRank('MEMBER'));
    expect(roleRank('MEMBER')).toBeGreaterThan(roleRank('SUPERUSER'));
    expect(roleRank(null)).toBe(0);
  });

  it('MIN_ACCESS_ROLE defaults to ADMIN: members are blocked, admins pass', () => {
    expect(getMinAccessRole()).toBe('ADMIN');
    expect(hasRequiredRole('MEMBER')).toBe(false);
    expect(hasRequiredRole('ADMIN')).toBe(true);
    expect(hasRequiredRole(undefined)).toBe(false);
  });

  it('MIN_ACCESS_ROLE=MEMBER loosens the gate without code changes', () => {
    process.env.MIN_ACCESS_ROLE = 'MEMBER';
    expect(hasRequiredRole('MEMBER')).toBe(true);
    expect(hasRequiredRole('ADMIN')).toBe(true);
    expect(hasRequiredRole('garbage')).toBe(false);
  });

  it('invalid MIN_ACCESS_ROLE falls back to ADMIN (fail closed)', () => {
    process.env.MIN_ACCESS_ROLE = 'EVERYONE';
    expect(getMinAccessRole()).toBe('ADMIN');
    expect(hasRequiredRole('MEMBER')).toBe(false);
  });

  it('isAdminRole is exact', () => {
    expect(isAdminRole('ADMIN')).toBe(true);
    expect(isAdminRole('MEMBER')).toBe(false);
    expect(isAdminRole('admin')).toBe(false);
  });
});

describe('seed admin emails', () => {
  it('defaults to the owner', () => {
    expect(getSeedAdminEmails()).toEqual(['roman.shumate@dealswiftautomation.com']);
    expect(isSeedAdminEmail('roman.shumate@dealswiftautomation.com')).toBe(true);
    expect(isSeedAdminEmail('Roman.Shumate@DealSwiftAutomation.com')).toBe(true);
    expect(isSeedAdminEmail('other@dealswiftautomation.com')).toBe(false);
  });

  it('is configurable via SEED_ADMIN_EMAILS', () => {
    process.env.SEED_ADMIN_EMAILS = 'a@dealswiftautomation.com,b@dealswiftautomation.com';
    expect(isSeedAdminEmail('b@dealswiftautomation.com')).toBe(true);
    expect(isSeedAdminEmail('roman.shumate@dealswiftautomation.com')).toBe(false);
  });
});
