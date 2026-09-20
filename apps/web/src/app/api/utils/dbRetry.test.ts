/**
 * Bounded retry helper for transient database failures.
 *
 * ROOT CAUSE (random sign-outs): better-auth session reads, the middleware
 * session lookup, and route-level queries all run over a single Neon
 * WebSocket connection. A transient connection error (cold-start socket
 * reset, pool exhaustion, admin restart) surfaces as a thrown error — for
 * session reads that becomes a 401, which the client interprets as
 * "signed out". The fix is a strictly bounded retry (2 attempts) that only
 * fires for connection-class errors, never for query logic errors
 * (syntax, unique violations, etc.), and never for transactions.
 */
import { describe, it, expect, vi } from 'vitest';

import { isTransientDbError, runWithDbRetry } from './dbRetry';

describe('isTransientDbError', () => {
  it('classifies connection-class errors as transient', () => {
    expect(isTransientDbError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDbError(new Error('ECONNRESET'))).toBe(true);
    expect(isTransientDbError(new Error('read ECONNREFUSED'))).toBe(true);
    expect(isTransientDbError(new Error('terminating connection due to administrator command'))).toBe(true);
    expect(isTransientDbError(new Error('sorry, too many clients already'))).toBe(true);
    expect(isTransientDbError(new Error('fetch failed'))).toBe(true);
    expect(isTransientDbError(new Error('WebSocket connection was closed unexpectedly'))).toBe(true);
  });

  it('classifies query logic errors as NOT transient', () => {
    expect(isTransientDbError(new Error('syntax error at or near "SELEC"'))).toBe(false);
    expect(isTransientDbError(new Error('duplicate key value violates unique constraint "users_email_unique"'))).toBe(false);
    expect(isTransientDbError(new Error('relation "nope" does not exist'))).toBe(false);
    expect(isTransientDbError(new Error('permission denied for table users'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
  });
});

describe('runWithDbRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(runWithDbRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once on a transient error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValueOnce('recovered');

    await expect(runWithDbRetry(fn)).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the bounded attempts and rethrows the transient error', async () => {
    const err = new Error('ECONNRESET');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(runWithDbRetry(fn, { attempts: 2 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('never retries non-transient (query logic) errors', async () => {
    const err = new Error('syntax error at or near "SELEC"');
    const fn = vi.fn().mockRejectedValue(err);

    await expect(runWithDbRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments through to the wrapped call', async () => {
    const fn = vi.fn(async (a: number, b: number) => a + b);
    await expect(runWithDbRetry(() => fn(2, 3))).resolves.toBe(5);
  });
});
