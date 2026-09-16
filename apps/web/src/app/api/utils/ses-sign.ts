/**
 * Minimal AWS Signature Version 4 signer for the SES Query API over HTTPS.
 *
 * WHY A HAND-ROLLED SIGNER (not the AWS SDK):
 * The SES HTTPS path exists FOR Cloudflare Workers, and the Workers bundle
 * is exactly where dependency weight hurts most (free-plan size pressure per
 * import chain). SigV4 for one fixed POST shape is ~60 lines of WebCrypto
 * (async, available in workerd AND Node 20+) with zero new dependencies.
 * The full `@aws-sdk/client-ses` chain was evaluated and deliberately NOT
 * used here — it duplicates the credential env vars for no behavioural gain
 * on this single-action call.
 *
 * SCOPE: SES SendEmail via the Query protocol ONLY (POST /, form-encoded
 * Action=SendEmail). Not a general SigV4 library — do not reuse for other
 * services without reviewing their canonical-request rules.
 *
 * CORRECTNESS GATE: apps/web/src/app/api/utils/__tests__/ses-sign.test.ts
 * pins the canonical-request shape against the AWS SigV4 Test Suite
 * ("get-vanilla") plus SES header-shape and fail-closed cases. Run:
 *   yarn workspace web test -- ses-sign
 * If those tests go red, the signer is wrong — DO NOT "fix" it by editing
 * the expectations. Recompute by hand against
 * https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 */

export interface SesSignInput {
  region: string;
  service: string;
  method: 'POST';
  host?: string;
  canonicalUri?: string;
  queryString?: string;
  body: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  /** Injectable clock (milliseconds) — tests pin this for determinism. */
  nowMs?: number;
}

const encoder = new TextEncoder();

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(sig);
}

/**
 * Build the SigV4 canonical request for an SES Query-API POST.
 * Exported so the test suite can assert it byte-for-byte.
 */
export async function buildSesCanonicalRequest(input: SesSignInput & { amzDate: string }): Promise<string> {
  const {
    body,
    host = `email.${input.region}.amazonaws.com`,
    canonicalUri = '/',
    queryString = '',
  } = input;
  const payloadHash = await sha256Hex(body);
  const signedHeaders = 'content-type;host;x-amz-date';
  return [
    'POST',
    canonicalUri,
    queryString,
    `content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:${host}\nx-amz-date:${input.amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');
}

/** Format a millisecond clock as SigV4 x-amz-date (YYYYMMDDTHHMMSSZ). Exported for tests. */
export function formatAmzDate(nowMs: number): string {
  return new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Sign an SES Query-API POST and return the headers fetch() needs.
 *
 * Signs the EXACT bytes passed as `body` (payload hash) with an explicit
 * x-amz-date, targeting host email.{region}.amazonaws.com by default.
 * Throws on empty credentials/body — a half-signed request to AWS is never
 * worth sending.
 */
export async function signSesRequest(input: SesSignInput): Promise<Record<string, string>> {
  const {
    region,
    service,
    body,
    accessKey,
    secretKey,
    sessionToken,
    host = `email.${region}.amazonaws.com`,
    queryString = '',
    nowMs = Date.now(),
  } = input;
  if (!accessKey || !secretKey) throw new Error('signSesRequest: missing AWS credentials');
  if (!body) throw new Error('signSesRequest: empty body — refusing to sign');

  const amzDate = formatAmzDate(nowMs);
  const dateStamp = amzDate.slice(0, 8);

  const canonicalRequest = await buildSesCanonicalRequest({ ...input, host, amzDate });

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signatureBytes = await hmacSha256(kSigning, stringToSign);
  const signature = [...signatureBytes].map((b) => b.toString(16).padStart(2, '0')).join('');

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    'X-Amz-Date': amzDate,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=content-type;host;x-amz-date, Signature=${signature}`,
  };
  if (sessionToken) headers['X-Amz-Security-Token'] = sessionToken;
  // queryString is part of the canonical request when present (SigV4 test
  // vectors); it is not sent as a header, so mark it read explicitly.
  void queryString;
  return headers;
}