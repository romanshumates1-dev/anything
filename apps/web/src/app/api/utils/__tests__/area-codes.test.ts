import { describe, it, expect } from 'vitest';
import { areaCodeOf, regionForPhone } from '../area-codes';

describe('areaCodeOf', () => {
  it('extracts the area code from assorted phone formats', () => {
    expect(areaCodeOf('+15025550123')).toBe('502');
    expect(areaCodeOf('(502) 555-0123')).toBe('502');
    expect(areaCodeOf('502.555.0123')).toBe('502');
    expect(areaCodeOf('5025550123')).toBe('502');
  });
  it('returns null for junk / too-short input', () => {
    expect(areaCodeOf('')).toBeNull();
    expect(areaCodeOf(null)).toBeNull();
    expect(areaCodeOf('12')).toBeNull();
  });
});

describe('regionForPhone', () => {
  it('maps known area codes to the right region (region-level, approximate)', () => {
    expect(regionForPhone('+15025550123')?.region).toMatch(/Louisville, KY/);
    expect(regionForPhone('+17045550123')?.region).toMatch(/Charlotte, NC/);
    expect(regionForPhone('+14045550123')?.region).toMatch(/Atlanta, GA/);
    expect(regionForPhone('+13145550123')?.region).toMatch(/St\. Louis, MO/);
  });
  it('falls back to US center for an unknown area code (non-strict)', () => {
    expect(regionForPhone('+19995550123')?.region).toMatch(/United States/);
  });
  it('returns null for an unknown area code in strict mode', () => {
    expect(regionForPhone('+19995550123', true)).toBeNull();
  });
  it('never returns a precise address — only a region label + centroid', () => {
    const p = regionForPhone('+15025550123')!;
    expect(typeof p.lat).toBe('number');
    expect(typeof p.lng).toBe('number');
    expect(p.region).not.toMatch(/\d{2,}\s+\w+\s+(St|Ave|Rd|Dr)/i); // no street address
  });
});
