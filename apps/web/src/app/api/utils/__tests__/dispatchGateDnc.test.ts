/**
 * dispatchGate steps 1.5 (DNC registry + Safe Harbor freshness) and 3.2 (SMS
 * opt-in) — migration 043.
 *
 * `dncRegistry` is mocked here so this file tests the GATE'S BRANCHING AND
 * ORDER; the registry's own logic is covered in dncRegistry.test.ts.
 *
 * DISPATCH_SKIP_QUIET_HOURS is set deliberately: it short-circuits ONLY the two
 * time gates (steps 4-5), which sit AFTER everything under test, so the checks
 * here run unchanged while the assertions stay free of wall-clock dependence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { isBetaFlagOn } = vi.hoisted(() => ({ isBetaFlagOn: vi.fn(async () => true) }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn }));

// No Twilio configured → the demo-allowlist branch (step 2.5) is inert.
vi.mock('@/app/api/utils/twilio-adapter', () => ({ getTwilioConfig: () => null }));

const { checkDncRegistry, isAreaCoverageFresh, getOrgSendPolicy, hasSmsConsent } = vi.hoisted(
  () => ({
    checkDncRegistry: vi.fn(async () => ({ listed: false }) as any),
    isAreaCoverageFresh: vi.fn(async () => ({ fresh: true, lastFetchedAt: new Date(), ageDays: 1 })),
    getOrgSendPolicy: vi.fn(async () => ({
      smsConsentPolicy: 'attested' as const,
      dncEnforcement: 'advisory' as const,
    })),
    hasSmsConsent: vi.fn(async () => false),
  })
);
vi.mock('../dncRegistry', () => ({
  checkDncRegistry,
  isAreaCoverageFresh,
  getOrgSendPolicy,
  hasSmsConsent,
  SAFE_HARBOR_DAYS: 31,
}));

import { dispatchGate } from '../dispatchGate';

const PHONE = '+15025550123';
let savedEnv: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]); // isSuppressed → not internally suppressed
  isBetaFlagOn.mockResolvedValue(true);
  checkDncRegistry.mockResolvedValue({ listed: false });
  isAreaCoverageFresh.mockResolvedValue({ fresh: true, lastFetchedAt: new Date(), ageDays: 1 });
  getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'attested', dncEnforcement: 'advisory' });
  hasSmsConsent.mockResolvedValue(false);
  savedEnv = process.env.DISPATCH_SKIP_QUIET_HOURS;
  process.env.DISPATCH_SKIP_QUIET_HOURS = '1';
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.DISPATCH_SKIP_QUIET_HOURS;
  else process.env.DISPATCH_SKIP_QUIET_HOURS = savedEnv;
});

const cold = (over: Record<string, unknown> = {}) =>
  ({ phone: PHONE, channel: 'sms', coldOutbound: true, organizationId: 'org_1', ...over }) as any;

describe('step 1.5 — DNC registry suppression', () => {
  it('DENIES a cold send to a federally listed number', async () => {
    checkDncRegistry.mockResolvedValue({ listed: true, source: 'federal', jurisdiction: null });
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('DNC_REGISTRY');
    expect((d as any).reason).toMatch(/federal/i);
  });

  it('names the state jurisdiction in the deny reason', async () => {
    checkDncRegistry.mockResolvedValue({ listed: true, source: 'state', jurisdiction: 'FL' });
    const d = await dispatchGate(cold());
    expect((d as any).code).toBe('DNC_REGISTRY');
    expect((d as any).reason).toMatch(/state\/FL/);
  });

  it('ALLOWS a cold send to an unlisted number', async () => {
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(true);
  });

  // The carve-out that keeps inbound conversations working. The National DNC
  // Registry governs SOLICITATIONS; a reply in a thread the consumer started is
  // not one. Suppressing it would silently break every inbound negotiation.
  it('does NOT consult the registry for a REPLY (non-cold) even if listed', async () => {
    checkDncRegistry.mockResolvedValue({ listed: true, source: 'federal', jurisdiction: null });
    const d = await dispatchGate({ phone: PHONE, channel: 'sms', coldOutbound: false } as any);
    expect(d.allow).toBe(true);
    expect(checkDncRegistry).not.toHaveBeenCalled();
  });

  it('skips the registry entirely when dnc_enforcement=off', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'attested', dncEnforcement: 'off' });
    checkDncRegistry.mockResolvedValue({ listed: true, source: 'federal', jurisdiction: null });
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(true);
    expect(checkDncRegistry).not.toHaveBeenCalled();
  });
});

describe('step 1.5 — Safe Harbor freshness (16 CFR 310.4(b)(3)(iv))', () => {
  it('ADVISORY: allows an unlisted number even on stale coverage', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'attested', dncEnforcement: 'advisory' });
    isAreaCoverageFresh.mockResolvedValue({ fresh: false, lastFetchedAt: new Date(), ageDays: 90 });
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(true);
    // Advisory must not even pay for the freshness query.
    expect(isAreaCoverageFresh).not.toHaveBeenCalled();
  });

  it('STRICT: denies on STALE coverage — a decayed snapshot is not defensible', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'attested', dncEnforcement: 'strict' });
    isAreaCoverageFresh.mockResolvedValue({ fresh: false, lastFetchedAt: new Date(), ageDays: 90 });
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('DNC_STALE');
    expect((d as any).reason).toMatch(/90 days old/);
  });

  it('STRICT: denies when coverage was NEVER imported for the area code', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'attested', dncEnforcement: 'strict' });
    isAreaCoverageFresh.mockResolvedValue({ fresh: false, lastFetchedAt: null, ageDays: null });
    const d = await dispatchGate(cold());
    expect((d as any).code).toBe('DNC_STALE');
    expect((d as any).reason).toMatch(/no registry coverage/i);
  });

  it('STRICT: allows on fresh coverage', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'attested', dncEnforcement: 'strict' });
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(true);
  });
});

describe('step 3.2 — SMS opt-in', () => {
  it('REQUIRED: denies a cold SMS with no recorded consent', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'required', dncEnforcement: 'advisory' });
    hasSmsConsent.mockResolvedValue(false);
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('NO_CONSENT');
  });

  it('REQUIRED: allows a cold SMS when consent IS recorded', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'required', dncEnforcement: 'advisory' });
    hasSmsConsent.mockResolvedValue(true);
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(true);
  });

  it('ATTESTED: allows a cold SMS without any consent record', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'attested', dncEnforcement: 'advisory' });
    hasSmsConsent.mockResolvedValue(false);
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(true);
    expect(hasSmsConsent).not.toHaveBeenCalled();
  });

  it('does not gate a REPLY on consent, even under required', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'required', dncEnforcement: 'advisory' });
    const d = await dispatchGate({ phone: PHONE, channel: 'sms', coldOutbound: false } as any);
    expect(d.allow).toBe(true);
    expect(hasSmsConsent).not.toHaveBeenCalled();
  });

  it('does not apply the SMS consent rule to voice (step 3 owns that channel)', async () => {
    getOrgSendPolicy.mockResolvedValue({ smsConsentPolicy: 'required', dncEnforcement: 'advisory' });
    const d = await dispatchGate(
      cold({ channel: 'voice', consentBasis: 'manual-list-attested' })
    );
    expect(d.allow).toBe(true);
    expect(hasSmsConsent).not.toHaveBeenCalled();
  });
});

describe('gate ORDER', () => {
  it('internal opt-out (step 1) beats a registry listing — STOP is absolute', async () => {
    mockSql.mockResolvedValue([{ '1': 1 }]); // isSuppressed → true
    checkDncRegistry.mockResolvedValue({ listed: true, source: 'federal', jurisdiction: null });
    const d = await dispatchGate(cold());
    expect((d as any).code).toBe('DNC');
    expect(checkDncRegistry).not.toHaveBeenCalled();
  });

  it('a registry listing beats FLAG_OFF — report the recipient fact, not a toggle', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    checkDncRegistry.mockResolvedValue({ listed: true, source: 'federal', jurisdiction: null });
    const d = await dispatchGate(cold({ betaFlag: 'twilioDemo' }));
    expect((d as any).code).toBe('DNC_REGISTRY');
  });

  it('fails CLOSED if the registry lookup throws', async () => {
    checkDncRegistry.mockRejectedValue(new Error('db down'));
    const d = await dispatchGate(cold());
    expect(d.allow).toBe(false);
  });
});
