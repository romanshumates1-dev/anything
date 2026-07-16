/**
 * Phase N — the luxury profile forbids cold outbound (inbound/referral only).
 * A cold SMS/voice/RVM attempt on a luxury lead → dispatchGate PROFILE_NO_COLD
 * (zero sends); an inbound-driven send on the same lead processes normally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
const { isBetaFlagOn } = vi.hoisted(() => ({ isBetaFlagOn: vi.fn(async () => true) }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn }));

import { dispatchGate } from '../dispatchGate';

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([]); // not suppressed
  isBetaFlagOn.mockReset();
  isBetaFlagOn.mockResolvedValue(true);
});

const noon = new Date('2026-07-15T16:00:00Z'); // 12pm ET — legal hour

describe('luxury cold-outbound gate', () => {
  it('COLD attempt + profile forbids cold → PROFILE_NO_COLD, no send', async () => {
    const d = await dispatchGate({
      phone: '+15025550123', channel: 'sms',
      coldOutbound: true, profileAllowsCold: false, now: noon,
    });
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('PROFILE_NO_COLD');
    expect((d as any).reason).toMatch(/forbids cold outbound/i);
  });

  it('cold attempt on voice/rvm is also skipped', async () => {
    for (const channel of ['voice', 'rvm'] as const) {
      const d = await dispatchGate({
        phone: '+15025550123', channel,
        consentBasis: 'manual-list-attested',
        coldOutbound: true, profileAllowsCold: false, now: noon,
      });
      expect((d as any).code).toBe('PROFILE_NO_COLD');
    }
  });

  it('INBOUND-driven send on a luxury lead (coldOutbound:false) processes normally', async () => {
    const d = await dispatchGate({
      phone: '+15025550123', channel: 'sms',
      coldOutbound: false, profileAllowsCold: false, now: noon,
    });
    expect(d.allow).toBe(true);
  });

  it('cold attempt on a profile that ALLOWS cold is not blocked', async () => {
    const d = await dispatchGate({
      phone: '+15025550123', channel: 'sms',
      coldOutbound: true, profileAllowsCold: true, now: noon,
    });
    expect(d.allow).toBe(true);
  });

  it('DNC still outranks the profile gate (opted-out luxury referral gets nothing)', async () => {
    mockSql.mockResolvedValue([{ 1: 1 }]); // suppressed
    const d = await dispatchGate({
      phone: '+15025550123', channel: 'sms',
      coldOutbound: true, profileAllowsCold: false, now: noon,
    });
    expect((d as any).code).toBe('DNC'); // not PROFILE_NO_COLD
  });
});
