/**
 * Phase V-R — inspection clock + urgency hooks.
 * Pure clock math with a fake clock (no DB); handler with mocked sql proving
 * fresh-state skip + notification shape; exactly-once via dedupe keys.
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

import {
  clockState,
  calendarDaysBetween,
  lowestViableAsk,
  scheduleInspectionUrgency,
  processInspectionUrgency,
} from '../inspectionClock';
import { DEFAULT_FEE_FLOOR } from '../valuationEngine';

const TZ = 'America/New_York';
const signed = new Date('2026-07-01T14:00:00Z'); // Jul 1, 10:00 EDT

describe('clockState — fake-clock stage transitions (10-day window)', () => {
  const at = (day: number, hour = 15) => new Date(Date.UTC(2026, 6, day, hour)); // July

  it('signing day is day 1, green', () => {
    const s = clockState(signed, 10, at(1), TZ);
    expect(s.day).toBe(1);
    expect(s.stage).toBe('green');
    expect(s.label).toBe('Day 1 of 10 — 9 days to assign');
  });

  it('green → amber at half remaining (day 5: 5 remaining = total/2)', () => {
    expect(clockState(signed, 10, at(4), TZ).stage).toBe('green'); // 6 remaining
    expect(clockState(signed, 10, at(5), TZ).stage).toBe('amber'); // 5 remaining
  });

  it('amber → red at ≤2 days remaining (day 8)', () => {
    expect(clockState(signed, 10, at(7), TZ).stage).toBe('amber'); // 3 remaining
    const red = clockState(signed, 10, at(8), TZ); // 2 remaining
    expect(red.stage).toBe('red');
    expect(red.label).toBe('Day 8 of 10 — 2 days to assign');
  });

  it('past the window → expired', () => {
    expect(clockState(signed, 10, at(11), TZ).stage).toBe('expired');
  });

  it('calendar-day counting: signed 11pm, next morning is day 2 (not 24h blocks)', () => {
    const lateNight = new Date('2026-07-01T03:00:00Z'); // Jun 30 23:00 EDT
    const nextMorning = new Date('2026-07-01T12:00:00Z'); // Jul 1 08:00 EDT
    expect(calendarDaysBetween(lateNight, nextMorning, TZ)).toBe(1);
    expect(clockState(lateNight, 10, nextMorning, TZ).day).toBe(2);
  });

  it('DST-safe: counting across the November fall-back does not drift', () => {
    const beforeDst = new Date('2026-10-30T14:00:00Z');
    const afterDst = new Date('2026-11-06T14:00:00Z'); // fall-back Nov 1
    expect(calendarDaysBetween(beforeDst, afterDst, TZ)).toBe(7);
  });

  it('window is clamped to 7–14', () => {
    expect(clockState(signed, 3, signed, TZ).totalDays).toBe(7);
    expect(clockState(signed, 30, signed, TZ).totalDays).toBe(14);
  });
});

describe('lowestViableAsk — day N−2 floor math', () => {
  it('lowest ask = contract price + fee floor; cut vs a current ask', () => {
    const v = lowestViableAsk(85_000_00)!; // $85k in cents
    expect(v.lowestAskCents).toBe(85_000_00 + DEFAULT_FEE_FLOOR * 100); // $88k
    expect(v.maxCutCents(100_000_00)).toBe(12_000_00); // $100k ask → $12k max cut
  });

  it('boundary: current ask exactly at the floor ask → cut 0 (never negative)', () => {
    const v = lowestViableAsk(85_000_00)!;
    expect(v.maxCutCents(88_000_00)).toBe(0);
    expect(v.maxCutCents(87_000_00)).toBe(0);
  });

  it('unknown/garbage contract price → null (recommend exit, no fake number)', () => {
    expect(lowestViableAsk(null)).toBeNull();
    expect(lowestViableAsk(0)).toBeNull();
    expect(lowestViableAsk(NaN)).toBeNull();
  });
});

describe('scheduleInspectionUrgency — exactly-once by dedupe key', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enqueues day3 (+3d) and final (+N−2 d) with per-contract dedupe keys', async () => {
    const created = new Date('2026-07-01T14:00:00Z');
    await scheduleInspectionUrgency('c-1', 'org-1', created, 10);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    const [_t1, p1, o1] = mockEnqueue.mock.calls[0];
    const [_t2, p2, o2] = mockEnqueue.mock.calls[1];
    expect(_t1).toBe('inspection_urgency');
    expect(p1.kind).toBe('day3');
    expect(o1.dedupeKey).toBe('inspect:c-1:day3');
    expect(o1.runAt.getTime()).toBe(created.getTime() + 3 * 86_400_000);
    expect(p2.kind).toBe('final');
    expect(o2.dedupeKey).toBe('inspect:c-1:final');
    expect(o2.runAt.getTime()).toBe(created.getTime() + 8 * 86_400_000); // N−2 = 8
  });

  it('repeated scheduling produces the SAME keys — the jobs unique index collapses them (restart/regen safe)', async () => {
    await scheduleInspectionUrgency('c-1', 'org-1', new Date(), 10);
    await scheduleInspectionUrgency('c-1', 'org-1', new Date(), 10);
    const keys = mockEnqueue.mock.calls.map((c: any[]) => c[2].dedupeKey);
    expect(new Set(keys).size).toBe(2); // only :day3 and :final, ever
  });
});

describe('processInspectionUrgency — fresh state at fire time', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assigned contract → no notification', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'c-1', status: 'PENDING_SIGNATURE', assigned_at: new Date(), inspection_days: 10 }]);
    const r = await processInspectionUrgency({ contractId: 'c-1', organizationId: 'o', kind: 'day3' });
    expect(r).toEqual({ notified: false, reason: 'already_assigned' });
  });

  it('day3 unassigned → PENDING human_approvals row (the owner notification)', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c-1', status: 'PENDING_SIGNATURE', assigned_at: null, inspection_days: 10, contract_price_cents: 8500000 }])
      .mockResolvedValue([]);
    const r = await processInspectionUrgency({ contractId: 'c-1', organizationId: 'o', kind: 'day3' });
    expect(r.notified).toBe(true);
    const insert = mockSql.mock.calls.find((c: any[]) => String(c[0]).includes('human_approvals'));
    expect(insert).toBeTruthy();
    expect(JSON.stringify(insert!.slice(1))).toContain('INSPECTION_DAY3');
  });

  it('final unassigned with price → notification carries the lowest viable ask ($88,000)', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c-1', status: 'PENDING_SIGNATURE', assigned_at: null, inspection_days: 10, contract_price_cents: 8500000 }])
      .mockResolvedValue([]);
    await processInspectionUrgency({ contractId: 'c-1', organizationId: 'o', kind: 'final' });
    const insert = mockSql.mock.calls.find((c: any[]) => String(c[0]).includes('human_approvals'));
    const params = JSON.stringify(insert!.slice(1));
    expect(params).toContain('INSPECTION_FINAL');
    expect(params).toContain('88,000'); // 85k + 3k floor
  });

  it('final with unknown price → plain exit/renegotiate recommendation, no fake number', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c-1', status: 'PENDING_SIGNATURE', assigned_at: null, inspection_days: 10, contract_price_cents: null }])
      .mockResolvedValue([]);
    await processInspectionUrgency({ contractId: 'c-1', organizationId: 'o', kind: 'final' });
    const insert = mockSql.mock.calls.find((c: any[]) => String(c[0]).includes('human_approvals'));
    expect(JSON.stringify(insert!.slice(1))).toMatch(/exit or renegotiation/i);
  });
});
