/**
 * Phase A — session flow: preconditions, counter handling, restart-safety,
 * pause-cancels-queue. Pure engine already fuzz-proven in ceiling-fuzz.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
const { mockEnqueue } = vi.hoisted(() => ({ mockEnqueue: vi.fn(async () => 'j1') }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob: mockEnqueue }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
const { isBetaFlagOn } = vi.hoisted(() => ({ isBetaFlagOn: vi.fn(async () => true) }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn }));

import { startSession, advanceRound, pauseSession, parseCounterCents } from '../negotiationSession';

const sqlText = (c: any[]) => (Array.isArray(c[0]) ? (c[0] as string[]).join('¶') : String(c[0]));

const SESSION_ROW = {
  id: 'sess-1', organization_id: 'org', lead_id: 7, side: 'seller', status: 'active',
  round: 0, opener_cents: 73_800_00, clamp_cents: 97_000_00,
  approved_min_cents: 73_800_00, approved_max_cents: 97_000_00,
  last_offer_cents: null, last_counter_cents: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  isBetaFlagOn.mockResolvedValue(true);
  mockSql.mockResolvedValue([]);
});

describe('preconditions (A.0) — absent any one, no session exists', () => {
  it('flag OFF → refused', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const r = await startSession({ organizationId: 'org', leadId: 7, side: 'seller', openerCents: 1, clampCents: 2, approvedMinCents: 1, approvedMaxCents: 2, ownerApproved: true });
    expect(r).toEqual({ error: 'boundedNegotiation flag is off' });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('no owner approval → refused', async () => {
    const r = await startSession({ organizationId: 'org', leadId: 7, side: 'seller', openerCents: 1, clampCents: 2, approvedMinCents: 1, approvedMaxCents: 2, ownerApproved: false });
    expect(r).toEqual({ error: 'no owner-approved range for this lead' });
  });

  it('invalid range → refused', async () => {
    const r = await startSession({ organizationId: 'org', leadId: 7, side: 'seller', openerCents: 1, clampCents: 2, approvedMinCents: 5, approvedMaxCents: 2, ownerApproved: true });
    expect(r).toEqual({ error: 'approved range invalid' });
  });
});

describe('parseCounterCents — never guesses', () => {
  it('parses digits, $, commas, k-suffix', () => {
    expect(parseCounterCents('I want $95,000')).toBe(95_000_00);
    expect(parseCounterCents('how about 92000')).toBe(92_000_00);
    expect(parseCounterCents('90k and we sign')).toBe(90_000_00);
  });
  it('word-amounts and non-prices → null (escalate, never guess)', () => {
    expect(parseCounterCents('ninety grand')).toBeNull();
    expect(parseCounterCents('call me at 3')).toBeNull();
    expect(parseCounterCents('no numbers here')).toBeNull();
  });
});

describe('advanceRound — counter outcomes', () => {
  it('flag OFF at round time → inactive (escalation invariant untouched)', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const r = await advanceRound('sess-1', null, 'x {OFFER}');
    expect(r).toEqual({ outcome: 'inactive', reason: 'flag_off' });
  });

  it('counter inside the bound → agreed + owner notification', async () => {
    mockSql.mockResolvedValueOnce([SESSION_ROW]).mockResolvedValue([]);
    const r = await advanceRound('sess-1', 'we accept $96,500', 'x {OFFER}');
    expect(r).toEqual({ outcome: 'agreed', counterCents: 96_500_00 });
    const approvals = mockSql.mock.calls.filter((c: any[]) => sqlText(c).includes('human_approvals'));
    // the type is a literal in the SQL template, not a bind param
    expect(approvals.map(sqlText).join('')).toContain('NEGOTIATION_AGREED');
    expect(mockEnqueue).not.toHaveBeenCalled(); // no counter-offer after agreement
  });

  it('unparseable counter → paused + escalated, nothing sent', async () => {
    mockSql.mockResolvedValueOnce([SESSION_ROW]).mockResolvedValue([]);
    const r = await advanceRound('sess-1', 'my cousin says the land alone is priceless', 'x {OFFER}');
    expect(r.outcome).toBe('escalated');
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSql.mock.calls.map(sqlText).join('')).toContain('NEGOTIATION_UNPARSEABLE');
  });

  it('counter above bound → queues the NEXT computed offer with the per-round dedupe key (restart-safe)', async () => {
    mockSql
      .mockResolvedValueOnce([SESSION_ROW]) // session fetch
      .mockResolvedValueOnce([]) // last_counter update
      .mockResolvedValueOnce([{ phone: '+15025550101' }]) // lead phone
      .mockResolvedValue([]);
    const r: any = await advanceRound('sess-1', '$120,000 or nothing', 'Given the roof and timeline, {OFFER} cash as-is.');
    expect(r.outcome).toBe('offer_queued');
    expect(r.offerCents).toBe(73_800_00); // round 0 = the opener
    const [type, payload, opts] = mockEnqueue.mock.calls[0];
    expect(type).toBe('send_message');
    expect(opts.dedupeKey).toBe('negoffer:sess-1:0'); // ← restart collapses to this
    expect(payload.text).toContain('$73,800');
    expect(payload.text).not.toContain('{OFFER}');
    expect(payload.boundedNegotiation.computedOfferCents).toBe(73_800_00);
  });

  it('restart no-duplicate: same round → SAME dedupe key on every attempt', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      mockSql.mockReset();
      mockSql
        .mockResolvedValueOnce([{ ...SESSION_ROW }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ phone: '+15025550101' }])
        .mockResolvedValue([]);
      await advanceRound('sess-1', '$120,000', 'x {OFFER}');
    }
    const keys = mockEnqueue.mock.calls.map((c: any[]) => c[2].dedupeKey);
    expect(new Set(keys)).toEqual(new Set(['negoffer:sess-1:0'])); // index collapses dupes
  });

  it('past max rounds → walk-away + owner notification, nothing sent', async () => {
    mockSql
      .mockResolvedValueOnce([{ ...SESSION_ROW, round: 5, last_offer_cents: 95_000_00 }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    const r = await advanceRound('sess-1', '$200,000 final', 'x {OFFER}');
    expect(r).toEqual({ outcome: 'walked_away' });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

describe('pauseSession — owner take-over cancels the queue', () => {
  it('sets paused and cancels pending negoffer jobs for the session', async () => {
    mockSql
      .mockResolvedValueOnce([]) // status update
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]); // cancelled RETURNING
    const r = await pauseSession('sess-1');
    expect(r.cancelled).toBe(2);
    const cancel = mockSql.mock.calls[1];
    expect(sqlText(cancel)).toContain("status = 'cancelled'");
    expect(JSON.stringify(cancel.slice(1))).toContain('negoffer:sess-1:%');
  });
});
