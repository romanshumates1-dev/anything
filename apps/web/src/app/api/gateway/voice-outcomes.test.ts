/**
 * INT-2 completion — weighted mock outcomes feeding the EXISTING state machine.
 *
 * Owner spec: weighted answered/no-answer/voicemail; answered transcripts
 * include price-bearing lines; those route through the SAME requires_human
 * transitions SMS replies use (no voice-specific states invented).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn() }));
const { mockVoiceGate } = vi.hoisted(() => ({
  mockVoiceGate: vi.fn(async () => ({ allow: true as const, timezones: [] as string[] })),
}));
vi.mock('@/app/api/utils/dispatchGate', () => ({ dispatchGate: mockVoiceGate }));

import { MockVoiceDriver, VoiceGateway, VOICE_OUTCOME_WEIGHTS } from './voice-gateway';

beforeEach(() => {
  mockVoiceGate.mockReset();
  mockVoiceGate.mockResolvedValue({ allow: true, timezones: [] });
});

describe('MockVoiceDriver — weighted outcomes', () => {
  it('rng thresholds map to the declared weights (deterministic)', async () => {
    // weights: answered .40 | no_answer .35 | voicemail .25
    const at = async (r: number) =>
      (await new MockVoiceDriver({ rng: () => r }).dial({ leadId: 1, to: '+15025550101', channel: 'voice' })).outcome;
    expect(await at(0.05)).toBe('answered');
    expect(await at(0.39)).toBe('answered');
    expect(await at(0.41)).toBe('no_answer');
    expect(await at(0.74)).toBe('no_answer');
    expect(await at(0.76)).toBe('voicemail');
    expect(await at(0.99)).toBe('voicemail');
  });

  it('the declared weights sum to 1 (distribution is total)', () => {
    const sum = VOICE_OUTCOME_WEIGHTS.reduce((a, [, w]) => a + w, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it('answered calls carry a transcript; other outcomes never do', async () => {
    const answered = await new MockVoiceDriver({ forceOutcome: 'answered' }).dial({ leadId: 1, to: '+15025550101', channel: 'voice' });
    expect(answered.transcript).toBeTruthy();
    const missed = await new MockVoiceDriver({ forceOutcome: 'no_answer' }).dial({ leadId: 1, to: '+15025550101', channel: 'voice' });
    expect(missed.transcript).toBeUndefined();
  });

  it('outcome + transcript ride through VoiceGateway.call to the record', async () => {
    const gw = new VoiceGateway({
      primaryProvider: new MockVoiceDriver({ forceOutcome: 'answered', forceTranscript: "I'd take ninety for it" }),
    });
    const rec = await gw.call({ leadId: 1, to: '+15025550101', channel: 'voice', consentBasis: 'manual-list-attested' });
    expect(rec.outcome).toBe('answered');
    expect(rec.transcript).toBe("I'd take ninety for it");
  });
});
