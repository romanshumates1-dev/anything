/**
 * POST /api/outreach/mail/run — the registration-free dispatch path.
 *
 * The property under most scrutiny is DRY-RUN-BY-DEFAULT. Mail is the only
 * channel where one request converts straight into unrecallable money (~55c a
 * piece the moment a provider accepts it; a 10,000-piece run is $5,500). So an
 * accidental real run is a bill, not an apology — spending must require an
 * explicit literal `false`, and nothing softer may unlock it.
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

const { recordStageTransition } = vi.hoisted(() => ({
  recordStageTransition: vi.fn(async () => {}),
}));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition }));

const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn(async () => ({ status: 'dispatched', provider: 'mock', costCents: 55 }) as any),
}));
vi.mock('@/app/api/utils/mailDriver', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, sendMail };
});

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/outreach/mail/run', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

const lead = (id: number, addr: string | null) => ({
  id,
  name: `Owner ${id}`,
  metadata: { mailing_address: addr },
});

const BASE = {
  body: 'We buy houses. Interested in a cash offer?',
  returnAddress: 'DealFlow AI, 500 W Market St, Louisville, KY 40202',
};

const GOOD = '123 Main St, Louisville, KY 40202';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([]);
  sendMail.mockResolvedValue({ status: 'dispatched', provider: 'mock', costCents: 55 });
});

describe('dry run is the default — money is never spent by accident', () => {
  it('prices the run and sends NOTHING when dryRun is omitted', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD), lead(2, GOOD)]);
    const b = await (await POST(req(BASE))).json();

    expect(b.dryRun).toBe(true);
    expect(b.mailable).toBe(2);
    expect(b.totalCostUsd).toBe(1.1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('treats a STRING "false" as a dry run — a form post must not start billing', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    const b = await (await POST(req({ ...BASE, dryRun: 'false' }))).json();
    expect(b.dryRun).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('treats 0 / null / undefined as a dry run', async () => {
    for (const v of [0, null, undefined]) {
      vi.clearAllMocks();
      mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
      const b = await (await POST(req({ ...BASE, dryRun: v }))).json();
      expect(b.dryRun, `dryRun=${String(v)}`).toBe(true);
      expect(sendMail).not.toHaveBeenCalled();
    }
  });

  it('spends ONLY on a literal false', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    const b = await (await POST(req({ ...BASE, dryRun: false }))).json();
    expect(b.dryRun).toBe(false);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(b.dispatched).toBe(1);
    expect(b.spentUsd).toBe(0.55);
  });
});

describe('estimation', () => {
  it('excludes undeliverable addresses from the bill', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD), lead(2, 'Louisville, KY')]);
    const b = await (await POST(req(BASE))).json();
    expect(b.mailable).toBe(1);
    expect(b.undeliverable).toBe(1);
    expect(b.totalCostUsd).toBe(0.55);
  });

  it('counts leads with no address at all as unresolved, not as spend', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD), lead(2, null)]);
    const b = await (await POST(req(BASE))).json();
    expect(b.candidates).toBe(2);
    expect(b.unresolved).toBe(1);
    expect(b.mailable).toBe(1);
  });

  it('honours a custom unit cost', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    const b = await (await POST(req({ ...BASE, unitCostCents: 70 }))).json();
    expect(b.totalCostUsd).toBe(0.7);
  });
});

describe('real dispatch', () => {
  it('records a CONTACTED transition on the mail channel for each piece sent', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    await POST(req({ ...BASE, dryRun: false }));
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 1, toStage: 'CONTACTED', channel: 'mail' })
    );
  });

  it('counts suppression separately and does not bill it', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    sendMail.mockResolvedValue({ status: 'suppressed', gateCode: 'DNC', reason: 'opted out' });
    const b = await (await POST(req({ ...BASE, dryRun: false }))).json();
    expect(b.suppressed).toBe(1);
    expect(b.dispatched).toBe(0);
    expect(b.spentCents).toBe(0);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });

  it('reports provider failures without counting them as spend', async () => {
    mockSql.mockResolvedValueOnce([lead(1, GOOD)]);
    sendMail.mockResolvedValue({ status: 'failed', errorMessage: 'provider 402' });
    const b = await (await POST(req({ ...BASE, dryRun: false }))).json();
    expect(b.failed).toBe(1);
    expect(b.spentCents).toBe(0);
    expect(b.failures[0]).toMatchObject({ leadId: 1, reason: 'provider 402' });
  });
});

describe('validation and authz', () => {
  it('400s without mail copy', async () => {
    expect((await POST(req({ returnAddress: BASE.returnAddress }))).status).toBe(400);
  });

  it('400s without a return address', async () => {
    const res = await POST(req({ body: BASE.body }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/returnAddress/);
  });

  it('scopes the lead query to the caller org', async () => {
    mockSql.mockResolvedValueOnce([]);
    await POST(req(BASE));
    expect(mockSql.mock.calls[0]).toContain('org_1');
  });

  it('rejects non-admins and orgless callers', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await POST(req(BASE))).status).toBe(403);

    requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
    getOrganization.mockResolvedValue(null);
    expect((await POST(req(BASE))).status).toBe(403);
  });
});
