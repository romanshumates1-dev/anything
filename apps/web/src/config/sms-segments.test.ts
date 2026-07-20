import { describe, it, expect } from 'vitest';

import { smsSegmentCount, smsSegmentInfo } from './sms-segments';

describe('smsSegmentInfo — GSM-7', () => {
  it('empty body is 0 segments', () => {
    expect(smsSegmentInfo('')).toEqual({ encoding: 'GSM-7', units: 0, segments: 0 });
  });
  it('short ASCII is one GSM-7 segment', () => {
    expect(smsSegmentInfo('hello there')).toMatchObject({ encoding: 'GSM-7', segments: 1 });
  });
  it('160 GSM-7 chars = 1 segment, 161 = 2', () => {
    expect(smsSegmentCount('a'.repeat(160))).toBe(1);
    expect(smsSegmentCount('a'.repeat(161))).toBe(2);
  });
  it('concatenation uses 153/segment', () => {
    expect(smsSegmentCount('a'.repeat(306))).toBe(2);
    expect(smsSegmentCount('a'.repeat(307))).toBe(3);
  });
  it('extension chars (€) cost two septets', () => {
    expect(smsSegmentInfo('€')).toMatchObject({ encoding: 'GSM-7', units: 2, segments: 1 });
  });
});

describe('smsSegmentInfo — UCS-2', () => {
  it('a non-GSM char forces UCS-2', () => {
    expect(smsSegmentInfo('你好')).toMatchObject({ encoding: 'UCS-2', units: 2, segments: 1 });
  });
  it('70 UCS-2 units = 1 segment, 71 = 2 (67/segment concatenated)', () => {
    expect(smsSegmentCount('你'.repeat(70))).toBe(1);
    expect(smsSegmentCount('你'.repeat(71))).toBe(2);
  });
  it('an emoji is a surrogate pair (2 UTF-16 units)', () => {
    expect(smsSegmentInfo('😀')).toMatchObject({ encoding: 'UCS-2', units: 2, segments: 1 });
  });
});
