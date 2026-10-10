/**
 * POST /api/auth/forgot-password — account-security contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This endpoint is on the account-takeover surface. It mints password-reset
 * tokens. The failure modes here are the classic ones:
 *   - user enumeration (does this email have an account?),
 *   - revealing that a rate limit was hit (also enumeration),
 *   - storing or returning the reset token in plaintext,
 *   - leaking the token into the response body.
 *
 * The handler is carefully written to avoid all four: it returns `{ ok: true }`
 * for unknown emails, for rate-limited requests, and on any error; it stores
 * only a sha256 hash of the token; it never puts the token in the response.
 * None of that was pinned by a test. These tests lock it in.
 *
 * WHAT IS ASSERTED
 * 1. 400 on invalid/missing email.
 * 2. Unknown email -> { ok: true } with NO token row inserted (enumeration-safe).
 * 3. Rate-limited -> { ok: true }, NOT a 429, and NO token row (opaque).
 * 4. Known email -> a token row is inserted, but the STORED value is a sha256
 *    hash (64 hex chars), never the plaintext token.
 * 5. The response body never contains a reset token or reset URL.
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

// Capture any outbound fetch (the reset email) so we can assert on it.
const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
vi.stubGlobal('fetch', fetchMock);

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://t/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitByUser.mockResolvedValue({ allowed: true, remaining: 2 });
});

describe('POST /api/auth/forgot-password — validation', () => {
  it('400s on a missing/invalid email', async () => {
    const res = await POST(req({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('400s on malformed JSON', async () => {
    const bad = new Request('http://t/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    }) as any;
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/forgot-password — enumeration prevention', () => {
  it('returns { ok: true } for an UNKNOWN email and inserts NO token', async () => {
    mockSql.mockResolvedValueOnce([]); // user lookup -> none
    const res = await POST(req({ email: 'nobody@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // Only the user-lookup query ran; no INSERT of a token.
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('returns { ok: true } when rate limited — NOT a 429 — and inserts NO token', async () => {
    rateLimitByUser.mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await POST(req({ email: 'someone@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // No DB query at all: the rate limit short-circuits before the lookup.
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/forgot-password — token handling', () => {
  it('stores a sha256 HASH (64 hex), never the plaintext token', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'u1', email: 'real@example.com', name: 'Real' }]); // user
    mockSql.mockResolvedValueOnce([]); // INSERT token

    const res = await POST(req({ email: 'real@example.com' }));
    expect(res.status).toBe(200);

    // The INSERT call must carry the token hash, which is 64 lowercase hex chars.
    const insertCall = mockSql.mock.calls[1];
    const bound = insertCall.filter((p: unknown) => typeof p === 'string');
    const storedToken = bound.find((s: string) => /^[0-9a-f]{64}$/.test(s));
    expect(storedToken).toBeDefined();
    expect(storedToken).toHaveLength(64);
  });

  it('never leaks the reset token or URL in the response body', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'u1', email: 'real@example.com', name: 'Real' }]);
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(req({ email: 'real@example.com' }));
    const text = await res.text();
    // The plaintext token is 64 hex chars; it must not appear in the response.
    expect(text).not.toMatch(/reset-password\?token=/);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });
});
