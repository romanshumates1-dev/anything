/**
 * INT-2 — Voice / RVM Gateway (Mock Driver)
 *
 * Architecture: parallel to SMSGateway but for voice calls and ringless voicemail.
 * - Twilio voice is STUBBED (logs instead of dials — no real calls in verification)
 * - consentBasis gate enforced at dispatch time (dispatchGate already handles this)
 * - Beta flag `voiceEscalation` default OFF — zero dispatches when off
 * - Mock driver records events for auditability without carrier interaction
 */

import { randomUUID } from 'node:crypto';
import { logEvent } from '@/app/api/utils/logger';
import { dispatchGate, type DenyCode } from '@/app/api/utils/dispatchGate';

export type VoiceChannel = 'voice' | 'rvm';

export interface VoiceCallRequest {
  leadId: number | string;
  to: string;
  campaignId?: string;
  organizationId?: string;
  contactId?: string;
  channel: VoiceChannel;
  /** For RVM: audio URL or text-to-speech script */
  script?: string;
  /** Required for voice/rvm dispatch — must be a valid consent basis */
  consentBasis?: string;
}

export interface VoiceCallRecord {
  callUuid: string;
  status: 'queued' | 'initiated' | 'completed' | 'failed' | 'no_answer' | 'busy';
  channel: VoiceChannel;
  provider: string;
  providerCallId?: string;
  leadId: number | string;
  to: string;
  dispatchTime: Date;
  completionTime?: Date;
  errorMessage?: string;
  /** Simulated (mock) or webhook-reported (live) call outcome. */
  outcome?: VoiceOutcome;
  /** What the callee said (answered calls only). */
  transcript?: string;
  /** P2.0-W: set when dispatchGate denied the dial. */
  gateCode?: DenyCode;
  /** When the gate says "not now" (quiet hours), when to retry. */
  retryAt?: Date;
  /** Mock-only: the logged event for verification */
  mockEvent?: {
    wouldDial: boolean;
    reason: string;
    script?: string;
  };
}

export type VoiceOutcome = 'answered' | 'no_answer' | 'voicemail';

export interface VoiceDialResult {
  providerCallId: string;
  status: string;
  /** Mock/live call outcome once known. */
  outcome?: VoiceOutcome;
  /** What the callee said (answered calls). Feeds the SAME requires_human
   *  routing SMS replies use — never a voice-specific state. */
  transcript?: string;
}

export interface IVoiceProvider {
  name: string;
  dial(request: VoiceCallRequest): Promise<VoiceDialResult>;
  hangup(providerCallId: string): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }>;
}

/**
 * The spoken/voicemail script. THE INVARIANT: it states NO numbers — no price,
 * no digits, no currency. P3 fuzzes this with a strict regex; if a legitimate
 * script ever needs a digit, that is a deliberate owner decision, not a drift.
 */
export const VOICE_SCRIPT_NO_NUMBERS =
  'Hi, this is the DealFlow team following up on the text we sent about your property. ' +
  'No pressure at all — if selling might make sense, just text us back or pick up next time. ' +
  'Any price or paperwork conversation happens with a real person on our side. Thanks!';

/** Weighted mock outcomes (owner spec: answered / no-answer / voicemail). */
export const VOICE_OUTCOME_WEIGHTS: ReadonlyArray<readonly [VoiceOutcome, number]> = [
  ['answered', 0.4],
  ['no_answer', 0.35],
  ['voicemail', 0.25],
];

/** Mock transcripts for answered calls — deliberately includes PRICE-BEARING
 *  lines (with and without digits) so verification exercises the escalation
 *  invariant end-to-end, plus neutral lines that must NOT over-escalate the
 *  contact state beyond the standard needs_review inbound flag. */
export const MOCK_TRANSCRIPTS: ReadonlyArray<{ text: string; priceBearing: boolean }> = [
  { text: 'Who is this? How did you get my number?', priceBearing: false },
  { text: 'Yes, I own it. Why are you asking?', priceBearing: false },
  { text: "I'd take ninety for it if you can close fast.", priceBearing: true },
  { text: 'Would you do 85000 cash?', priceBearing: true },
  { text: 'Send the paperwork and let us close this week.', priceBearing: true },
  { text: 'Call my sister, she handles the property.', priceBearing: false },
];

