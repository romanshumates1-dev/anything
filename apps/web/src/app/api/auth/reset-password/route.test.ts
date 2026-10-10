/**
 * POST /api/auth/reset-password — token-consumption security contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This is the other half of the account-takeover surface: it consumes a reset
 * token and sets a new password. The failure modes are the dangerous ones:
 *   - accepting an INVALID token (anyone resets any account),
 *   - accepting a REUSED token (a stale link stays live forever),
 *   - accepting an EXPIRED token,
 *   - NOT deleting the user's sessions after a reset (a hijacked session
 *     survives the very action meant to evict the attacker).
 *
 * The handler avoids all of these (hash-compares the token, rejects missing /
 * used / expired, and DELETEs sessions on success). None of it was pinned. These
 * tests lock the contract so a future refactor cannot silently open a takeover.
 *
 * WHAT IS ASSERTED
 * 1. 400 on malformed JSON, missing token, and too-short password.
 * 2. Rate-limited (brute-force) -> 429.
 * 3. Unknown token hash -> 400.
 * 4. Already-used token -> 400 (replay rejected).
 * 5. Expired token -> 400.
 * 6. Valid token -> updates the password, marks the token used, and DELETES the
 *    user's sessions (evicts any hijacked session).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { rateLimitByUser } = vi.hoisted(() => ({ rateLimitByUser: vi.fn() }));
vi.mock('@/app/api/utils/rateLimit', () => ({
  rateLimitByUser: (...a: any[]) => rateLimitByUser(...a),
}));

const { getClientIp } = vi.hoisted(() => ({ getClientIp: vi.fn() }));
vi.mock('@/app/api/utils/clientIp', () => ({ getClientIp: (...a: any[]) => getClientIp(...a) }));

const { hashPassword } = vi.hoisted(() => ({ hashPassword: vi.fn() }));
vi.mock('better-auth/crypto', () => ({ hashPassword: (...a: any[]) => hashPassword(...a) }));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://t/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getClientIp.mockReturnValue('203.0.113.7');
  rateLimitByUser.mockResolvedValue({ allowed: true, remaining: 4 });
  hashPassword.mockResolvedValue('hashed::new-password');
});

describe('POST /api/auth/reset-password — validation', () => {
  it('400s on malformed JSON', async () => {
    const bad = new Request('http://t/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    }) as any;
    expect((await POST(bad)).status).toBe(400);
  });

  it('400s when the token is missing', async () => {
    expect((await POST(req({ password: 'longenough1' }))).status).toBe(400);
  });

  it('400s when the password is too short', async () => {
    expect((await POST(req({ token: 'abc', password: 'short' }))).status).toBe(400);
  });

  it('429s when rate limited (brute-force protection)', async () => {
    rateLimitByUser.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await POST(req({ token: 'abc', password: 'longenough1' }));
    expect(res.status).toBe(429);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/reset-password — token rejection', () => {
  it('400s on an unknown token hash', async () => {
    mockSql.mockResolvedValueOnce([]); // no matching token
    const res = await POST(req({ token: 'deadbeef', password: 'longenough1' }));
    expect(res.status).toBe(400);
    // No password update / session delete happened.
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('400s on an ALREADY-USED token (replay rejected)', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 't1', user_id: 'u1', expires_at: new Date(Date.now() + 3600_000), used_at: new Date() },
    ]);
    const res = await POST(req({ token: 'usedtoken', password: 'longenough1' }));
    expect(res.status).toBe(400);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('400s on an EXPIRED token', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 't1', user_id: 'u1', expires_at: new Date(Date.now() - 3600_000), used_at: null },
    ]);
    const res = await POST(req({ token: 'expiredtoken', password: 'longenough1' }));
    expect(res.status).toBe(400);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/auth/reset-password — happy path', () => {
  it('sets the password, marks the token used, and DELETES sessions', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 't1', user_id: 'u1', expires_at: new Date(Date.now() + 3600_000), used_at: null },
    ]); // token lookup
    mockSql.mockResolvedValue([]); // password UPDATE, token UPDATE, session DELETE

    const res = await POST(req({ token: 'validtoken', password: 'longenough1' }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Three follow-up writes: update password, mark token used, delete sessions.
    expect(mockSql).toHaveBeenCalledTimes(4);
    expect(hashPassword).toHaveBeenCalledWith('longenough1');
    const writes = mockSql.mock.calls.slice(1).map((c: any[]) => String(c[0]?.join(' ') ?? ''));
    expect(writes.some((w: string) => /UPDATE\s+"user"/i.test(w))).toBe(true);
    expect(writes.some((w: string) => /UPDATE\s+password_reset_tokens/i.test(w))).toBe(true);
    expect(writes.some((w: string) => /DELETE\s+FROM\s+session/i.test(w))).toBe(true);
  });
});
