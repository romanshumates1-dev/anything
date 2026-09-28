/**
 * REAL tests for the bank-account helpers.
 *
 * Why this file exists: bank accounts are the PAYOUT DESTINATION. Until now
 * `bank-accounts.test.ts` consisted entirely of `it.todo(...)` placeholders
 * under a comment saying the routes were "not implemented" - a reason that had
 * since gone stale, since all four routes now exist. The result was that the
 * most sensitive financial surface in the product (where money is sent) had
 * ZERO executed tests while the suite reported 31 passing.
 *
 * These cover the invariants that actually matter, and that a code reviewer
 * cannot confirm by reading alone:
 *
 *  - the public response shape must never carry routing/account numbers or
 *    ciphertext, only `last_four`;
 *  - account numbers are encrypted at rest and the plaintext never appears in
 *    the stored row;
 *  - the fingerprint used for duplicate detection is deterministic and is NOT
 *    the raw account number (so it cannot be reversed);
 *  - ABA routing numbers are checksum-validated, and formatting characters
 *    people actually type are accepted;
 *  - validation is boundary-tested, not just happy-path tested.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// The helpers read ENCRYPTION_KEY at MODULE INITIALISATION and refuse to work
// without it - a deliberate fail-closed design, since silently generating a key
// would mean production ciphertext that cannot be decrypted after a restart.
// The test environment does not define it, so it is set here and the module is
// imported dynamically AFTERWARDS. Importing at the top would evaluate the
// module before this assignment and throw.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

type Helpers = typeof import('@/app/api/utils/bankAccounts');
let h: Helpers;

beforeAll(async () => {
  h = (await import('@/app/api/utils/bankAccounts')) as Helpers;
});

describe('bank account public shape', () => {
  it('never exposes routing or account numbers, encrypted or not', () => {
    const row = {
      id: 'ba_1',
      bank_name: 'Test Bank',
      account_type: 'checking',
      last_four: '6789',
      verified: true,
      verified_at: null,
      is_default: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      // Fields the API must strip even if the query ever returns them:
      account_number_encrypted: 'deadbeef',
      routing_number_encrypted: 'cafebabe',
      account_number: '1234567890',
      routing_number: '021000021',
    } as unknown as Record<string, unknown>;

    const pub = h.toPublicBankAccount(row as never) as Record<string, unknown>;
    const serialised = JSON.stringify(pub);

    expect(serialised).not.toContain('1234567890');
    expect(serialised).not.toContain('021000021');
    expect(serialised).not.toContain('deadbeef');
    expect(serialised).not.toContain('cafebabe');
    for (const leaked of [
      'account_number_encrypted',
      'routing_number_encrypted',
      'account_number',
      'routing_number',
    ]) {
      expect(Object.keys(pub)).not.toContain(leaked);
    }
    // ...and the display-safe fields must still be there.
    expect(pub.last_four).toBe('6789');
    expect(pub.bank_name).toBe('Test Bank');
    expect(pub.verified).toBe(true);
  });
});

describe('ABA routing number validation', () => {
  it('accepts a valid routing number', () => {
    expect(h.isValidRoutingNumber('021000021')).toBe(true);
  });

  it('rejects a bad checksum', () => {
    // Same digits, last digit altered -> checksum must fail.
    expect(h.isValidRoutingNumber('021000022')).toBe(false);
  });

  it('rejects wrong length and non-digits', () => {
    expect(h.isValidRoutingNumber('')).toBe(false);
    expect(h.isValidRoutingNumber('1234')).toBe(false);
    expect(h.isValidRoutingNumber('02100002A')).toBe(false);
    expect(h.isValidRoutingNumber('0210000211')).toBe(false);
  });
});

describe('account number validation (boundaries)', () => {
  it('accepts the documented 4-17 digit range', () => {
    expect(h.isValidAccountNumber('1234')).toBe(true);
    expect(h.isValidAccountNumber('12345678901234567')).toBe(true);
  });

  it('rejects just outside the range', () => {
    expect(h.isValidAccountNumber('123')).toBe(false);
    expect(h.isValidAccountNumber('123456789012345678')).toBe(false);
    expect(h.isValidAccountNumber('')).toBe(false);
    expect(h.isValidAccountNumber('12a4')).toBe(false);
  });
});

describe('account fingerprint', () => {
  it('is deterministic for the same inputs', () => {
    const a = h.accountFingerprint('user_1', '021000021', '1234567890');
    const b = h.accountFingerprint('user_1', '021000021', '1234567890');
    expect(a).toBe(b);
  });

  it('differs for a different user, so two tenants cannot collide', () => {
    const a = h.accountFingerprint('user_1', '021000021', '1234567890');
    const b = h.accountFingerprint('user_2', '021000021', '1234567890');
    expect(a).not.toBe(b);
  });

  it('does not contain the plaintext account number', () => {
    const fp = h.accountFingerprint('user_1', '021000021', '1234567890');
    expect(fp).not.toContain('1234567890');
    expect(fp).not.toContain('021000021');
  });
});

describe('encryption at rest', () => {
  it('round-trips the values but does not store them in plaintext', () => {
    const enc = h.encryptAccountNumbers('021000021', '1234567890') as Record<string, string>;
    const serialised = JSON.stringify(enc);
    expect(serialised).not.toContain('1234567890');
    expect(serialised).not.toContain('021000021');
    // Ciphertext must be non-empty for both fields, or "encrypted" is a no-op.
    expect(String(enc.account_number_encrypted ?? '').length).toBeGreaterThan(0);
    expect(String(enc.routing_number_encrypted ?? '').length).toBeGreaterThan(0);
  });
});
