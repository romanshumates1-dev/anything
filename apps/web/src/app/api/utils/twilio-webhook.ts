import crypto from 'node:crypto';

/**
 * The canonical Twilio signature over a request: HMAC-SHA1(authToken) of
 * `url` + each param sorted-by-key and concatenated `k1v1k2v2…`, base64.
 * ONE implementation so the signer and verifier can never diverge.
 */
export function signTwilioRequest(input: {
  url: string;
  authToken: string;
  params: Record<string, string>;
}): string {
  const { url, authToken, params } = input;
  const data = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return crypto.createHmac('sha1', authToken).update(`${url}${data}`).digest('base64');
}

export function validateTwilioSignature(input: {
  url: string;
  signature: string;
  authToken: string;
  params: Record<string, string>;
}): boolean {
  const { url, signature, authToken, params } = input;

  const expected = signTwilioRequest({ url, authToken, params });

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  // timingSafeEqual requires equal-length buffers; mismatched length = invalid
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Canonical public URL Twilio should POST delivery-status callbacks to, and the
 * exact URL the status route re-derives to verify the signature. Both the send
 * side (TwilioAdapter, telling Twilio where to call) and the receive side (the
 * /api/sms/status route, verifying) MUST derive it identically or every
 * signature fails. Returns null when no public URL is configured (mock/local:
 * no callback is requested and none is expected).
 */
export function twilioStatusCallbackUrl(): string | null {
  const explicit = process.env.TWILIO_STATUS_CALLBACK_URL;
  if (explicit) return explicit;
  const base = process.env.PUBLIC_WEBHOOK_URL;
  if (!base) return null;
  try {
    // Preserve the public origin, replace the path — works whether
    // PUBLIC_WEBHOOK_URL is an origin or the full inbound webhook URL.
    return new URL('/api/sms/status', base).toString();
  } catch {
    return null;
  }
}
