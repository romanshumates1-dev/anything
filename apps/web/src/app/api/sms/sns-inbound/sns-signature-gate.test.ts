/**
 * SECURITY REGRESSION — SNS webhook signature verification is FAIL-CLOSED.
 *
 * The original gate was `if (!process.env.AWS_SNS_VERIFY_SIGNATURES ||
 * process.env.AWS_SNS_VERIFY_SIGNATURES === 'false') return true;` — an UNSET
 * variable silently disabled verification, letting anyone POST a forged SNS
 * Notification and inject inbound SMS (opt-outs, negotiation jobs). .env.example
 * and DEPLOY.md document the default as `true`; these tests pin the code to
 * that contract. (The destination-routing tests in route.test.ts explicitly set
 * AWS_SNS_VERIFY_SIGNATURES=false for their own module context.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';

function snsReq(message: unknown): Request {
  return new Request('http://t/api/sms/sns-inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message),
  });
}

/** A forged notification whose SigningCertURL cannot pass the cert-URL pattern. */
function forgedNotification(overrides: Record<string, unknown> = {}) {
  return {
    Type: 'Notification',
    Message: JSON.stringify({
      originationNumber: '+15025550000',
      messageBody: 'STOP',
      inboundMessageId: 'smi_forged_1',
    }),
    MessageId: 'msg-forged-1',
    TopicArn: 'arn:aws:sns:us-east-1:000000000000:fake',
    Signature: 'Zm9yZ2Vk',
    SigningCertURL: 'https://evil.example.com/cert.pem',
    ...overrides,
  };
}

describe('POST /api/sms/sns-inbound — signature gate (fail-closed default)', () => {
  beforeEach(() => {
    delete process.env.AWS_SNS_VERIFY_SIGNATURES;
  });
  afterEach(() => {
    delete process.env.AWS_SNS_VERIFY_SIGNATURES;
  });

  it('verifies by default (env unset) and rejects a forged notification with 403', async () => {
    const res = await POST(snsReq(forgedNotification()));
    expect(res.status).toBe(403);
  });

  it('rejects a forged SubscriptionConfirmation with 403 by default', async () => {
    const res = await POST(
      snsReq(
        forgedNotification({
          Type: 'SubscriptionConfirmation',
          SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription',
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it('rejects a forged notification when verification is explicitly enabled', async () => {
    process.env.AWS_SNS_VERIFY_SIGNATURES = 'true';
    const res = await POST(snsReq(forgedNotification()));
    expect(res.status).toBe(403);
  });

  it('explicit opt-out (AWS_SNS_VERIFY_SIGNATURES=false) skips signature checks only', async () => {
    process.env.AWS_SNS_VERIFY_SIGNATURES = 'false';
    // Signature stage passes; the request then fails later validation
    // (unparseable Message -> 400) WITHOUT touching the database.
    const res = await POST(snsReq(forgedNotification({ Message: 'not-json' })));
    expect(res.status).toBe(400);
  });
});
