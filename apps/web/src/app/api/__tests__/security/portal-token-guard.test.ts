/**
 * Portal link signature gate (2026-09-26).
 *
 * Background: /api/portal/offer previously accepted a bare `?leadId=` for any lead
 * and treated unsigned base64url("leadId:action:ts") as a "valid" token, allowing
 * anonymous reads and mutations of other tenants' offers. These tests pin the
 * replacement: HMAC-signed tokens, action/lead binding, expiry, fail-closed when
 * no signing secret exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signPortalToken, verifyPortalToken } from '@/app/api/utils/portalToken';

const SECRET = 'test-portal-secret-value-1234567890';

describe('portal token signing', () => {
  beforeEach(() => {
    vi.stubEnv('PORTAL_TOKEN_SECRET', SECRET);
    vi.stubEnv('CRON_SECRET', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a signed token with leadId and action', () => {
    const token = signPortalToken('lead-42', 'accept');
    expect(token).toBeTruthy();
    expect(token).toContain('.');

    const parsed = verifyPortalToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.leadId).toBe('lead-42');
    expect(parsed!.action).toBe('accept');
  });

  it('rejects the legacy unsigned token format', () => {
    const legacy = Buffer.from(`lead-42:accept:${Date.now()}`).toString('base64url');
    expect(verifyPortalToken(legacy)).toBeNull();
  });

  it('rejects a forged token whose payload was rewritten (signature mismatch)', () => {
    const token = signPortalToken('lead-42', 'accept')!;
    const [, sig] = token.split('.');
    const forgedPayload = Buffer.from(`lead-99:accept:${Date.now()}`).toString('base64url');
    expect(verifyPortalToken(`${forgedPayload}.${sig}`)).toBeNull();
  });

  it('rejects a token whose signature was tampered with', () => {
    const token = signPortalToken('lead-42', 'accept')!;
    const [payload] = token.split('.');
    expect(verifyPortalToken(`${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).toBeNull();
  });

  it('rejects stale links (older than the TTL) and implausible future links', () => {
    const stale = signPortalToken('lead-42', 'accept', Date.now() - 15 * 24 * 60 * 60 * 1000)!;
    expect(verifyPortalToken(stale)).toBeNull();

    const future = signPortalToken('lead-42', 'accept', Date.now() + 10 * 60 * 1000)!;
    expect(verifyPortalToken(future)).toBeNull();
  });

  it('binds the action: a token signed for one action cannot legitimately be used for another', () => {
    const token = signPortalToken('lead-42', 'decline')!;
    const parsed = verifyPortalToken(token);
    expect(parsed!.action).toBe('decline');
    // The routes compare parsed.action to the requested action; both must match.
    expect(parsed!.action).not.toBe('accept');
  });

  it('fails closed when no signing secret is configured', () => {
    vi.stubEnv('PORTAL_TOKEN_SECRET', '');
    vi.stubEnv('CRON_SECRET', '');
    expect(signPortalToken('lead-42', 'accept')).toBeNull();
    expect(verifyPortalToken(signPortalToken('lead-42', 'accept') || 'anything')).toBeNull();
  });

  it('stops honoring tokens after the secret is removed (fail closed on rotation)', () => {
    const token = signPortalToken('lead-42', 'accept')!;
    expect(verifyPortalToken(token)).not.toBeNull();
    vi.stubEnv('PORTAL_TOKEN_SECRET', '');
    vi.stubEnv('CRON_SECRET', '');
    expect(verifyPortalToken(token)).toBeNull();
  });

  it('rejects malformed tokens without throwing', () => {
    expect(verifyPortalToken('')).toBeNull();
    expect(verifyPortalToken(null)).toBeNull();
    expect(verifyPortalToken(undefined)).toBeNull();
    expect(verifyPortalToken('no-dot-here')).toBeNull();
    expect(verifyPortalToken('.onlysig')).toBeNull();
    expect(verifyPortalToken('onlypayload.')).toBeNull();
    expect(verifyPortalToken(`${Buffer.from('not-three-parts').toString('base64url')}.sig`)).toBeNull();
  });
});
