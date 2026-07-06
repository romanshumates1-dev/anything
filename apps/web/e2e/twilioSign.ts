import crypto from 'crypto';

/**
 * Compute a valid Twilio webhook signature (HMAC-SHA1 of url + sorted
 * key+value concatenation, base64) — the "test signature path" for driving the
 * inbound SMS webhook exactly as Twilio would, so signature validation passes.
 */
export function twilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string
): string {
  const data = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return crypto.createHmac('sha1', authToken).update(`${url}${data}`).digest('base64');
}
