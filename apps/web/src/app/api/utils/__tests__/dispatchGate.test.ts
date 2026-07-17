/**
 * P2.0 — dispatchGate. The universal send-time compliance gate.
 *
 * Required coverage (owner Decision 3): each gate check individually, gate
 * ORDER, timezone edges, DST transition, unknown area code → most restrictive.
 *
 * Unit test: `sql` (isSuppressed) and `betaFlags` (isBetaFlagOn) are mocked so
 * the gate's branching is exercised without a DB. The timezone helpers are pure
 * and tested directly against real IANA zones via Intl (no mocks, no fakes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
const { isBetaFlagOn } = vi.hoisted(() => ({ isBetaFlagOn: vi.fn(async () => true) }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn }));

import {
  dispatchGate,
  localHourIn,
  isWithinQuietHours,
  isWithinSendWindow,
  QUIET_HOURS,
  SEND_WINDOWS,
} from '../dispatchGate';
import { timezonesForPhone } from '../area-codes';

const NY = 'America/New_York';
const LA = 'America/Los_Angeles';
const KY_PHONE = '+15025550123'; // Louisville — single known zone
const UNKNOWN_PHONE = '+19995550123'; // unmapped area code → all US zones

/** A Date whose lead-local hour in `tz` is `hour` — built by probing, so DST-safe. */
function atLocalHour(tz: string, hour: number, isoDay = '2026-07-15'): Date {
  for (let utcH = 0; utcH < 48; utcH++) {
    const d = new Date(`${isoDay}T00:00:00Z`);
    d.setUTCHours(utcH);
    if (localHourIn(tz, d) === hour) return d;
  }
  throw new Error(`no instant found for ${tz} hour ${hour}`);
}

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([]); // default: not suppressed
  isBetaFlagOn.mockReset();
  isBetaFlagOn.mockResolvedValue(true); // default: flag on
});

describe('timezone helpers — DST-correct via Intl', () => {
  it('resolves the same local hour across DST (EDT summer vs EST winter)', () => {
    // 16:00Z is 12:00 EDT (UTC-4, summer); 17:00Z is 12:00 EST (UTC-5, winter).
    expect(localHourIn(NY, new Date('2026-07-15T16:00:00Z'))).toBe(12);
    expect(localHourIn(NY, new Date('2026-01-15T17:00:00Z'))).toBe(12);
  });

  it('handles the spring-forward transition day without drifting', () => {
    // 2026-03-08 is US spring-forward. 07:00Z = 02:00 EST → clocks jump to 03:00 EDT.
    const before = localHourIn(NY, new Date('2026-03-08T06:00:00Z')); // 01:00 EST
    const after = localHourIn(NY, new Date('2026-03-08T07:00:00Z')); // 03:00 EDT (02:00 does not exist)
    expect(before).toBe(1);
    expect(after).toBe(3);
  });
});

describe('quiet hours 8am–9pm lead-local — boundary edges', () => {
  it('denies 7am, allows 8am (inclusive start)', () => {
    expect(isWithinQuietHours([NY], atLocalHour(NY, 7))).toBe(false);
    expect(isWithinQuietHours([NY], atLocalHour(NY, QUIET_HOURS.startHour))).toBe(true);
  });
  it('allows 8pm, denies 9pm (exclusive end)', () => {
    expect(isWithinQuietHours([NY], atLocalHour(NY, 20))).toBe(true);
    expect(isWithinQuietHours([NY], atLocalHour(NY, QUIET_HOURS.endHour))).toBe(false);
  });
});

describe('unknown area code → MOST RESTRICTIVE across all candidate zones', () => {
  it('maps a known area code to exactly one zone, an unknown one to many', () => {
    expect(timezonesForPhone(KY_PHONE)).toHaveLength(1);
    expect(timezonesForPhone(UNKNOWN_PHONE).length).toBeGreaterThan(1);
  });

  it('holds when it is legal in ET but still too early in PT ("could be 7am somewhere")', () => {
    // 8am ET == 5am PT → must be denied for an unknown number.
    const eightET = atLocalHour(NY, 8);
    expect(isWithinQuietHours([NY], eightET)).toBe(true); // fine if we KNOW it's NY
    expect(isWithinQuietHours([NY, LA], eightET)).toBe(false); // unknown → most restrictive
  });

  it('holds when it is legal in PT but already 9pm+ in ET ("could be 9:05pm somewhere")', () => {
    const eightPT = atLocalHour(LA, 20); // 8pm PT == 11pm ET
    expect(isWithinQuietHours([LA], eightPT)).toBe(true);
    expect(isWithinQuietHours([NY, LA], eightPT)).toBe(false);
  });
});

describe('send windows (cadence only) — 10-11am / 2-4pm lead-local', () => {
  it('accepts inside a window, rejects between windows', () => {
    expect(isWithinSendWindow([NY], atLocalHour(NY, SEND_WINDOWS[0].startHour))).toBe(true);
    expect(isWithinSendWindow([NY], atLocalHour(NY, 14))).toBe(true);
    expect(isWithinSendWindow([NY], atLocalHour(NY, 12))).toBe(false); // lunch gap
    expect(isWithinSendWindow([NY], atLocalHour(NY, 16))).toBe(false); // exclusive end
  });
});

