/**
 * /api/admin/subscriptions — admin subscription management contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * PATCH here changes ANY tenant's subscription status and plan — i.e. it can
 * grant or revoke entitlements across the whole product. It is gated only by
 * requireAdmin(). If that gate failed open, any authenticated user could
 * promote their own org to a paid plan. It had NO route test.
 *
 * The handler is correct today (admin-gated on both verbs, validates planId
 * exists before applying, rejects an empty update). These tests pin that.
 *
 * WHAT IS ASSERTED
 * 1. GET 403s a non-admin and runs NO query.
 * 2. GET 200s with the subscription list for an admin.
 * 3. PATCH 403s a non-admin.
 * 4. PATCH 400s with no id.
 * 5. PATCH 400s on an invalid planId (plan must exist) and applies NO update.
 * 6. PATCH 400s when neither planId nor status is provided.
 * 7. PATCH applies a valid status update and logs the admin action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin: (...a: any[]) => requireAdmin(...a) }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

import { GET, PATCH } from './route';

const ADMIN = { ok: true, userId: 'admin-1', email: 'a@x.io' };
const DENY = { ok: false, response: Response.json({ error: 'Forbidden: admin role required' }, { status: 403 }) };

function patchReq(id: string | null, body: unknown) {
  const url = id ? `http://t/api/admin/subscriptions?id=${id}` : 'http://t/api/admin/subscriptions';
  return new Request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  logEvent.mockResolvedValue(undefined);
  mockSql.mockResolvedValue([]);
});

describe('GET /api/admin/subscriptions', () => {
  it('403s a non-admin and runs NO query', async () => {
    requireAdmin.mockResolvedValue(DENY);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('200s with the subscription list for an admin', async () => {
    mockSql.mockResolvedValueOnce([{ id: 's1', organization_name: 'Acme', plan_name: 'Pro', tier: 'pro' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });
});

describe('PATCH /api/admin/subscriptions', () => {
  it('403s a non-admin', async () => {
    requireAdmin.mockResolvedValue(DENY);
    expect((await PATCH(patchReq('s1', { status: 'active' }))).status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('400s with no subscription id', async () => {
    expect((await PATCH(patchReq(null, { status: 'active' }))).status).toBe(400);
  });

  it('400s on an invalid planId and applies NO update', async () => {
    mockSql.mockResolvedValueOnce([]); // plan lookup -> not found
    const res = await PATCH(patchReq('s1', { planId: 'plan-nope' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid plan/i);
    // Only the plan-existence lookup ran; no UPDATE.
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('400s when neither planId nor status is provided', async () => {
    const res = await PATCH(patchReq('s1', {}));
    expect(res.status).toBe(400);
  });

  it('applies a valid status update and logs the admin action', async () => {
    mockSql.mockResolvedValue([]); // UPDATE
    const res = await PATCH(patchReq('s1', { status: 'canceled' }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      'admin_subscription_updated',
      'subscription',
      's1',
      expect.objectContaining({ updatedBy: 'admin-1' }),
    );
  });
});
