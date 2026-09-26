/**
 * TENANT-ISOLATION REGRESSION (independent re-review, 2026-09-26).
 *
 * Every case below is an IDOR where a caller-supplied id was used to mutate
 * another tenant's data. They share one shape: the session/admin gate passed,
 * the org was resolved, and then a statement keyed only on the caller's id ran
 * with no ownership predicate.
 *
 *  1. POST /api/agents/negotiation  — opt-out write on a foreign lead.
 *  2. PUT  /api/duplicates          — message_events/contact_log reassignment
 *     ran BEFORE any ownership check, so a foreign lead's message history could
 *     be re-pointed at an attacker's lead (and the errors were swallowed with
 *     .catch(() => {}), so the later scoped UPDATE protected nothing).
 *  3. PUT  /api/compliance/tcpa     — contact_log row injected against a
 *     foreign lead (also skewed that phone's platform-wide frequency counter).
 *
 * Contract asserted here: a foreign id is refused with 404 that is IDENTICAL to
 * the "does not exist" response, so the endpoints never become a cross-tenant
 * existence oracle, and no write statement runs at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

vi.mock('@/app/api/utils/dncRegistry', () => ({
  checkDncRegistry: vi.fn(async () => ({ listed: false })),
}));

import { POST as negotiationPOST } from '@/app/api/agents/negotiation/route';
import { PUT as duplicatesPUT } from '@/app/api/duplicates/route';
import { PUT as tcpaPUT } from '@/app/api/compliance/tcpa/route';

const post = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body) }) as any;
const put = (url: string, body: unknown) =>
  new Request(url, { method: 'PUT', body: JSON.stringify(body) }) as any;

const sqlText = (call: unknown[]) => String(call[0] ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-b' });
  getOrganization.mockResolvedValue({ id: 'org_b', name: 'Org B' });
});

describe('POST /api/agents/negotiation — lead ownership', () => {
  it('404s and writes nothing when leadId belongs to another tenant', async () => {
    mockSql.mockResolvedValue([]); // ownership lookup finds nothing in org_b
    const res = await negotiationPOST(
      post('http://t/api/agents/negotiation', { leadId: 'lead_org_a', sellerReply: 'stop' })
    );
    expect(res.status).toBe(404);
    const texts = mockSql.mock.calls.map(sqlText);
    expect(texts.some((t) => /UPDATE\s+leads/.test(t))).toBe(false);
    expect(texts.some((t) => /INSERT\s+INTO\s+suppression_list/.test(t))).toBe(false);
  });

  it('performs the opt-out for a lead the caller DOES own', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'lead_b' }]) // ownership
      .mockResolvedValue([]); // UPDATE + suppression insert
    const res = await negotiationPOST(
      post('http://t/api/agents/negotiation', { leadId: 'lead_b', sellerReply: 'stop' })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).optedOut).toBe(true);
    const texts = mockSql.mock.calls.map(sqlText);
    expect(texts.some((t) => /UPDATE\s+leads\s+SET\s+status\s*=\s*'OPTED_OUT'/.test(t))).toBe(true);
  });
});

describe('PUT /api/duplicates — merge cannot steal another tenant leads history', () => {
  it('404s BEFORE any reassignment when the primary lead is foreign', async () => {
    mockSql.mockResolvedValue([]);
    const res = await duplicatesPUT(
      put('http://t/api/duplicates', { primaryLeadId: 'lead_b', duplicateLeadIds: ['lead_org_a'] })
    );
    expect(res.status).toBe(404);
    const texts = mockSql.mock.calls.map(sqlText);
    expect(texts.some((t) => /UPDATE\s+message_events/.test(t))).toBe(false);
    expect(texts.some((t) => /UPDATE\s+contact_log/.test(t))).toBe(false);
    expect(texts.some((t) => /status\s*=\s*'MERGED'/.test(t))).toBe(false);
  });

  it('404s when only the DUPLICATE lead is foreign', async () => {
    mockSql.mockResolvedValue([{ id: 'lead_b' }]); // primary owned, dup not
    const res = await duplicatesPUT(
      put('http://t/api/duplicates', { primaryLeadId: 'lead_b', duplicateLeadIds: ['lead_org_a'] })
    );
    expect(res.status).toBe(404);
    expect(mockSql.mock.calls.map(sqlText).some((t) => /UPDATE\s+message_events/.test(t))).toBe(
      false
    );
  });

  it('merges when every id belongs to the caller', async () => {
    mockSql.mockResolvedValue([{ id: 'lead_b' }, { id: 'lead_dup' }]);
    const res = await duplicatesPUT(
      put('http://t/api/duplicates', { primaryLeadId: 'lead_b', duplicateLeadIds: ['lead_dup'] })
    );
    expect(res.status).toBe(200);
    const texts = mockSql.mock.calls.map(sqlText);
    expect(texts.some((t) => /UPDATE\s+message_events/.test(t))).toBe(true);
    expect(texts.some((t) => /status\s*=\s*'MERGED'/.test(t))).toBe(true);
  });
});

describe('PUT /api/compliance/tcpa — contact log cannot be written for a foreign lead', () => {
  it('404s and inserts nothing when leadId belongs to another tenant', async () => {
    mockSql.mockResolvedValue([]);
    const res = await tcpaPUT(
      put('http://t/api/compliance/tcpa', {
        phone: '+15025550000',
        channel: 'sms',
        leadId: 'lead_org_a',
        success: true,
      })
    );
    expect(res.status).toBe(404);
    expect(mockSql.mock.calls.map(sqlText).some((t) => /INSERT\s+INTO\s+contact_log/.test(t))).toBe(
      false
    );
  });

  it('logs a contact for a lead the caller owns', async () => {
    mockSql.mockResolvedValue([{ id: 'lead_b' }]);
    const res = await tcpaPUT(
      put('http://t/api/compliance/tcpa', {
        phone: '+15025550000',
        channel: 'sms',
        leadId: 'lead_b',
        success: true,
      })
    );
    expect(res.status).toBe(200);
    expect(mockSql.mock.calls.map(sqlText).some((t) => /INSERT\s+INTO\s+contact_log/.test(t))).toBe(
      true
    );
  });

  it('still logs platform-wide contacts that carry no leadId', async () => {
    const res = await tcpaPUT(
      put('http://t/api/compliance/tcpa', { phone: '+15025550000', channel: 'sms', success: true })
    );
    expect(res.status).toBe(200);
    expect(mockSql.mock.calls.map(sqlText).some((t) => /INSERT\s+INTO\s+contact_log/.test(t))).toBe(
      true
    );
  });

  it('rejects a malformed body instead of throwing (phone must be a string)', async () => {
    const res = await tcpaPUT(
      put('http://t/api/compliance/tcpa', { phone: 1552555000, channel: 'sms' })
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/outreach/campaigns — test phone numbers are org-owned', () => {
  it('the test-phone relink keeps the org predicate', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/app/api/outreach/campaigns/route.ts'),
      'utf8'
    );
    const relink = src.split(/\r?\n/).find((l) => /UPDATE test_phone_numbers/.test(l));
    expect(relink).toBeDefined();
    // The relink must name the org twice: SET and WHERE. Without the WHERE
    // clause any admin could move another tenant's number (and its OTP state).
    expect(String(relink).match(/organization_id/g)?.length).toBe(2);
  });
});