describe('each gate check, individually', () => {
  const noon = atLocalHour(NY, 10); // inside quiet hours AND a send window

  it('1. DNC — suppressed target denied on every channel', async () => {
    mockSql.mockResolvedValue([{ '?column?': 1 }]); // isSuppressed → true
    for (const channel of ['sms', 'voice', 'rvm'] as const) {
      const d = await dispatchGate({ phone: KY_PHONE, channel, consentBasis: 'inbound-initiated', now: noon });
      expect(d.allow).toBe(false);
      expect((d as any).code).toBe('DNC');
    }
  });

  it('2. FLAG_OFF — an off beta flag emits zero dispatches', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const d = await dispatchGate({ phone: KY_PHONE, channel: 'sms', betaFlag: 'cadenceEngine', now: noon });
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('FLAG_OFF');
  });

  it('3. NO_CONSENT — voice/rvm without a valid consentBasis is skipped', async () => {
    for (const channel of ['voice', 'rvm'] as const) {
      const missing = await dispatchGate({ phone: KY_PHONE, channel, now: noon });
      expect((missing as any).code).toBe('NO_CONSENT');
      const bogus = await dispatchGate({ phone: KY_PHONE, channel, consentBasis: 'i-said-so', now: noon });
      expect((bogus as any).code).toBe('NO_CONSENT');
    }
  });

  it('3b. consent is NOT required for sms, and a valid basis lets voice through', async () => {
    const sms = await dispatchGate({ phone: KY_PHONE, channel: 'sms', now: noon });
    expect(sms.allow).toBe(true);
    for (const basis of ['manual-list-attested', 'inbound-initiated']) {
      const voice = await dispatchGate({ phone: KY_PHONE, channel: 'voice', consentBasis: basis, now: noon });
      expect(voice.allow).toBe(true);
    }
  });

  it('4. QUIET_HOURS — denied outside 8am-9pm, with a retryAt inside the window', async () => {
    const d = await dispatchGate({ phone: KY_PHONE, channel: 'sms', now: atLocalHour(NY, 23) });
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('QUIET_HOURS');
    const retryAt = (d as any).retryAt as Date;
    expect(retryAt).toBeInstanceOf(Date);
    expect(isWithinQuietHours(timezonesForPhone(KY_PHONE), retryAt)).toBe(true);
  });

  it('5. OUTSIDE_WINDOW — cadence steps snap; non-cadence sends do not', async () => {
    const gap = atLocalHour(NY, 12); // legal hour, but between send windows
    const plain = await dispatchGate({ phone: KY_PHONE, channel: 'sms', now: gap });
    expect(plain.allow).toBe(true); // not a cadence step → windows don't apply

    const step = await dispatchGate({ phone: KY_PHONE, channel: 'sms', isCadenceStep: true, now: gap });
    expect(step.allow).toBe(false);
    expect((step as any).code).toBe('OUTSIDE_WINDOW');
    const retryAt = (step as any).retryAt as Date;
    const tzs = timezonesForPhone(KY_PHONE);
    expect(isWithinSendWindow(tzs, retryAt)).toBe(true);
    expect(isWithinQuietHours(tzs, retryAt)).toBe(true); // snap never lands outside quiet hours
  });
});

describe('gate ORDER + fail-closed', () => {
  const noon = atLocalHour(NY, 10);

  it('DNC outranks everything (checked before flag/consent/hours)', async () => {
    mockSql.mockResolvedValue([{ '?column?': 1 }]); // suppressed
    isBetaFlagOn.mockResolvedValue(false); // flag also off
    const d = await dispatchGate({
      phone: KY_PHONE, channel: 'voice', betaFlag: 'voiceEscalation',
      now: atLocalHour(NY, 23), // also quiet hours
    });
    expect((d as any).code).toBe('DNC'); // DNC wins, not FLAG_OFF/NO_CONSENT/QUIET_HOURS
  });

  it('flag is checked before consent', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const d = await dispatchGate({ phone: KY_PHONE, channel: 'voice', betaFlag: 'voiceEscalation', now: noon });
    expect((d as any).code).toBe('FLAG_OFF'); // not NO_CONSENT
  });

  it('fails CLOSED when the suppression lookup throws', async () => {
    mockSql.mockRejectedValue(new Error('db down'));
    const d = await dispatchGate({ phone: KY_PHONE, channel: 'sms', now: noon });
    expect(d.allow).toBe(false);
  });
});

describe('transactional sends (P2.0-W) — time gates skipped, absolute gates never', () => {
  const elevenPm = atLocalHour('America/New_York', 23);

  it('a transactional send is allowed at 11pm (quiet hours skipped)', async () => {
    const d = await dispatchGate({
      phone: '+15025550123', channel: 'sms', transactional: true, now: elevenPm,
    });
    expect(d.allow).toBe(true);
  });

  it('the same send WITHOUT transactional is denied at 11pm (proves the flag is load-bearing)', async () => {
    const d = await dispatchGate({ phone: '+15025550123', channel: 'sms', now: elevenPm });
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('QUIET_HOURS');
  });

  it('DNC still suppresses a transactional send — opted out means nothing, ever', async () => {
    mockSql.mockResolvedValue([{ 1: 1 }]); // suppressed
    const d = await dispatchGate({
      phone: '+15025550123', channel: 'sms', transactional: true, now: elevenPm,
    });
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('DNC');
  });

  it('beta flag OFF still suppresses a transactional send', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const d = await dispatchGate({
      phone: '+15025550123', channel: 'sms', betaFlag: 'speedToLead', transactional: true, now: elevenPm,
    });
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('FLAG_OFF');
  });
});
