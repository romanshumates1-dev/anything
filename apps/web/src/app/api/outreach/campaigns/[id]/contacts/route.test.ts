/**
 * Bug #36 — two distinct defects in this route:
 *  1. Synchronous `params.id` against a Promise-shaped params object always
 *     resolved to `undefined` (same class as pause/resume/stats/cancel).
 *  2. The batch INSERT built its placeholder numbers from `idx * 4`, but each
 *     row binds 5 args -> every row past the first re-used placeholder
 *     numbers already claimed by the previous row, corrupting which column
 *     each bound value actually lands in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = vi.fn(async () => []);
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent }));

// Bypass real text parsing — this test targets the SQL-building logic, not
// the parser. The route receives already-"parsed" contacts via a JSON body.
vi.mock('@/app/api/utils/contactImport', () => ({
  parseContactList: vi.fn((text: string) => JSON.parse(text)),
  dedupeContacts: vi.fn((contacts: any[]) => contacts),
}));

import { POST } from './route';

const CONTACTS = [
  { name: 'Alice', phone: '+15551110001', valid: true },
  { name: 'Bob', phone: '+15551110002', valid: true },
  { name: 'Carol', phone: '+15551110003', valid: true },
];

function req(contacts = CONTACTS) {
  return new Request('http://t/api/outreach/campaigns/camp-1/contacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: JSON.stringify(contacts) }),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/outreach/campaigns/[id]/contacts', () => {
  it('resolves campaignId from the awaited params (DRAFT campaign found, not 404)', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'DRAFT' }]) // lookup
      .mockResolvedValueOnce([{ total: 3 }]); // count after insert

    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(200);

    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('camp-1');
  });

  it('binds each row to its OWN 5 placeholders — no cross-row overlap', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'DRAFT' }])
      .mockResolvedValueOnce([{ total: 3 }]);

    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(3);

    expect(mockSql.query).toHaveBeenCalledTimes(1);
    const [paramSql, args] = (mockSql.query as any).mock.calls[0];

    // 3 rows * 5 bound columns each (id, campaign_id, organization_id, name, phone)
    expect(args.length).toBe(15);

    // Placeholder numbers in the generated SQL must be a contiguous, unique
    // 1..15 run — the pre-fix `idx*4` base produced $5 in BOTH row 0 (never,
    // since row 0's base=0) and row 1 (base=4 -> $5..$9), reusing $5/$6/$7/$8.
    const placeholderNumbers = [...paramSql.matchAll(/\$(\d+)/g)].map((m: any) => Number(m[1]));
    const unique = new Set(placeholderNumbers);
    expect(unique.size).toBe(15);
    expect(Math.max(...placeholderNumbers)).toBe(15);

    // Each row's own (campaignId, organizationId, name, phone) must land at
    // its own base — this is what the bug corrupted for every row past #0.
    CONTACTS.forEach((c, idx) => {
      const base = idx * 5;
      expect(args[base + 1]).toBe('camp-1');
      expect(args[base + 2]).toBe('org-1');
      expect(args[base + 3]).toBe(c.name);
      expect(args[base + 4]).toBe(c.phone);
    });
  });

  it('404s when the campaign does not exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'missing' }) } as any);
    expect(res.status).toBe(404);
  });

  it('400s when trying to import into a non-DRAFT campaign', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'ACTIVE' }]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(400);
  });
});
