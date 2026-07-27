/**
 * dncRegistry — federal/state DNC suppression + the 16 CFR 310.4(b)(3)(iv)
 * 31-day Safe Harbor freshness clock (migration 043).
 *
 * Unit test: `sql` is mocked so every branch is exercised without a DB. Dates
 * are injected, never wall-clock, so the freshness boundary is deterministic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import {
  normalizeDncPhone,
  checkDncRegistry,
  isAreaCoverageFresh,
  getOrgSendPolicy,
  hasSmsConsent,
  SAFE_HARBOR_DAYS,
} from '../dncRegistry';

const NOW = new Date('2026-07-27T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
});

describe('normalizeDncPhone', () => {
  it('canonicalises every input shape to the SAME +1 key', () => {
    // This is the load-bearing property: DNC source files are bare 10-digit,
    // the app stores E.164. If these diverge the lookup misses and a listed
    // number sails through — a fail-OPEN bug.
    const expected = '+15025550123';
    for (const input of [
      '5025550123',
      '15025550123',
      '+15025550123',
      '(502) 555-0123',
      '502-555-0123',
      '502.555.0123',
      ' +1 502 555 0123 ',
    ]) {
      expect(normalizeDncPhone(input), `input: ${input}`).toBe(expected);
    }
  });

  it('returns null for unparseable input rather than a wrong key', () => {
    for (const bad of [null, undefined, '', '123', '55501234', '+445025550123', 'abc']) {
      expect(normalizeDncPhone(bad as any), `input: ${String(bad)}`).toBeNull();
    }
  });

  it('rejects non-NANP numbers (NPA or exchange starting 0/1)', () => {
    expect(normalizeDncPhone('1025550123')).toBeNull(); // NPA starts with 0... (after 1-strip)
    expect(normalizeDncPhone('5021550123')).toBeNull(); // exchange starts with 1
    expect(normalizeDncPhone('5020550123')).toBeNull(); // exchange starts with 0
  });
});

describe('checkDncRegistry', () => {
  it('reports a federal listing with its source', async () => {
    mockSql.mockResolvedValueOnce([{ list_source: 'federal', jurisdiction: null }]);
    const hit = await checkDncRegistry('+15025550123');
    expect(hit).toEqual({ listed: true, source: 'federal', jurisdiction: null });
  });

  it('reports a state listing with its jurisdiction', async () => {
    mockSql.mockResolvedValueOnce([{ list_source: 'state', jurisdiction: 'FL' }]);
    const hit = await checkDncRegistry('+13055550123');
    expect(hit).toEqual({ listed: true, source: 'state', jurisdiction: 'FL' });
  });

  it('is not listed when no row matches', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await checkDncRegistry('+15025550123')).toEqual({ listed: false });
  });

  it('queries the CANONICAL key, not the raw input', async () => {
    mockSql.mockResolvedValueOnce([]);
    await checkDncRegistry('(502) 555-0123');
    expect(mockSql.mock.calls[0]).toContain('+15025550123');
  });

  it('short-circuits without a query on unparseable input', async () => {
    expect(await checkDncRegistry('nonsense')).toEqual({ listed: false });
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe('isAreaCoverageFresh (Safe Harbor clock)', () => {
  it('is fresh when coverage was fetched inside the window', async () => {
    mockSql.mockResolvedValueOnce([{ last_fetched_at: daysAgo(5) }]);
    const cov = await isAreaCoverageFresh('+15025550123', NOW);
    expect(cov.fresh).toBe(true);
    expect(Math.round(cov.ageDays!)).toBe(5);
  });

  it('is STALE past the 31-day limit — a decayed snapshot confers no safe harbour', async () => {
    mockSql.mockResolvedValueOnce([{ last_fetched_at: daysAgo(45) }]);
    const cov = await isAreaCoverageFresh('+15025550123', NOW);
    expect(cov.fresh).toBe(false);
    expect(Math.round(cov.ageDays!)).toBe(45);
  });

  it('treats exactly 31 days as still fresh, and just past it as stale', async () => {
    mockSql.mockResolvedValueOnce([{ last_fetched_at: daysAgo(SAFE_HARBOR_DAYS) }]);
    expect((await isAreaCoverageFresh('+15025550123', NOW)).fresh).toBe(true);

    mockSql.mockResolvedValueOnce([{ last_fetched_at: daysAgo(SAFE_HARBOR_DAYS + 0.5) }]);
    expect((await isAreaCoverageFresh('+15025550123', NOW)).fresh).toBe(false);
  });

  it('is not fresh when we hold no coverage for the area code', async () => {
    mockSql.mockResolvedValueOnce([{ last_fetched_at: null }]);
    const cov = await isAreaCoverageFresh('+15025550123', NOW);
    expect(cov).toEqual({ fresh: false, lastFetchedAt: null, ageDays: null });
  });

  it('accepts a STRING timestamp as well as a Date (Neon returns both shapes)', async () => {
    // Neon's driver returns timestamptz as a Date for some column shapes and a
    // string for others; assuming one caused the INT-3 daily-reset bug.
    mockSql.mockResolvedValueOnce([{ last_fetched_at: daysAgo(3).toISOString() }]);
    expect((await isAreaCoverageFresh('+15025550123', NOW)).fresh).toBe(true);
  });

  it('is not fresh on an unparseable timestamp instead of throwing', async () => {
    mockSql.mockResolvedValueOnce([{ last_fetched_at: 'not-a-date' }]);
    expect((await isAreaCoverageFresh('+15025550123', NOW)).fresh).toBe(false);
  });
});

describe('getOrgSendPolicy', () => {
  it('reads the org row', async () => {
    mockSql.mockResolvedValueOnce([{ sms_consent_policy: 'required', dnc_enforcement: 'strict' }]);
    expect(await getOrgSendPolicy('org_1')).toEqual({
      smsConsentPolicy: 'required',
      dncEnforcement: 'strict',
    });
  });

  it('falls back WITHOUT querying when no org is supplied', async () => {
    expect(await getOrgSendPolicy(null)).toEqual({
      smsConsentPolicy: 'attested',
      dncEnforcement: 'advisory',
    });
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('falls back when the org row is missing', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await getOrgSendPolicy('ghost')).toEqual({
      smsConsentPolicy: 'attested',
      dncEnforcement: 'advisory',
    });
  });
});

describe('hasSmsConsent', () => {
  it('is true on a recorded consent row', async () => {
    mockSql.mockResolvedValueOnce([{ '1': 1 }]);
    expect(await hasSmsConsent('+15025550123')).toBe(true);
  });

  it('is false with no consent row', async () => {
    mockSql.mockResolvedValueOnce([]);
    expect(await hasSmsConsent('+15025550123')).toBe(false);
  });

  it('is false — never true — on unparseable input, and does not query', async () => {
    expect(await hasSmsConsent('garbage')).toBe(false);
    expect(mockSql).not.toHaveBeenCalled();
  });
});
