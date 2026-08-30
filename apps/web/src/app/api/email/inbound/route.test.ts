/**
 * POST /api/email/inbound — an emailed reply enters the SAME conversation
 * thread as SMS, so the AI negotiator handles it identically.
 *
 * This is the "one downstream machine" requirement. The tests assert the
 * convergence directly: the same ai_conversations write, the same requires_human
 * /needs_review state, the same enqueueJob('ai_reply') — not a parallel path
 * that merely looks similar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn(async () => 'job-1') }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob }));

const { registerOptOut } = vi.hoisted(() => ({ registerOptOut: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/compliance', () => ({ registerOptOut }));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import { POST } from './route';

const SECRET = 'test-secret';
const req = (body: unknown) =>
  new Request(`http://t/api/email/inbound?s=${SECRET}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

const LEAD = { id: 42, ai_paused: false, organization_id: 'org_1' };
const CONV = { id: 7, lead_id: 42 };

/** Queue: lead lookup -> conversation upsert -> history append. */
function wireHappyPath(lead: any = LEAD) {
  mockSql
    .mockResolvedValueOnce([lead]) // lead lookup
    .mockResolvedValueOnce([CONV]) // conversation upsert
    .mockResolvedValueOnce([]); // history append
}

let saved: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
  saved = process.env.SMS_INBOUND_SECRET;
  process.env.SMS_INBOUND_SECRET = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.SMS_INBOUND_SECRET;
  else process.env.SMS_INBOUND_SECRET = saved;
});

describe('security gate', () => {
  it('401s without the secret and touches nothing', async () => {
    const res = await POST(
      new Request('http://t/api/email/inbound', {
        method: 'POST',
        body: JSON.stringify({ from: 'a@b.com', text: 'hi' }),
      }) as any
    );
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});

describe('opt-out runs FIRST', () => {
  it('honours an emailed unsubscribe via registerOptOut (fans out cross-channel)', async () => {
    const res = await POST(req({ from: 'Seller@Example.com', text: 'unsubscribe' }));
    expect((await res.json()).status).toBe('opted_out');
    expect(registerOptOut).toHaveBeenCalledWith(
      'seller@example.com', // normalised
      'email',
      expect.objectContaining({ reason: 'email_unsubscribe_reply' })
    );
    // Never threaded, never handed to the negotiator.
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('does NOT opt out on our own quoted STOP footer — the trap this guards', async () => {
    // A genuinely interested reply that quotes our compliant footer back.
    const text = [
      "Yes I'm interested!",
      '',
      'On Mon, Jul 28, 2026 at 9:15 AM DealFlow <a@b.com> wrote:',
      '> Reply STOP to opt out.',
    ].join('\n');
    wireHappyPath();
    const res = await POST(req({ from: 'seller@example.com', text }));
    expect(registerOptOut).not.toHaveBeenCalled();
    expect((await res.json()).status).toBe('recorded');
  });
});

describe('convergence — the same downstream machine as SMS', () => {
  it('appends the reply to ai_conversations and flags it for review', async () => {
    wireHappyPath();
    const res = await POST(req({ from: 'seller@example.com', text: 'What can you offer?' }));
    expect(res.status).toBe(200);

    const queries = mockSql.mock.calls.map((c: any) => (Array.isArray(c[0]) ? c[0].join('?') : ''));
    expect(queries.some((q) => q.includes('INSERT INTO ai_conversations'))).toBe(true);
    const append = queries.find((q) => q.includes('history = history ||'));
    expect(append).toBeTruthy();
    expect(append).toMatch(/requires_human = true/);
    expect(append).toMatch(/status = 'needs_review'/);
  });

  it("stores only the prospect's new text, not the quoted original", async () => {
    wireHappyPath();
    await POST(
      req({
        from: 'seller@example.com',
        text: 'Call me.\n\nOn Mon DealFlow <a@b.com> wrote:\n> our pitch',
      })
    );
    const appendCall = mockSql.mock.calls.find(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('history = history ||')
    );
    const payload = JSON.stringify(appendCall);
    expect(payload).toContain('Call me.');
    expect(payload).not.toContain('our pitch');
  });

  it("enqueues ai_reply — the SAME job the SMS path uses", async () => {
    wireHappyPath();
    const b = await (await POST(req({ from: 'seller@example.com', text: 'interested' }))).json();
    expect(enqueueJob).toHaveBeenCalledWith('ai_reply', { leadId: 42, conversationId: 7 });
    expect(b.aiQueued).toBe(true);
  });

  it('parks the message with NO ai job when the lead is paused (same rule as SMS)', async () => {
    wireHappyPath({ ...LEAD, ai_paused: true });
    const b = await (await POST(req({ from: 'seller@example.com', text: 'interested' }))).json();
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(b.aiQueued).toBe(false);
    expect(b.status).toBe('recorded');
  });
});

describe('non-matching and degenerate input', () => {
  it('ignores a reply from an unknown address without erroring', async () => {
    mockSql.mockResolvedValueOnce([]); // no lead
    const res = await POST(req({ from: 'stranger@example.com', text: 'hello' }));
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe('no_matching_lead');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('does not create a blank turn when the body is only a quote', async () => {
    mockSql.mockResolvedValueOnce([LEAD]);
    const res = await POST(
      req({ from: 'seller@example.com', text: 'On Mon X <a@b.com> wrote:\n> only quote' })
    );
    expect((await res.json()).reason).toBe('empty_after_quote_strip');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('400s without a usable from address', async () => {
    for (const from of [undefined, '', 'not-an-email']) {
      expect((await POST(req({ from, text: 'hi' }))).status).toBe(400);
    }
  });

  it('400s on a non-JSON body', async () => {
    const res = await POST(
      new Request(`http://t/api/email/inbound?s=${SECRET}`, { method: 'POST', body: 'nope' }) as any
    );
    expect(res.status).toBe(400);
  });
});