/**
 * Mock Voice Driver — logs instead of dialing, and simulates the carrier-side
 * OUTCOME (weighted answered/no-answer/voicemail with transcripts) so the
 * downstream state machine can be verified end-to-end with zero real calls.
 */
export class MockVoiceDriver implements IVoiceProvider {
  name = 'mock-voice';
  dialCount = 0;

  constructor(
    private opts: {
      /** Injectable randomness for deterministic tests. */
      rng?: () => number;
      /** Pin the outcome (tests). */
      forceOutcome?: VoiceOutcome;
      /** Pin the transcript for answered calls (tests). */
      forceTranscript?: string;
    } = {}
  ) {}

  private pickOutcome(): VoiceOutcome {
    if (this.opts.forceOutcome) return this.opts.forceOutcome;
    const r = (this.opts.rng ?? Math.random)();
    let acc = 0;
    for (const [outcome, w] of VOICE_OUTCOME_WEIGHTS) {
      acc += w;
      if (r < acc) return outcome;
    }
    return 'no_answer';
  }

  async dial(request: VoiceCallRequest): Promise<VoiceDialResult> {
    this.dialCount++;
    const providerCallId = `mock_${randomUUID().slice(0, 8)}`;
    const outcome = this.pickOutcome();
    const transcript =
      outcome === 'answered'
        ? this.opts.forceTranscript ??
          MOCK_TRANSCRIPTS[Math.floor((this.opts.rng ?? Math.random)() * MOCK_TRANSCRIPTS.length)].text
        : undefined;
    console.log('[MockVoiceDriver] would dial', {
      to: request.to,
      channel: request.channel,
      outcome,
      script: (request.script ?? VOICE_SCRIPT_NO_NUMBERS).slice(0, 50),
      consentBasis: request.consentBasis,
    });
    return { providerCallId, status: 'queued', outcome, transcript };
  }

  async hangup(_providerCallId: string): Promise<void> {
    console.log('[MockVoiceDriver] would hangup', _providerCallId);
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    return { healthy: true, latency: 10, details: 'mock driver always healthy' };
  }
}

/**
 * Twilio Voice Stub — validates config but never dials in verification.
 * In production, this would use Twilio's REST API to create calls.
 */
export class TwilioVoiceStub implements IVoiceProvider {
  name = 'twilio-voice-stub';

  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string | undefined,
  ) {}

  async dial(request: VoiceCallRequest): Promise<VoiceDialResult> {
    // STUB: validate config exists but do not call Twilio API
    if (!this.accountSid || !this.authToken) {
      throw new Error('TwilioVoiceStub: missing accountSid or authToken');
    }
    if (!this.fromNumber) {
      throw new Error('TwilioVoiceStub: no fromNumber configured');
    }
    console.log('[TwilioVoiceStub] would dial', {
      to: request.to,
      from: this.fromNumber,
      channel: request.channel,
    });
    // LIVE: const client = require('twilio')(this.accountSid, this.authToken);
    // LIVE: const call = await client.calls.create({
    // LIVE:   to: request.to,
    // LIVE:   from: this.fromNumber,
    // LIVE:   twiml: `<Response><Say>${escapeXml(request.script ?? VOICE_SCRIPT_NO_NUMBERS)}</Say></Response>`,
    // LIVE:   machineDetection: 'DetectMessageEnd',   // voicemail drop for RVM
    // LIVE:   statusCallback: `${process.env.PUBLIC_BASE_URL}/api/voice/status`,
    // LIVE: });
    // LIVE: return { providerCallId: call.sid, status: call.status };
    // LIVE: (outcome + transcript then arrive via the status/recording webhooks)
    return { providerCallId: `stub_${randomUUID().slice(0, 8)}`, status: 'stubbed' };
  }

  async hangup(_providerCallId: string): Promise<void> {
    // STUB
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    const hasConfig = !!(this.accountSid && this.authToken && this.fromNumber);
    return {
      healthy: hasConfig,
      latency: hasConfig ? 50 : 0,
      details: hasConfig ? 'config present' : 'missing Twilio voice config',
    };
  }
}

