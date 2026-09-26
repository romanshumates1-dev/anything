import { describe, it, expect } from 'vitest';
import { timingSafeSecretEqual } from './secretCompare';

describe('timingSafeSecretEqual', () => {
  it('accepts an exact match', () => {
    expect(timingSafeSecretEqual('hunter2-secret', 'hunter2-secret')).toBe(true);
  });

  it('accepts long and non-ASCII matches', () => {
    const s = 'x'.repeat(500) + '—µ中文';
    expect(timingSafeSecretEqual(s, s)).toBe(true);
  });

  it('rejects a mismatch of the same length (first byte differs)', () => {
    expect(timingSafeSecretEqual('aaaaaaaa', 'baaaaaaa')).toBe(false);
  });

  it('rejects a mismatch of the same length (last byte differs)', () => {
    expect(timingSafeSecretEqual('aaaaaaaa', 'aaaaaaab')).toBe(false);
  });

  it('rejects a mismatch of different lengths', () => {
    expect(timingSafeSecretEqual('short', 'much-longer-value')).toBe(false);
  });

  it('fails closed when the provided value is missing', () => {
    expect(timingSafeSecretEqual(null, 'secret')).toBe(false);
    expect(timingSafeSecretEqual(undefined, 'secret')).toBe(false);
  });

  it('fails closed when the expected value is missing (unset env secret)', () => {
    expect(timingSafeSecretEqual('secret', null)).toBe(false);
    expect(timingSafeSecretEqual('secret', undefined)).toBe(false);
    expect(timingSafeSecretEqual(null, undefined)).toBe(false);
  });

  it('fails closed on empty strings even when both sides match', () => {
    // An env var set to '' must not authenticate an omitted credential.
    expect(timingSafeSecretEqual('', '')).toBe(false);
    expect(timingSafeSecretEqual('', 'secret')).toBe(false);
    expect(timingSafeSecretEqual('secret', '')).toBe(false);
  });
});
