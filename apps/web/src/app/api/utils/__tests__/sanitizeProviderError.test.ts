/**
 * Provider-error sanitization.
 *
 * The threat is specific: an integration "test connection" screen must help an
 * admin debug their own setup, but raw Twilio/AWS SDK error text is not safe to
 * echo. Twilio embeds the destination phone number and account identifiers in
 * its messages; AWS credential errors can name the account. These routes are
 * authenticated and tenant-scoped, so this is defence in depth rather than a
 * live cross-tenant hole - the point is that the RESPONSE should never carry
 * third-party internals, while the server log still has everything.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeProviderError } from '@/app/api/utils/sanitizeProviderError';

describe('sanitizeProviderError', () => {
  it('never returns the raw provider text', () => {
    const hostile = [
      'The number +15551234567 is unverified for account ACxxxxxxxx',
      'Authenticate: failed to authenticate, awsAccessKeyId AKIAIOSFODNN7EXAMPLE',
      'Twilio Error 21614: unverified number for +15559876543',
      'connect ECONNREFUSED 10.0.4.19:587 smtp.internal.corp',
      'SQLSTATE[08006] connection to db-primary-3.internal failed',
    ];
    for (const raw of hostile) {
      const out = sanitizeProviderError(new Error(raw), 'Twilio');
      expect(out).not.toContain('+1555');
      expect(out).not.toContain('AKIA');
      expect(out).not.toContain('ACxxx');
      expect(out).not.toContain('10.0.4.19');
      expect(out).not.toContain('db-primary-3');
      expect(out).not.toContain('ECONNREFUSED');
      expect(out.toLowerCase()).toContain('twilio');
    }
  });

  it('classifies credential problems, which are the most common setup mistake', () => {
    for (const raw of [
      'Invalid credentials',
      'unauthorized',
      'Authentication failed',
      'AccessDeniedException',
      'permission denied',
    ]) {
      expect(sanitizeProviderError(new Error(raw), 'AWS SES')).toMatch(/credentials/i);
    }
  });

  it('classifies destination-number problems', () => {
    for (const raw of ['21614', '21211', 'The To number is not a valid phone number']) {
      expect(sanitizeProviderError(new Error(raw), 'Twilio')).toMatch(/number/i);
    }
  });

  it('classifies timeouts', () => {
    expect(sanitizeProviderError(new Error('ETIMEDOUT'), 'SMTP')).toMatch(/time/i);
    expect(sanitizeProviderError(new Error('socket timeout'), 'SMTP')).toMatch(/time/i);
  });

  it('classifies quota and rate limits', () => {
    expect(sanitizeProviderError(new Error('quota exceeded'), 'Twilio')).toMatch(/quota|limit/i);
    expect(sanitizeProviderError(new Error('throttled'), 'Twilio')).toMatch(/quota|limit/i);
  });

  it('falls back to a generic message that still names the provider', () => {
    const out = sanitizeProviderError(new Error('something entirely novel'), 'SendGrid');
    expect(out).toContain('SendGrid');
    expect(out).toMatch(/see server logs/i);
    expect(out).not.toContain('novel');
  });

  it('handles non-Error throwables without throwing', () => {
    for (const thrown of [null, undefined, 42, { weird: true }, 'plain string']) {
      expect(() => sanitizeProviderError(thrown, 'Twilio')).not.toThrow();
      expect(sanitizeProviderError(thrown, 'Twilio')).toContain('Twilio');
    }
  });

  it('is deterministic', () => {
    const e = new Error('Invalid credentials');
    expect(sanitizeProviderError(e, 'AWS')).toBe(sanitizeProviderError(e, 'AWS'));
  });
});
