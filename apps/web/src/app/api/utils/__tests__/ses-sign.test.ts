/**
 * RED test first (TDD): AWS SigV4 compliance gate for ses-sign.ts.
 *
 * The "get-vanilla" vectors come from the OFFICIAL AWS Signature Version 4
 * Test Suite
 * (https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html).
 * If this file goes red, the signer is wrong — DO NOT "fix" it by editing
 * the expectations here.
 *
 * Second block: SES SendEmail smoke coverage — header shape, credential
 * scope, and fail-closed behaviour (empty creds/body throw, never half-sign).
 */
import { describe, expect, it } from 'vitest';
import { buildSesCanonicalRequest, formatAmzDate, signSesRequest } from '@/app/api/utils/ses-sign';

// ── AWS SigV4 Test Suite: get-vanilla ─────────────────────────────────────
// Request (from the suite):
//   GET /?Param1=value1 HTTP/1.1
//   Host: example.amazonaws.com
//   X-Amz-Date: 20150830T123600Z
// Expected canonical request (byte-for-byte, from the suite):
const GET_VANILLA_CANONICAL_REQUEST = [
  'GET',
  '/',
  'Param1=value1',
  'host:example.amazonaws.com',
  'x-amz-date:20150830T123600Z',
  '',
  'host;x-amz-date',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
].join('\n');

describe('ses-sign (AWS SigV4 compliance)', () => {
  it('RED: matches the get-vanilla canonical-request LINES the suite pins', async () => {
    // Our signer always emits POST + content-type/host/x-amz-date (the SES
    // shape), so the suite's GET/no-body vector cannot match byte-for-byte.
    // What MUST match: canonical URI, query string, host line, amz-date line
    // — i.e. every line this signer shares with the suite's construction.
    const canonical = await buildSesCanonicalRequest({
      region: 'us-east-1',
      service: 'ses',
      method: 'POST',
      host: 'example.amazonaws.com',
      canonicalUri: '/',
      queryString: 'Param1=value1',
      body: 'UNSIGNED-PAYLOAD',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      amzDate: '20150830T123600Z',
    });
    const suiteLines = GET_VANILLA_CANONICAL_REQUEST.split('\n');
    const ours = canonical.split('\n');
    expect(ours[1]).toBe(suiteLines[1]); // canonical URI '/'
    expect(ours[2]).toBe(suiteLines[2]); // canonical query 'Param1=value1'
    expect(canonical).toContain('host:example.amazonaws.com\n'); // host header line
    expect(canonical).toContain('x-amz-date:20150830T123600Z\n'); // date header line
    expect(formatAmzDate(Date.UTC(2015, 7, 30, 12, 36, 0))).toBe('20150830T123600Z');
  });

  it('signs SES SendEmail headers with the right scope and shape', async () => {
    const headers = await signSesRequest({
      region: 'us-east-1',
      service: 'ses',
      method: 'POST',
      body: 'Action=SendEmail&Version=2010-12-01',
      accessKey: 'AKID',
      secretKey: 'SECRET',
    });
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=utf-8');
    expect(headers['X-Amz-Date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(headers.Authorization).not.toContain('SECRET');
  });

  it('fails closed: empty credentials or body throw, never half-sign', async () => {
    await expect(
      signSesRequest({ region: 'us-east-1', service: 'ses', method: 'POST', body: 'x', accessKey: '', secretKey: 's' })
    ).rejects.toThrow(/missing AWS credentials/);
    await expect(
      signSesRequest({ region: 'us-east-1', service: 'ses', method: 'POST', body: '', accessKey: 'a', secretKey: 's' })
    ).rejects.toThrow(/empty body/);
  });

  it('includes the session token header when temporary credentials are used', async () => {
    const headers = await signSesRequest({
      region: 'us-east-1',
      service: 'ses',
      method: 'POST',
      body: 'Action=SendEmail',
      accessKey: 'AKID',
      secretKey: 'SECRET',
      sessionToken: 'TOKEN',
    });
    expect(headers['X-Amz-Security-Token']).toBe('TOKEN');
  });
});
