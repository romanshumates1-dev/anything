/**
 * P2.0-W — sendMessage (the NON-gateway transmit path) must be gated
 * identically to the gateway: this path runs when Twilio isn't configured or
 * the channel isn't 'sms', and an ungated fallback would mean a config
 * difference silently removes compliance.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { mockGate } = vi.hoisted(() => ({
  mockGate: vi.fn(async () => ({ allow: true as const, timezones: [] as string[] })),
}));
vi.mock('../dispatchGate', () => ({ dispatchGate: mockGate }));

const { mockConsent } = vi.hoisted(() => ({ mockConsent: vi.fn(async () => true) }));
vi.mock('../compliance', () => ({ checkConsent: mockConsent }));

vi.mock('../logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../execution-ledger', () => ({ recordRun: vi.fn(async () => {}) }));
// No Twilio, no SMS_PROVIDER_URL -> mock delivery path (no real transmit).
vi.mock('../twilio-adapter', () => ({ getTwilioClient: () => null, getTwilioConfig: () => null }));

import { sendMessage } from '../messaging';

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
  mockGate.mockReset();
  mockGate.mockResolvedValue({ allow: true, timezones: [] });
  mockConsent.mockReset();
  mockConsent.mockResolvedValue(true);
});

describe('sendMessage — universal gate on the fallback transmit path', () => {
  it('calls dispatchGate for an sms send and proceeds on allow', async () => {
    const r = await sendMessage({ leadId: 1, channel: 'sms', to: '+15025550101', text: 'hi' });
    expect(mockGate).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15025550101', channel: 'sms' })
    );
    expect(r.status).toBe('sent');
  });

  it('a gate denial suppresses the send and surfaces code + retryAt (no throw)', async () => {
    const retryAt = new Date('2026-07-17T14:00:00Z');
    mockGate.mockResolvedValue({
      allow: false, code: 'QUIET_HOURS', reason: 'outside hours', retryAt, timezones: [],
    });
    const r: any = await sendMessage({ leadId: 1, channel: 'sms', to: '+15025550101', text: 'held' });
    expect(r.status).toBe('suppressed');
    expect(r.gateCode).toBe('QUIET_HOURS');
    expect(r.retryAt).toEqual(retryAt);
    expect(mockConsent).not.toHaveBeenCalled(); // denied before any further work
  });

  it('email sends do NOT pass the sms gate (spec covers sms/voice/rvm only)', async () => {
    await sendMessage({ leadId: 1, channel: 'email', to: 'a@b.co', text: 'hi' });
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockConsent).toHaveBeenCalledWith('a@b.co', 'email'); // legacy check remains
  });
});
