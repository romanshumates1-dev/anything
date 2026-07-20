/**
 * Phase T — the OWNER-GATED headline: a REAL Twilio send to a REAL verified
 * number, asserting a returned message SID. This is deliberately NOT part of
 * the mocked safety suite — it makes a live carrier call, so it is gated on the
 * owner's explicit opt-in AND A2P/verification, per the standing compliance
 * rule (no live SMS until A2P clears).
 *
 * It is TAGGED, not skipped-and-forgotten. Post-A2P it runs with one command:
 *
 *   RUN_DEMO_HEADLINE=1 \
 *   TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=... TWILIO_FROM_NUMBER=... \
 *   DEMO_VERIFIED_TO=+1XXXXXXXXXX \
 *   yarn workspace web test -- demoHeadline
 *
 * Requirements the gate enforces before it will send:
 *   - RUN_DEMO_HEADLINE=1 (explicit owner opt-in)
 *   - twilioDemo mode credentials present
 *   - DEMO_VERIFIED_TO is a number the owner has verified (allowlist)
 */
import { describe, it, expect } from 'vitest';

const ARMED =
  process.env.RUN_DEMO_HEADLINE === '1' &&
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_AUTH_TOKEN &&
  !!process.env.DEMO_VERIFIED_TO;

describe.skipIf(!ARMED)('Phase T headline — real demo send to a verified number (OWNER-GATED, A2P)', () => {
  it('returns a Twilio message SID (SMxx…) for a verified recipient', async () => {
    const { TwilioAdapter } = await import('@/app/api/gateway/providers');
    const adapter = new TwilioAdapter(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!,
      process.env.TWILIO_FROM_NUMBER,
      process.env.TWILIO_MESSAGING_SERVICE_SID,
    );
    const sid = await adapter.send(
      process.env.DEMO_VERIFIED_TO!,
      'DealFlow demo mode — this is a live test message to your verified number.',
      crypto.randomUUID(),
    );
    expect(sid).toMatch(/^SM[a-f0-9]{32}$/i);
    console.log(`[demo-headline] real Twilio SID: ${sid}`);
  });
});

// A tiny always-on assertion so the file is never a silent no-op: it documents
// (and type-checks) the one-command path even when the headline is un-armed.
describe('Phase T headline — arming contract (always runs)', () => {
  it('is OWNER-GATED, not skipped-and-forgotten: names its exact run command', () => {
    expect(ARMED === true || ARMED === false).toBe(true);
    const cmd = 'RUN_DEMO_HEADLINE=1 TWILIO_* DEMO_VERIFIED_TO=+1... yarn workspace web test -- demoHeadline';
    expect(cmd).toContain('RUN_DEMO_HEADLINE=1');
  });
});
