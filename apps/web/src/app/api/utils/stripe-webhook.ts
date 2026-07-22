import crypto from 'node:crypto';

/**
 * Real Stripe webhook signature verification (no `stripe` SDK dependency —
 * this is the documented HMAC scheme: https://stripe.com/docs/webhooks#verify-manually).
 *
 * Header shape: `Stripe-Signature: t=<unix_ts>,v1=<hex_hmac>[,v1=<hex_hmac>...]`
 * (multiple v1 values occur during secret rotation — any match is valid).
 * Signed payload: `${timestamp}.${rawBody}`, HMAC-SHA256 with the webhook secret, hex digest.
 */

export interface StripeSignatureHeader {
  timestamp: number;
  v1Signatures: string[];
}

export function parseStripeSignatureHeader(header: string): StripeSignatureHeader | null {
  if (!header) return null;

  let timestamp: number | null = null;
  const v1Signatures: string[] = [];

  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const t = Number(value);
      if (Number.isFinite(t)) timestamp = t;
    } else if (key === 'v1' && value) {
      v1Signatures.push(value);
    }
  }

  if (timestamp === null || v1Signatures.length === 0) return null;
  return { timestamp, v1Signatures };
}

export function validateStripeSignature(input: {
  body: string;
  signatureHeader: string;
  secret: string;
  toleranceSeconds?: number;
  /** Injectable for tests; defaults to the real clock. */
  nowMs?: number;
}): boolean {
  const { body, signatureHeader, secret, toleranceSeconds = 300, nowMs = Date.now() } = input;
  if (!secret) return false;

  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed) return false;
  const { timestamp, v1Signatures } = parsed;

  // Replay protection: reject signatures whose timestamp has drifted too far
  // from now (either stale or clock-skewed forward) — same tolerance Stripe's
  // own SDK defaults to.
  const ageSeconds = Math.abs(nowMs / 1000 - timestamp);
  if (ageSeconds > toleranceSeconds) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected);

  return v1Signatures.some((sig) => {
    const sigBuf = Buffer.from(sig);
    // timingSafeEqual requires equal-length buffers; mismatched length = invalid
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}
