/**
 * MockSmsProvider (Part B, Mode 1) — the zero-cost provider injected into the
 * REAL SMSGateway when SMS_MODE=mock. It implements the exact ISMSProvider
 * contract, so the gateway (circuit breakers, idempotency, dispatchGate,
 * message_events) runs unchanged; only the transport is simulated.
 *
 * On send it returns a realistic SID (`SM` + 32 hex) and records an observable
 * event. Delivery-status progression is driven separately by
 * `simulateDeliveryProgression`, which HTTP-POSTs signed callbacks to the app's
 * own /api/sms/status route — exercising the REAL signature verification and the
 * REAL status handler. No part of the pipeline is bypassed.
 */
import crypto from 'node:crypto';

import { logEvent } from '@/app/api/utils/logger';
import { signTwilioRequest, twilioStatusCallbackUrl } from '@/app/api/utils/twilio-webhook';
import { mockSmsAuthToken } from '@/app/api/utils/sms-mode';
import type { DeliveryStatus, ISMSProvider, ProviderNormalizedEvent } from './providers';

const MOCK_STATUS_MAP: Record<string, DeliveryStatus> = {
  queued: 'queued',
  sent: 'sent',
  delivered: 'delivered',
  undelivered: 'undelivered',
  failed: 'failed',
};

export class MockSmsProvider implements ISMSProvider {
  name = 'mock';

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async send(to: string, _text: string, messageUuid: string, from?: string): Promise<string> {
    const sid = `SM${crypto.randomBytes(16).toString('hex')}`; // SM + 32 hex, like Twilio
    await logEvent('mock_sms_sent', 'message', messageUuid, { to, from, sid });
    return sid;
  }

  async getDeliveryStatus(): Promise<DeliveryStatus> {
    return 'delivered';
  }

  validateWebhook(body: any): boolean {
    return !!body.MessageSid;
  }

  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null {
    if (!body.MessageSid) return null;
    return {
      messageId: body.MessageSid,
      status: (MOCK_STATUS_MAP[body.MessageStatus] || 'sent') as DeliveryStatus,
      timestamp: new Date(),
      errorCode: body.ErrorCode,
      errorMessage: body.ErrorMessage,
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; details?: string }> {
    return { healthy: true, latency: 1, details: 'mock' };
  }
}

export type StatusCallbackRequest = {
  url: string;
  params: Record<string, string>;
  signature: string;
};

/** Build one signed status callback (params + a valid X-Twilio-Signature over
 *  the mock auth token) for the given SID/status. */
export function buildMockStatusCallback(opts: {
  sid: string;
  to: string;
  status: string;
  errorCode?: string;
}): StatusCallbackRequest {
  const url = twilioStatusCallbackUrl() || 'http://localhost:4000/api/sms/status';
  const params: Record<string, string> = {
    MessageSid: opts.sid,
    MessageStatus: opts.status,
    To: opts.to,
    From: '+15005550006',
    AccountSid: 'ACmock00000000000000000000000000000',
  };
  if (opts.errorCode) params.ErrorCode = opts.errorCode;
  const signature = signTwilioRequest({ url, authToken: mockSmsAuthToken(), params });
  return { url, params, signature };
}

/** Default deliverer: actually HTTP-POST the signed callback to the app's own
 *  status route (form-encoded, X-Twilio-Signature header) — no bypass. */
export async function httpDeliver(req: StatusCallbackRequest): Promise<void> {
  await fetch(req.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': req.signature,
    },
    body: new URLSearchParams(req.params).toString(),
  });
}

/**
 * Simulate a queued→sent→delivered (or custom) progression for a mock message.
 * `deliver` is injectable: production/staging uses `httpDeliver`; unit tests
 * pass the status route's POST handler directly to prove the loop in-process.
 */
export async function simulateDeliveryProgression(opts: {
  sid: string;
  to: string;
  statuses?: string[];
  errorCode?: string;
  deliver?: (req: StatusCallbackRequest) => Promise<void>;
}): Promise<void> {
  const deliver = opts.deliver || httpDeliver;
  const statuses = opts.statuses || ['queued', 'sent', 'delivered'];
  for (const status of statuses) {
    const isError = status === 'failed' || status === 'undelivered';
    await deliver(buildMockStatusCallback({ sid: opts.sid, to: opts.to, status, errorCode: isError ? opts.errorCode : undefined }));
  }
}
