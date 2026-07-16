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
  /** Mock-only: the logged event for verification */
  mockEvent?: {
    wouldDial: boolean;
    reason: string;
    script?: string;
  };
}

export interface IVoiceProvider {
  name: string;
  dial(request: VoiceCallRequest): Promise<{ providerCallId: string; status: string }>;
  hangup(providerCallId: string): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }>;
}

/**
 * Mock Voice Driver — logs instead of dialing.
 * Used in verification to prove the seam works without real carrier calls.
 */
export class MockVoiceDriver implements IVoiceProvider {
  name = 'mock-voice';
  dialCount = 0;

  async dial(request: VoiceCallRequest): Promise<{ providerCallId: string; status: string }> {
    this.dialCount++;
    const providerCallId = `mock_${randomUUID().slice(0, 8)}`;
    console.log('[MockVoiceDriver] would dial', {
      to: request.to,
      channel: request.channel,
      script: request.script?.slice(0, 50),
      consentBasis: request.consentBasis,
    });
    return { providerCallId, status: 'queued' };
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

  async dial(request: VoiceCallRequest): Promise<{ providerCallId: string; status: string }> {
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

    try {
      const result = await this.config.primaryProvider.dial(request);

      await logEvent('voice_call_dispatched', 'voice', String(leadId), {
        callUuid,
        provider: this.config.primaryProvider.name,
        providerCallId: result.providerCallId,
        channel,
        to,
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
