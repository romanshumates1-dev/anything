/**
 * POST /api/outreach/mail/export — print-ready batch + per-piece tracking rows.
 *
 * Two properties are load-bearing:
 *  1. DRY-RUN by default. Committing burns tracking codes and writes DB rows;
 *     those are side effects, so a forgotten flag must not create them.
 *  2. Tracking-code uniqueness is enforced by the DB (ON CONFLICT), and the
 *     route retries on collision rather than trusting the generator — a piece
 *     shipped without a unique code is unattributable, which defeats the whole
 *     table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/outreach/mail/export', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

const lead = (id: number, addr: string | null, score = 50) => ({
  id,
  name: `Owner ${id}`,
  metadata: { mailing_address: addr, distress_score: score },
  score,
});

const GOOD = '123 Main St, Louisville, KY 40202';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([]);
});

describe('dry run is the default', () => {
  it('persists NOTHING and returns a summary when commit is omitted', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD), lead(2, GOOD)]); // lead query
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.commit).toBe(false);
    expect(b.pieces).toBe(2);
    // Only the SELECT ran — no INSERT into mail_pieces.
    const inserts = mockSql.mock.calls.filter(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('INSERT INTO mail_pieces')
    );
    expect(inserts).toHaveLength(0);
  });

  it('a string "true" does NOT commit — only a literal boolean does', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    const b = await (await POST(req({ commit: 'true' }))).json();
    expect(b.commit).toBe(false);
  });

  it('returns a sample of the CSV in the dry run', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    const b = await (await POST(req({}))).json();
    expect(b.sampleCsv).toContain('tracking_code');
  });
});

describe('commit generates the batch', () => {
  it('writes one mail_pieces row per mailable lead and returns a CSV file', async () => {
    mockSql
      .mockResolvedValueOnce([lead(1, GOOD), lead(2, GOOD)]) // leads
      .mockResolvedValueOnce([{ tracking_code: 'ACDEFG' }]) // insert 1
      .mockResolvedValueOnce([{ tracking_code: 'MNPQRT' }]); // insert 2

    const res = await POST(req({ commit: true, campaignId: 'camp-9' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    expect(res.headers.get('X-Batch-Pieces')).toBe('2');

    const csv = await res.text();
    expect(csv.split('\n')[0]).toContain('tracking_code');
    expect(csv).toContain('ACDEFG');
    expect(csv).toContain('MNPQRT');
  });

  it('RETRIES on a tracking-code collision instead of shipping a codeless piece', async () => {
    mockSql
      .mockResolvedValueOnce([lead(1, GOOD)]) // leads
      .mockResolvedValueOnce([]) // insert attempt 1 -> ON CONFLICT DO NOTHING, no row
      .mockResolvedValueOnce([{ tracking_code: 'MNPQRT' }]); // attempt 2 -> success

    const res = await POST(req({ commit: true }));
    expect(res.status).toBe(200);
    const inserts = mockSql.mock.calls.filter(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('INSERT INTO mail_pieces')
    );
    expect(inserts.length).toBe(2); // one failed, one succeeded
  });

  it('fails LOUD if a unique code cannot be assigned after retries', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    // Every insert attempt conflicts.
    for (let i = 0; i < 5; i++) mockSql.mockResolvedValueOnce([]);
    const res = await POST(req({ commit: true }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('code_generation_failed');
  });
});

describe('selection and mailability', () => {
  it('orders by distress score — mail is reserved for the best odds', async () => {
    mockSql.mockResolvedValueOnce([]);
    await POST(req({}));
    const q = mockSql.mock.calls[0][0].join('?');
    expect(q).toMatch(/ORDER BY score DESC/);
    expect(q).toMatch(/NOT EXISTS[\s\S]*mail_pieces/); // skips already-exported leads
  });

  it('counts unmailable addresses instead of shipping them', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD), lead(2, 'Louisville, KY')]); // 2nd has no street/zip
    const b = await (await POST(req({}))).json();
    expect(b.pieces).toBe(1);
    expect(b.unmailable).toBe(1);
  });

  it('scopes the lead query to the caller org', async () => {
    mockSql.mockResolvedValueOnce([]);
    await POST(req({}));
    expect(mockSql.mock.calls[0]).toContain('org_1');
  });
});

describe('authz', () => {
  it('rejects non-admins and orgless callers', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await POST(req({}))).status).toBe(403);

    requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
    getOrganization.mockResolvedValue(null);
    expect((await POST(req({}))).status).toBe(403);
  });
});
