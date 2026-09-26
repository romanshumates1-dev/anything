/**
 * SECURITY REGRESSION — legacy duplicate webhook must stay authenticated.
 *
 * `/api/inbound/sms` used to be an UNAUTHENTICATED duplicate of the canonical
 * `/api/sms/inbound`: signature validation only ran when the caller chose to
 * send X-Twilio-Signature, so omitting the header processed inbound SMS,
 * flipped lead statuses and enqueued negotiation jobs (Finding-class:
 * fail-open auth + cross-tenant lead pick). It is now a pure delegate; these
 * tests prove the canonical gates apply through the legacy path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from './route';

const SECRET = 'legacy-shim-test-secret-123';

function jsonReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://t/api/inbound/sms', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/inbound/sms (legacy shim)', () => {
  let savedSecret: string | undefined;
  beforeEach(() => {
    savedSecret = process.env.SMS_INBOUND_SECRET;
    process.env.SMS_INBOUND_SECRET = SECRET;
  });
  afterEach(() => {
    if (savedSecret === undefined) delete process.env.SMS_INBOUND_SECRET;
    else process.env.SMS_INBOUND_SECRET = savedSecret;
  });

  it('rejects an unauthenticated JSON post with 401 (no more fail-open)', async () => {
    const res = await POST(jsonReq({ from: '+15025550000', text: 'interested' }));
    expect(res.status).toBe(401);
  });

  it('rejects a WRONG secret with 401', async () => {
    const res = await POST(
      jsonReq({ from: '+15025550000', text: 'interested' }, { 'x-sms-secret': 'wrong' })
    );
    expect(res.status).toBe(401);
  });

  it('rejects an EMPTY secret header even when the env secret is set', async () => {
    const res = await POST(
      jsonReq({ from: '+15025550000', text: 'interested' }, { 'x-sms-secret': '' })
    );
    expect(res.status).toBe(401);
  });

  it('passes the auth gate with the correct secret (400 = authenticated but invalid body)', async () => {
    // No from/text: canonical validation answers AFTER the auth gate and
    // BEFORE any database access — proves the gate opened without needing a DB.
    const res = await POST(jsonReq({}, { 'x-sms-secret': SECRET }));
    expect(res.status).toBe(400);
  });

  it('fails closed when the env secret itself is unset (empty != credential)', async () => {
    const saved = process.env.SMS_INBOUND_SECRET;
    delete process.env.SMS_INBOUND_SECRET;
    try {
      const res = await POST(jsonReq({ from: '+15025550000', text: 'hi' }));
      expect(res.status).toBe(401);
    } finally {
      if (saved !== undefined) process.env.SMS_INBOUND_SECRET = saved;
    }
  });
});
