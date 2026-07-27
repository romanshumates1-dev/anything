/**
 * dispatchGate — the CAN-SPAM email path.
 *
 * Email is governed by CAN-SPAM (15 U.S.C. 7701), not the TCPA. The value of
 * this channel is that it needs NO carrier registration and NO prior consent,
 * so the pipeline can be exercised end-to-end while A2P 10DLC is pending. That
 * only holds if the gate applies email's rules and not the phone's — these
 * tests pin exactly which rules apply, in both directions.
 *
 * The two failure modes worth guarding:
 *   fail-OPEN  — emailing someone who unsubscribed (CAN-SPAM's central duty)
 *   fail-SHUT  — applying TCPA rules to email and blocking lawful sends
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { isBetaFlagOn } = vi.hoisted(() => ({ isBetaFlagOn: vi.fn(async () => true) }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn }));

vi.mock('@/app/api/utils/twilio-adapter', () => ({ getTwilioConfig: () => null }));

const { checkDncRegistry, getOrgSendPolicy, hasSmsConsent, isAreaCoverageFresh } = vi.hoisted(
  () => ({
    checkDncRegistry: vi.fn(async () => ({ listed: false }) as any),
    getOrgSendPolicy: vi.fn(async () => ({
      smsConsentPolicy: 'required' as const,
      dncEnforcement: 'strict' as const,
    })),
    hasSmsConsent: vi.fn(async () => false),
    isAreaCoverageFresh: vi.fn(async () => ({ fresh: false, lastFetchedAt: null, ageDays: null })),
  })
);
vi.mock('../dncRegistry', () => ({
  checkDncRegistry,
  getOrgSendPolicy,
  hasSmsConsent,
  isAreaCoverageFresh,
  SAFE_HARBOR_DAYS: 31,
}));

import { dispatchGate, isTelephony } from '../dispatchGate';

const EMAIL = 'buyer@example.com';
let savedEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
  isBetaFlagOn.mockResolvedValue(true);
  // Deliberately hostile telephony policy: strict DNC + required SMS consent,
  // stale coverage, listed number. NONE of it may touch an email send.
  getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'required', dncEnforcement: 'strict' });
  checkDncRegistry.mockResolvedValue({ listed: true, source: 'federal', jurisdiction: null });
  hasSmsConsent.mockResolvedValue(false);
  isAreaCoverageFresh.mockResolvedValue({ fresh: false, lastFetchedAt: null, ageDays: null });
  savedEnv = process.env.DISPATCH_SKIP_QUIET_HOURS;
  delete process.env.DISPATCH_SKIP_QUIET_HOURS; // time gates ACTIVE — must not fire for email
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.DISPATCH_SKIP_QUIET_HOURS;
  else process.env.DISPATCH_SKIP_QUIET_HOURS = savedEnv;
});

const emailReq = (over: Record<string, unknown> = {}) =>
  ({
    phone: '',
    email: EMAIL,
    channel: 'email',
    coldOutbound: true,
    organizationId: 'org_1',
    ...over,
  }) as any;

describe('isTelephony', () => {
  it('classifies email as NOT telephony', () => {
    expect(isTelephony('sms')).toBe(true);
    expect(isTelephony('voice')).toBe(true);
    expect(isTelephony('rvm')).toBe(true);
    expect(isTelephony('email')).toBe(false);
  });
});

describe('email honours opt-out (CAN-SPAM central duty)', () => {
  it('DENIES a send to an unsubscribed address', async () => {
    mockSql.mockResolvedValue([{ '1': 1 }]); // suppression row exists
    const d = await dispatchGate(emailReq());
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('DNC');
    expect((d as any).reason).toMatch(/unsubscribed/i);
  });

  it('looks up suppression by the EMAIL ADDRESS, not the phone', async () => {
    // Using the wrong key here would fail OPEN — we would email someone who
    // had unsubscribed because their phone had no suppression row.
    await dispatchGate(emailReq({ phone: '+15025550123' }));
    expect(mockSql.mock.calls[0]).toContain(EMAIL);
    expect(mockSql.mock.calls[0]).not.toContain('+15025550123');
  });

  it('ALLOWS a send to an address with no suppression row', async () => {
    const d = await dispatchGate(emailReq());
    expect(d.allow).toBe(true);
  });
});

describe('email does NOT inherit telephony rules', () => {
  it('ignores a federal DNC listing — that is a TELEPHONE registry', async () => {
    const d = await dispatchGate(emailReq());
    expect(d.allow).toBe(true);
    expect(checkDncRegistry).not.toHaveBeenCalled();
  });

  it('ignores sms_consent_policy=required — CAN-SPAM is opt-OUT, not opt-in', async () => {
    // This is the whole reason email is usable today: no prior consent needed,
    // so no carrier registration blocks it.
    const d = await dispatchGate(emailReq());
    expect(d.allow).toBe(true);
    expect(hasSmsConsent).not.toHaveBeenCalled();
  });

  it('ignores stale DNC coverage under strict enforcement', async () => {
    const d = await dispatchGate(emailReq());
    expect(d.allow).toBe(true);
    expect(isAreaCoverageFresh).not.toHaveBeenCalled();
  });

  it('sends at 3am — TCPA quiet hours govern calls and texts, not email', async () => {
    // 08:00 UTC = 03:00 America/New_York, squarely inside quiet hours. An SMS
    // would be deferred here; an email must not be.
    const at = new Date('2026-07-15T08:00:00Z');
    const d = await dispatchGate(emailReq({ now: at }));
    expect(d.allow).toBe(true);
  });

  it('is not snapped to cadence send windows', async () => {
    const at = new Date('2026-07-15T21:00:00Z'); // 5pm ET — outside 10-11 / 2-4
    const d = await dispatchGate(emailReq({ isCadenceStep: true, now: at }));
    expect(d.allow).toBe(true);
  });
});

describe('email still respects integration flags and fails closed', () => {
  it('emits zero events when its beta flag is OFF', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const d = await dispatchGate(emailReq({ betaFlag: 'twilioDemo' }));
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('FLAG_OFF');
  });

  it('DENIES when no address is supplied rather than falling back to phone', async () => {
    for (const missing of [undefined, null, '', '   ']) {
      const d = await dispatchGate(emailReq({ email: missing, phone: '+15025550123' }));
      expect(d.allow, `email=${JSON.stringify(missing)}`).toBe(false);
      expect((d as any).reason).toMatch(/requires an email address/);
    }
  });

  it('fails CLOSED if the suppression lookup throws', async () => {
    mockSql.mockRejectedValue(new Error('db down'));
    const d = await dispatchGate(emailReq());
    expect(d.allow).toBe(false);
  });
});

describe('telephony is unaffected by the email branch', () => {
  it('still applies the DNC registry to an SMS send', async () => {
    process.env.DISPATCH_SKIP_QUIET_HOURS = '1';
    const d = await dispatchGate({
      phone: '+15025550123',
      channel: 'sms',
      coldOutbound: true,
      organizationId: 'org_1',
    } as any);
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('DNC_REGISTRY');
    expect(checkDncRegistry).toHaveBeenCalled();
  });
});
