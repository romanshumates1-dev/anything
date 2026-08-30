import crypto from 'node:crypto';

/**
 * Verifies a Documenso webhook signature.
 * Documenso uses HMAC-SHA256 with a hex digest.
 */
export function validateDocumensoSignature(input: {
  body: string;
  signature: string;
  secret: string;
}): boolean {
  if (!input.secret) {
    console.warn('[Documenso] Webhook secret is not configured.');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', input.secret)
    .update(input.body)
    .digest('hex');

  const signatureBuffer = Buffer.from(input.signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer);
}

/**
 * Verifies a DocuSign Connect webhook signature.
 * DocuSign uses HMAC-SHA256 with a base64 digest.
 * The signature is in the `X-DocuSign-Signature-1` header.
 */
export function validateDocusignSignature(input: {
  body: string;
  signature: string;
  secret: string;
}): boolean {
  if (!input.secret) {
    console.warn('[DocuSign] Webhook secret is not configured.');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', input.secret)
    .update(input.body)
    .digest('base64');

  const signatureBuffer = Buffer.from(input.signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer);
}