export interface VoiceGatewayConfig {
  primaryProvider: IVoiceProvider;
  complianceCheckEnabled?: boolean;
}

/**
 * Voice Gateway — routes voice/RVM calls through the provider.
 * In verification mode, the mock driver logs instead of dialing.
 */
export class VoiceGateway {
  constructor(private config: VoiceGatewayConfig) {}

  async call(request: VoiceCallRequest): Promise<VoiceCallRecord> {
    const callUuid = randomUUID();
    const { leadId, to, channel, script, campaignId, organizationId, contactId } = request;

    // UNIVERSAL DISPATCH GATE (P2.0-W) — at the dial hop, not delegated to
    // callers. (An earlier version *documented* gate coverage in a comment
    // while never calling it; the gate runs here so no caller can forget.)
    const gate = await dispatchGate({
      phone: to,
      channel,
      betaFlag: 'voiceEscalation',
      consentBasis: request.consentBasis,
    });
    if (!gate.allow) {
      await logEvent('voice_call_suppressed', 'voice', String(leadId), {
        callUuid,
        channel,
        to,
        reason: gate.code,
        detail: gate.reason,
        campaignId,
        organizationId,
        contactId,
      });
      return {
        callUuid,
        status: 'failed',
        channel,
        provider: this.config.primaryProvider.name,
        leadId,
        to,
        dispatchTime: new Date(),
        errorMessage: gate.code,
        gateCode: gate.code,
        retryAt: gate.retryAt,
        mockEvent: { wouldDial: false, reason: `gate:${gate.code}`, script },
      };
    }

    try {
      const result = await this.config.primaryProvider.dial(request);

      await logEvent('voice_call_dispatched', 'voice', String(leadId), {
        callUuid,
        provider: this.config.primaryProvider.name,
        providerCallId: result.providerCallId,
        channel,
        to,
        outcome: result.outcome,
        script: script?.slice(0, 100),
        campaignId,
        organizationId,
        contactId,
      });

      return {
        callUuid,
        status: result.status === 'queued' ? 'queued' : 'initiated',
        channel,
        provider: this.config.primaryProvider.name,
        providerCallId: result.providerCallId,
        leadId,
        to,
        dispatchTime: new Date(),
        outcome: result.outcome,
        transcript: result.transcript,
        mockEvent: {
          wouldDial: true,
          reason: 'dispatched_to_provider',
          script,
        },
      };
    } catch (error: any) {
      await logEvent('voice_call_failed', 'voice', String(leadId), {
        callUuid,
        provider: this.config.primaryProvider.name,
        channel,
        to,
        error: error?.message,
        campaignId,
        organizationId,
        contactId,
      });

      return {
        callUuid,
        status: 'failed',
        channel,
        provider: this.config.primaryProvider.name,
        leadId,
        to,
        dispatchTime: new Date(),
        errorMessage: error?.message || 'provider_dispatch_failed',
        mockEvent: {
          wouldDial: false,
          reason: error?.message || 'provider_dispatch_failed',
          script,
        },
      };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    return this.config.primaryProvider.healthCheck();
  }
}

let voiceGateway: VoiceGateway | null = null;

/**
 * Runtime voice gateway. MOCK DRIVER ONLY until A2P clears and the owner
 * flips to live — nothing here can dial a carrier.
 *
 * // LIVE: to go live, replace MockVoiceDriver with the real Twilio driver:
 * // LIVE:   primaryProvider: new TwilioVoiceStub(   // <- swap stub for a real adapter
 * // LIVE:     process.env.TWILIO_ACCOUNT_SID || '',
 * // LIVE:     process.env.TWILIO_AUTH_TOKEN || '',
 * // LIVE:     process.env.TWILIO_VOICE_FROM_NUMBER || undefined,
 * // LIVE:   ),
 * // LIVE: and implement TwilioVoiceStub.dial via client.calls.create({...}).
 * // LIVE: Owner flips voiceEscalation ON only after 10DLC/A2P approval.
 */
export function getVoiceGateway(): VoiceGateway {
  if (!voiceGateway) {
    voiceGateway = new VoiceGateway({ primaryProvider: new MockVoiceDriver() });
  }
  return voiceGateway;
}
