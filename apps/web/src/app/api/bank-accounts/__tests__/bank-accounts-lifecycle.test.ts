/**
 * Bank Account Management — set default, micro-deposit verify, delete.
 *
 * Companion to bank-accounts.test.ts (list + add). Covers the per-account
 * lifecycle routes and the two invariants that matter most for money safety:
 *
 *  1. CROSS-TENANT IS 404, NEVER 403. Returning 403 would confirm the id
 *     exists in another org, giving an attacker a free id oracle.
 *  2. Verification is attempt-limited so micro-deposit amounts cannot be
 *     brute-forced (the amount space is tiny: two values under $1.00).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: any[]) => getSession(...a) } },
}));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

import { POST as setDefault } from '../[id]/default/route';
import { POST as verify } from '../[id]/verify/route';
import { DELETE as remove } from '../[id]/route';
import { encryptSensitive } from '@/app/api/utils/encryption';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  mockSql.mockImplementation(async () => []);
  getSession.mockResolvedValue({ user: { id: 'user-123', email: 'u@example.com' } });
  getOrganization.mockResolvedValue({ id: 'org-456', name: 'Test Org' });
});

function req(body?: unknown, method = 'POST'): Request {
  return new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) } as any);

const row = (over: Record<string, any> = {}) => ({
  id: 'ba_abc123',
  user_id: 'user-123',
  organization_id: 'org-456',
  bank_name: 'Chase',
  account_type: 'checking',
  last_four: '6789',
  verified: false,
  verified_at: null,
  is_default: false,
  verification_attempts: 0,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});


describe('POST /api/bank-accounts/[id]/default', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await setDefault(req({}), params('ba_1'));
    expect(res.status).toBe(401);
  });

  it('404 for a non-existent account', async () => {
    mockSql.mockResolvedValue([]);
    const res = await setDefault(req({}), params('ba_missing'));
    expect(res.status).toBe(404);
  });

  it('404 (not 403) for an account owned by another tenant — no existence oracle', async () => {
    mockSql.mockResolvedValue([]);
    const res = await setDefault(req({}), params('ba_other'));
    expect(res.status).toBe(404);
    expect(await res.text()).not.toMatch(/forbidden|organization/i);
  });

  it('200 sets the account default and clears the previous default', async () => {
    mockSql.mockResolvedValue([row()]);
    const res = await setDefault(req({}), params('ba_abc123'));
    expect(res.status).toBe(200);

    const calls = mockSql.mock.calls.map((c: any[]) => String(c[0]));
    // 1) ownership probe, 2) clear the old default, 3) promote this one.
    expect(calls.some((q: string) => q.includes('SET is_default = false'))).toBe(true);
    expect(calls.some((q: string) => q.includes('SET is_default = true'))).toBe(true);
  });

  it('404 when the row disappears between the probe and the update', async () => {
    // Ownership probe finds it, but the UPDATE returns nothing (concurrent
    // delete / tenant change). Must fail closed, not return a phantom account.
    mockSql.mockResolvedValueOnce([row()]).mockResolvedValue([]).mockResolvedValue([]);
    const res = await setDefault(req({}), params('ba_abc123'));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/bank-accounts/[id]/verify', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await verify(req({ method: 'micro_deposit' }), params('ba_1'));
    expect(res.status).toBe(401);
  });

  it('404 for a non-existent account', async () => {
    mockSql.mockResolvedValue([]);
    const res = await verify(req({ method: 'micro_deposit' }), params('ba_missing'));
    expect(res.status).toBe(404);
  });

  it('400 when the account is already verified', async () => {
    mockSql.mockResolvedValue([row({ verified: true })]);
    const res = await verify(req({ method: 'micro_deposit' }), params('ba_1'));
    expect(res.status).toBe(400);
  });

  it('200 initiates micro-deposit verification without disclosing the amounts', async () => {
    mockSql.mockResolvedValue([row()]);
    const res = await verify(req({ method: 'micro_deposit' }), params('ba_1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('pending');
    expect(data.expected_days).toBe(2);
    expect(JSON.stringify(data)).not.toMatch(/"amounts"\s*:/i);
  });

  it('200 completes verification when both amounts match', async () => {
    // Real crypto round-trip: store amounts as they would be at rest, then
    // submit those same amounts back. A mock fiction here would not prove
    // that encrypt -> store -> decrypt -> compare actually works.
    const stored = row({ verification_amounts_encrypted: encryptSensitive(JSON.stringify([32, 45])) });
    mockSql.mockResolvedValue([stored]);
    const res = await verify(req({ verification_id: 'ver_1', amounts: [32, 45] }), params('ba_1'));
    expect(res.status).toBe(200);
    expect((await res.json()).verified).toBe(true);
  });

  it('400 for incorrect micro-deposit amounts', async () => {
    const stored = row({ verification_amounts_encrypted: encryptSensitive(JSON.stringify([32, 45])) });
    mockSql.mockResolvedValue([stored]);
    const res = await verify(req({ verification_id: 'ver_1', amounts: [1, 2] }), params('ba_1'));
    expect(res.status).toBe(400);
  });

  it('rejects an attempt list of the wrong length', async () => {
    const stored = row({ verification_amounts_encrypted: encryptSensitive(JSON.stringify([32, 45])) });
    mockSql.mockResolvedValue([stored]);
    const res = await verify(req({ verification_id: 'ver_1', amounts: [32] }), params('ba_1'));
    expect(res.status).toBe(400);
  });

  it('429 after too many failed verification attempts', async () => {
    mockSql.mockResolvedValue([row({ verification_attempts: 99 })]);
    const res = await verify(req({ method: 'micro_deposit' }), params('ba_1'));
    expect(res.status).toBe(429);
  });

  it('initiating a NEW verification does not reset the failed-attempt counter', async () => {
    // REGRESSION (found in final adversarial review, 2026-09-26).
    //
    // The initiate branch used to write `verification_attempts = 0`. The cap
    // check reads that same column, so the sequence
    //     initiate -> wrong guess -> initiate -> wrong guess -> ...
    // zeroed the counter every time and let an attacker guess forever, which
    // defeats MAX_VERIFICATION_ATTEMPTS completely. The amount space is two
    // values in 1..99, i.e. 9,801 pairs, so unbounded retries make brute force
    // trivial. The pre-existing 429 test never caught this because it only ever
    // incremented the counter and never re-initiated.
    mockSql.mockResolvedValue([row({ verification_attempts: 4 })]);
    const res = await verify(req({ method: 'micro_deposit' }), params('ba_1'));
    expect(res.status).toBe(200);

    const statements = mockSql.mock.calls.map((c) => (c[0] as string[]).join(' '));
    const initiateUpdate = statements.find(
      (s) => /UPDATE\s+bank_accounts/i.test(s) && /verification_amounts_encrypted/i.test(s)
    );
    expect(initiateUpdate).toBeDefined();
    expect(initiateUpdate).not.toMatch(/verification_attempts\s*=\s*0/i);
  });
});

describe('DELETE /api/bank-accounts/[id]', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await remove(req(undefined, 'DELETE'), params('ba_1'));
    expect(res.status).toBe(401);
  });

  it('404 for a non-existent account', async () => {
    mockSql.mockResolvedValue([]);
    const res = await remove(req(undefined, 'DELETE'), params('ba_missing'));
    expect(res.status).toBe(404);
  });

  it('404 (not 403) for an account owned by another tenant', async () => {
    mockSql.mockResolvedValue([]);
    const res = await remove(req(undefined, 'DELETE'), params('ba_other'));
    expect(res.status).toBe(404);
  });

  it('400 when the account has pending withdrawals', async () => {
    mockSql.mockResolvedValueOnce([row()]).mockResolvedValueOnce([{ count: '1' }]);
    const res = await remove(req(undefined, 'DELETE'), params('ba_1'));
    expect(res.status).toBe(400);
  });

  it('200 deletes a non-default account', async () => {
    mockSql.mockResolvedValue([row()]);
    const res = await remove(req(undefined, 'DELETE'), params('ba_1'));
    expect(res.status).toBe(200);
  });
});
