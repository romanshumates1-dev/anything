/**
 * POST /api/approvals/[id] — resolve an approval (behavioral).
 * Covers the owner-range money path (write ladder, unblock negotiation, enqueue
 * AI turn), idempotency, reject, the contract path, and — the strictest test —
 * org isolation: an approval from another org is invisible and cannot be acted on.
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
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn(async () => 1) }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/approvals/orr-1', { method: 'POST', body: JSON.stringify(body) }) as any;
const P = (id: string) => ({ params: { id } } as any);

const queryText = (needle: string) =>
  mockSql.mock.calls.some((c: any) => Array.isArray(c[0]) && c[0].join('?').includes(needle));

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u1', organizationId: 'org-1' } });
});

describe('POST /api/approvals/[id] — owner-range accept', () => {
  it('writes the price ladder, unblocks the negotiation, and enqueues the AI turn', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'orr-1', negotiation_id: 'cc-1', direction: 'SELLER', property_context: { ai_min: 100000, ai_max: 120000 }, status: 'PENDING' }]) // SELECT owner_range_requests
      .mockResolvedValueOnce([{ negotiation_id: 'cc-1', direction: 'SELLER' }]) // UPDATE ... ANSWERED (resolved)
      .mockResolvedValueOnce([]) // INSERT negotiation_price_ranges
      .mockResolvedValueOnce([]) // UPDATE campaign_contacts -> NEGOTIATING
      .mockResolvedValueOnce([{ phone: '+15025551234' }]) // SELECT contact phone
      .mockResolvedValueOnce([{ id: 6 }]); // SELECT lead by phone

    const res = await POST(req({ action: 'accept', range: 120000 }), P('orr-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'ANSWERED', negotiationId: 'cc-1', max: 120000 });

    expect(queryText('INSERT INTO negotiation_price_ranges')).toBe(true);
    expect(queryText("SET status = 'NEGOTIATING'")).toBe(true);
    expect(queryText("status = 'AWAITING_OWNER_RANGE'")).toBe(true);
    expect(enqueueJob).toHaveBeenCalledWith('ai_reply', expect.objectContaining({ negotiationId: 'cc-1', leadId: 6 }), expect.objectContaining({ dedupeKey: 'neg_turn_cc-1' }));
  });

  it('is idempotent: a second accept resolves nothing and does NOT re-write or re-enqueue', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'orr-1', negotiation_id: 'cc-1', direction: 'SELLER', property_context: { ai_min: 100000, ai_max: 120000 }, status: 'ANSWERED' }]) // SELECT
      .mockResolvedValueOnce([]); // UPDATE guarded by status='PENDING' -> 0 rows
    const res = await POST(req({ action: 'accept', range: 120000 }), P('orr-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ idempotent: true });
    expect(queryText('INSERT INTO negotiation_price_ranges')).toBe(false);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('rejects an owner-range request without enqueuing anything', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'orr-1', negotiation_id: 'cc-1', direction: 'SELLER', property_context: {}, status: 'PENDING' }])
      .mockResolvedValueOnce([{ id: 'orr-1' }]); // UPDATE EXPIRED
    const res = await POST(req({ action: 'reject' }), P('orr-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'EXPIRED' });
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

describe('POST /api/approvals/[id] — org isolation (money route: strictest)', () => {
  it("cannot act on another org's approval (invisible -> 404), no side effects", async () => {
    // org-1 session, but the id belongs to org-2: both scoped lookups miss.
    mockSql
      .mockResolvedValueOnce([]) // owner_range_requests WHERE org='org-1' -> none
      .mockResolvedValueOnce([]); // human_approvals WHERE org='org-1' -> none
    const res = await POST(req({ action: 'accept', range: 120000 }), P('orr-belongs-to-org-2'));
    expect(res.status).toBe(404);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(queryText('INSERT INTO negotiation_price_ranges')).toBe(false);
    // every lookup was scoped to the caller's org
    expect(mockSql.mock.calls.every((c: any) => c.includes('org-1'))).toBe(true);
  });
});

describe('POST /api/approvals/[id] — contract path', () => {
  it('resolves a human_approvals contract approval', async () => {
    mockSql
      .mockResolvedValueOnce([]) // not an owner_range request
      .mockResolvedValueOnce([{ id: 'ha-1', status: 'PENDING' }]) // human_approvals SELECT
      .mockResolvedValueOnce([{ id: 'ha-1' }]); // UPDATE ANSWERED
    const res = await POST(req({ action: 'accept' }), P('ha-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'ANSWERED' });
  });

  it('400 on an invalid action', async () => {
    const res = await POST(req({ action: 'bogus' }), P('x'));
    expect(res.status).toBe(400);
  });
});
