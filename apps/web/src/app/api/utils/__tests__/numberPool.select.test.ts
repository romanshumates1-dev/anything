/**
 * INT-3 — local-presence number selection.
 *
 * These test the PURE selection layer (no DB, nothing skipped). The algorithm is
 * the part that can silently go wrong — pick a wrong-region number, blow a cap,
 * or hammer one number — so it is deliberately kept free of I/O and tested here
 * without a live-DB gate. DB round-trips live in numberPoolStore.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROTATION_CAP,
  effectiveDailyCap,
  selectNumber,
  type PoolCandidate,
} from '../numberPool';

// 502 = Louisville KY (Eastern), 270 = Western KY (Central), 213 = Los Angeles (Pacific)
const num = (phone: string, over: Partial<PoolCandidate> = {}): PoolCandidate => ({
  phoneNumber: phone,
  numberType: '10dlc',
  trustLevel: 'medium',
  dailySent: 0,
  active: true,
  ...over,
});

describe('effectiveDailyCap — owner Decision 2: min(rotationCap, carrier capacity)', () => {
  it('rotation guard wins when it is below carrier capacity (the normal case)', () => {
    // medium 10dlc over a 10h window: min(10mps*36000s, 10000) = 10000 carrier
    const cap = effectiveDailyCap(num('+15025550001'), DEFAULT_ROTATION_CAP, 10);
    expect(cap.carrierCap).toBe(10000);
    expect(cap.rotationCap).toBe(125);
    expect(cap.effective).toBe(125); // reputation guard, not the carrier ceiling
    expect(cap.limitedBy).toBe('rotation');
  });

  it('carrier capacity wins when it is below the rotation guard', () => {
    // low trust, 1 mps, 0.01h window => speedLimit 36 < tMobileDailyCap 2000
    const cap = effectiveDailyCap(num('+15025550001', { trustLevel: 'low' }), 125, 0.01);
    expect(cap.carrierCap).toBe(36);
    expect(cap.effective).toBe(36);
    expect(cap.limitedBy).toBe('carrier');
  });

  it('exposes BOTH numbers so the UI can show guard vs carrier ceiling', () => {
    const cap = effectiveDailyCap(num('+15025550001'), 125, 10);
    expect(cap).toMatchObject({ rotationCap: 125, carrierCap: 10000, effective: 125 });
  });

  it('default rotationCap is 125', () => {
    expect(DEFAULT_ROTATION_CAP).toBe(125);
  });
});

describe('selectNumber — area-code exact > nearest-region > least-used', () => {
  it('1. prefers an EXACT area-code match over everything else', () => {
    const pool = [num('+12135550001'), num('+15025550002'), num('+12705550003')];
    const pick = selectNumber(pool, '+15025559999', 125, 10);
    expect(pick?.phoneNumber).toBe('+15025550002'); // 502 lead -> 502 number
  });

  it('1b. among several exact matches, takes the LEAST-USED', () => {
    const pool = [
      num('+15025550001', { dailySent: 40 }),
      num('+15025550002', { dailySent: 3 }),
      num('+15025550003', { dailySent: 12 }),
    ];
    const pick = selectNumber(pool, '+15025559999', 125, 10);
    expect(pick?.phoneNumber).toBe('+15025550002');
  });

  it('2. no exact match -> NEAREST region wins (270 Western KY beats 213 LA for a 859 lead)', () => {
    const pool = [num('+12135550001'), num('+12705550002')];
    const pick = selectNumber(pool, '+18595559999', 125, 10); // 859 = Lexington KY
    expect(pick?.phoneNumber).toBe('+12705550002');
  });

  it('2b. nearest-region beats least-used (locality is the point of local presence)', () => {
    // The LA number is completely unused; the KY number is busy. Still pick KY.
    const pool = [
      num('+12135550001', { dailySent: 0 }),
      num('+12705550002', { dailySent: 90 }),
    ];
    const pick = selectNumber(pool, '+18595559999', 125, 10);
    expect(pick?.phoneNumber).toBe('+12705550002');
  });

  it('3. unknown lead area code -> falls back to LEAST-USED (no bogus locality claim)', () => {
    const pool = [num('+12135550001', { dailySent: 50 }), num('+15025550002', { dailySent: 2 })];
    const pick = selectNumber(pool, '+19995559999', 125, 10); // 999 is not a real NANP area code
    expect(pick?.phoneNumber).toBe('+15025550002');
  });
});

describe('selectNumber — caps and availability', () => {
  it('skips a number at its effective cap even when it is the exact area-code match', () => {
    const pool = [num('+15025550001', { dailySent: 125 }), num('+12705550002', { dailySent: 0 })];
    const pick = selectNumber(pool, '+15025559999', 125, 10);
    expect(pick?.phoneNumber).toBe('+12705550002'); // 502 is capped out
  });

  it('a number one under its cap is still eligible (boundary)', () => {
    const pool = [num('+15025550001', { dailySent: 124 })];
    expect(selectNumber(pool, '+15025559999', 125, 10)?.phoneNumber).toBe('+15025550001');
  });

  it('returns null when every number is capped — never silently overshoots', () => {
    const pool = [num('+15025550001', { dailySent: 125 }), num('+12705550002', { dailySent: 200 })];
    expect(selectNumber(pool, '+15025559999', 125, 10)).toBeNull();
  });

  it('skips inactive numbers', () => {
    const pool = [num('+15025550001', { active: false }), num('+12705550002')];
    expect(selectNumber(pool, '+15025559999', 125, 10)?.phoneNumber).toBe('+12705550002');
  });

  it('returns null on an empty pool', () => {
    expect(selectNumber([], '+15025559999', 125, 10)).toBeNull();
  });

  it('rotation cap of 0 disables the pool entirely (kill switch)', () => {
    expect(selectNumber([num('+15025550001')], '+15025559999', 0, 10)).toBeNull();
  });
});
