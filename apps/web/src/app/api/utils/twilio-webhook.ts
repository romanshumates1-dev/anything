import crypto from 'node:crypto';

export function validateTwilioSignature(input: {
  url: string;
  signature: string;
  authToken: string;
  params: Record<string, string>;
}): boolean {
  const { url, signature, authToken, params } = input;

  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});

  const data = Object.entries(sorted)
    .map(([k, v]) => `${k}${v}`)
    .join('');

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(`${url}${data}`)
    .digest('base64');

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
