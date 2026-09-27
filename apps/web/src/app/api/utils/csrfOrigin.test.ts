import { describe, it, expect, vi, afterEach } from 'vitest';
import { crossSiteRejection, validateCsrf } from './csrfProtection';

/**
 * Cross-site (CSRF) gate tests — requirement: HTTP headers/CSRF posture.
 *
 * Threat model: session cookies are SameSite=None, so a hostile page can fire
 * state-changing requests that include the victim's cookie. Browser
 * cross-site POSTs always carry an Origin header, so origin attribution is
 * the discriminator. Exemptions (no Origin at all; Bearer df_ keys) exist for
 * webhooks/M2M and are pinned here so nobody can widen them silently — and
 * the hostile cases are pinned so nobody can narrow the gate back out.
 */

const API = 'https://app.example.com/api/withdrawals';

function post(headers: Record<string, string>, method = 'POST'): Request {
  return new Request(API, { method, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crossSiteRejection (middleware choke point)', () => {
  it('rejects a cross-site POST (the SameSite=None text/plain CSRF case) with 403', () => {
    const res = crossSiteRejection(
      post({ origin: 'https://evil.example', 'content-type': 'text/plain' })
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('allows same-host Origin (normal app fetch)', () => {
    expect(
      crossSiteRejection(post({ origin: 'https://app.example.com' }))
    ).toBeNull();
  });

  it('allows localhost dev origins even when request host differs', () => {
    expect(
      crossSiteRejection(
        new Request('http://127.0.0.1:4000/api/x', {
          method: 'POST',
          headers: { origin: 'http://localhost:4000' },
        })
      )
    ).toBeNull();
  });

  it('allows configured env origins (BETTER_AUTH_URL etc.)', () => {
    const prev = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = 'https://auth.example.com';
    try {
      expect(
        crossSiteRejection(post({ origin: 'https://auth.example.com' }))
      ).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = prev;
    }
  });

  it('allows requests with NO Origin and NO Referer (webhooks, curl, M2M)', () => {
    expect(crossSiteRejection(post({}))).toBeNull();
  });

  it('rejects a cross-site Referer when Origin is absent', () => {
    expect(
      crossSiteRejection(post({ referer: 'https://evil.example/page' }))
    ).not.toBeNull();
  });

  it('rejects the literal `Origin: null` (sandboxed iframe) instead of throwing', () => {
    const res = crossSiteRejection(post({ origin: 'null' }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('never triggers on safe methods (GET/HEAD/OPTIONS)', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        crossSiteRejection(post({ origin: 'https://evil.example' }, method))
      ).toBeNull();
    }
  });

  it('allows Bearer df_ API-key callers regardless of Origin (header auth, not cookies)', () => {
    expect(
      crossSiteRejection(
        post({ origin: 'https://evil.example', authorization: 'Bearer df_test_key' })
      )
    ).toBeNull();
  });

  it('treats a non-df Bearer token as cookie-class traffic (still origin-checked)', () => {
    // Session-ish tokens must not inherit the df_ exemption.
    expect(
      crossSiteRejection(
        post({ origin: 'https://evil.example', authorization: 'Bearer session123' })
      )
    ).not.toBeNull();
  });

  it('marks the 403 as non-cacheable', () => {
    const res = crossSiteRejection(post({ origin: 'https://evil.example' }));
    expect(res!.headers.get('Cache-Control')).toBe('no-store');
  });

  it('allows the public Origin when only x-forwarded-host matches (proxy deployment)', () => {
    // Simulates a request that reached the origin server with an internal
    // URL/Host but a public `Origin` — the case that would otherwise 403 every
    // mutation in production behind Cloudflare.
    const req = new Request('http://internal-worker.local:8787/api/withdrawals', {
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        'x-forwarded-host': 'app.example.com',
        host: 'internal-worker.local:8787',
      },
    });
    expect(crossSiteRejection(req)).toBeNull();
  });

  it('still rejects a hostile Origin even when a forwarded host is present', () => {
    // The forwarded header must not become a bypass: a browser cannot set
    // X-Forwarded-Host on a CORS-simple request, and if it somehow arrives it
    // must not authenticate a foreign Origin.
    const req = new Request('https://app.example.com/api/withdrawals', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'x-forwarded-host': 'app.example.com, evil-proxy.example',
      },
    });
    expect(crossSiteRejection(req)).not.toBeNull();
  });

  it('tolerates an explicit default port on the forwarded host', () => {
    const req = new Request('http://internal:8787/api/withdrawals', {
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        'x-forwarded-host': 'app.example.com:443',
      },
    });
    expect(crossSiteRejection(req)).toBeNull();
  });
});

describe('validateCsrf robustness (per-route helper)', () => {
  it('rejects `Origin: null` with valid:false instead of throwing (was a 500)', () => {
    expect(() => validateCsrf(post({ origin: 'null' }))).not.toThrow();
    const result = validateCsrf(post({ origin: 'null' }));
    expect(result.valid).toBe(false);
  });

  it('still rejects a foreign origin', () => {
    expect(validateCsrf(post({ origin: 'https://evil.example' })).valid).toBe(
      false
    );
  });

  it('still allows a known origin', () => {
    expect(validateCsrf(post({ origin: 'http://localhost:4000' })).valid).toBe(
      true
    );
  });
});
