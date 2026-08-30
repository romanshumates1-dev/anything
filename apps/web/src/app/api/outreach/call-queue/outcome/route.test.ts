/**
 * POST /api/outreach/call-queue/outcome — log a MANUAL call result.
 *
 * Two properties matter most:
 *  1. "do_not_call" must route through registerOptOut so a verbal refusal fans
 *     out across EVERY channel. The caller should not have to separately
 *     remember to stop the postcards — and this is the outcome the prospect
 *     will remember, so getting it wrong is the most expensive mistake here.
 *  2. Outcomes that reached nobody (no answer, voicemail, wrong number) must
 *     NOT move the funnel. Counting them as contact inflates the numbers the
 *     whole campaign is judged on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { registerOptOut } = vi.hoisted(() => ({ registerOptOut: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/compliance', () => ({ registerOptOut }));

const { recordStageTransition } = vi.hoisted(() => ({
  recordStageTransition: vi.fn(async () => {}),
}));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/outreach/call-queue/outcome', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

const LEAD = { id: 42, phone: '+15025550123' };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([LEAD]);
});

describe('do_not_call fans out across every channel', () => {
  it('routes a verbal refusal through registerOptOut, not a local flag', async () => {
    const b = await (await POST(req({ leadId: 42, outcome: 'do_not_call' }))).json();
    expect(registerOptOut).toHaveBeenCalledWith(
      '+15025550123',
      'sms',
      expect.objectContaining({ reason: 'verbal_do_not_call' })
    );
    expect(b.suppressed).toBe(true);
  });

  it('suppresses BEFORE recording the stage, so a later failure cannot leave them reachable', async () => {
    await POST(req({ leadId: 42, outcome: 'do_not_call' }));
    const optOutOrder = registerOptOut.mock.invocationCallOrder[0];
    const stageOrder = recordStageTransition.mock.invocationCallOrder[0];
    expect(optOutOrder).toBeLessThan(stageOrder);
  });

  it('does not suppress on any other outcome', async () => {
    for (const outcome of ['interested', 'callback', 'not_interested', 'no_answer']) {
      vi.clearAllMocks();
      mockSql.mockResolvedValue([LEAD]);
      await POST(req({ leadId: 42, outcome }));
      expect(registerOptOut, outcome).not.toHaveBeenCalled();
    }
  });
});

describe('funnel movement is honest', () => {
  it('an interested call produces ENGAGED — the same stage an emailed reply would', async () => {
    await POST(req({ leadId: 42, outcome: 'interested' }));
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 42, toStage: 'ENGAGED', channel: 'voice' })
    );
  });

  it('a callback records CONTACTED', async () => {
    await POST(req({ leadId: 42, outcome: 'callback' }));
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toStage: 'CONTACTED' })
    );
  });

  it('outcomes that reached NOBODY do not move the funnel', async () => {
    // Counting these as contact inflates the numbers the campaign is judged on.
    for (const outcome of ['no_answer', 'voicemail', 'wrong_number']) {
      vi.clearAllMocks();
      mockSql.mockResolvedValue([LEAD]);
      const b = await (await POST(req({ leadId: 42, outcome }))).json();
      expect(recordStageTransition, outcome).not.toHaveBeenCalled();
      expect(b.stage, outcome).toBeNull();
    }
  });

  it('not_interested closes the lead out', async () => {
    await POST(req({ leadId: 42, outcome: 'not_interested' }));
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ toStage: 'CLOSED_LOST' })
    );
  });
});

describe('validation and tenancy', () => {
  it('rejects an unknown outcome and lists the allowed set', async () => {
    const res = await POST(req({ leadId: 42, outcome: 'sold_them_a_boat' }));
    expect(res.status).toBe(400);
    expect((await res.json()).allowed).toContain('interested');
  });

  it('400s without a numeric leadId', async () => {
    for (const leadId of [undefined, 'abc', null]) {
      expect((await POST(req({ leadId, outcome: 'interested' }))).status).toBe(400);
    }
  });

  it('404s a lead belonging to another org (id guessing blocked)', async () => {
    mockSql.mockResolvedValue([]); // org filter excluded it
    const res = await POST(req({ leadId: 999, outcome: 'interested' }));
    expect(res.status).toBe(404);
    expect(mockSql.mock.calls[0]).toContain('org_1');
  });

  it('rejects non-admins and orgless callers', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await POST(req({ leadId: 42, outcome: 'interested' }))).status).toBe(403);

    requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
    getOrganization.mockResolvedValue(null);
    expect((await POST(req({ leadId: 42, outcome: 'interested' }))).status).toBe(403);
  });
});
