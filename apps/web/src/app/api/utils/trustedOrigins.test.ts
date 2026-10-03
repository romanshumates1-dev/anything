import { describe, it, expect } from 'vitest';
import { buildTrustedOrigins } from './trustedOrigins';

/**
 * better-auth trusted-origin allowlist — the list that decides which browser
 * origins may POST to /api/auth/*.
 *
 * THE DEFECT THIS EXISTS FOR (measured against the deployed Worker, not
 * hypothesised — four Origin headers, one endpoint, `POST
 * /api/auth/sign-in/email` with valid credentials):
 *
 *   Origin: https://dealswiftautomation.com                     -> 200
 *   Origin: https://dealswift-app.romanshumates1.workers.dev     -> 403 INVALID_ORIGIN
 *   Origin: http://localhost:4000                                -> 403
 *   Origin: https://www.dealswiftautomation.com                  -> 403
 *
 * So sign-in worked only from the apex. The app is DEPLOYED at the workers.dev
 * host (wrangler.jsonc has no `routes` entry, so the deploy target IS
 * workers.dev — see the "Deploy target" comment there), and from a browser
 * every sign-in attempt from that host failed deterministically with
 * `INVALID_ORIGIN`. That is not a flake and not the argon2/Free-plan CPU
 * blocker: it is a missing allowlist entry, and it is what made authenticated
 * browser QA impossible (no login => no authenticated routes reachable).
 *
 * THE RULE
 * --------
 * Every host the app is actually SERVED FROM must be in this list, because
 * better-auth rejects any auth request whose Origin is absent from it. A host
 * that is missing makes the app 100% unloginable *on that host* while looking
 * perfectly healthy on another.
 *
 * The negative cases are pinned just as hard: this list must stay narrow. A
 * wildcard (`*`) or a blanket "trust everything" would silently delete the CSRF
 * defence that better-auth is providing here, which is the whole point of the
 * allowlist.
 */

const DEPLOYED_WORKERS_ORIGIN = 'https://dealswift-app.romanshumates1.workers.dev';

describe('buildTrustedOrigins', () => {
  it('trusts the deployed workers.dev host with NO env configured (the 403 defect)', () => {
    // The regression itself: empty env is the state that produced
    // "403 INVALID_ORIGIN" for every browser sign-in from the deploy target.
    const origins = buildTrustedOrigins({});

    expect(origins).toContain(DEPLOYED_WORKERS_ORIGIN);
  });

  it('keeps BETTER_AUTH_URL (the apex) as a trusted origin', () => {
    const origins = buildTrustedOrigins({
      BETTER_AUTH_URL: 'https://dealswiftautomation.com',
    });

    expect(origins).toContain('https://dealswiftautomation.com');
    // ...and still trusts the deploy target alongside it.
    expect(origins).toContain(DEPLOYED_WORKERS_ORIGIN);
  });

  it('never emits a wildcard or a blank entry', () => {
    // A `*` in trustedOrigins would hand the CSRF decision to every site on
    // the internet. Empty strings are the same failure wearing a disguise:
    // better-auth would be configured with an origin that matches nothing.
    const origins = buildTrustedOrigins({
      BETTER_AUTH_URL: '',
      BETTER_AUTH_TRUSTED_ORIGINS: '  ,  ,',
      EXPO_PUBLIC_PROXY_BASE_URL: '',
      NEXT_PUBLIC_CREATE_HOST: '',
    });

    expect(origins).not.toContain('*');
    expect(origins).not.toContain('');
    expect(origins.every((o) => o.trim() === o && o.length > 0)).toBe(true);
  });

  it('honours an operator-supplied comma-separated allowlist', () => {
    // The escape hatch for future hosts: add the exact origin, never a pattern.
    const origins = buildTrustedOrigins({
      BETTER_AUTH_TRUSTED_ORIGINS:
        'https://qa.example.com, https://staging.example.com',
    });

    expect(origins).toContain('https://qa.example.com');
    expect(origins).toContain('https://staging.example.com');
  });

  it('keeps the mobile proxy and lead-create hosts working (no regressions)', () => {
    const origins = buildTrustedOrigins({
      EXPO_PUBLIC_PROXY_BASE_URL: 'https://proxy.example.com',
      NEXT_PUBLIC_CREATE_HOST: 'create.example.com',
    });

    expect(origins).toContain('https://proxy.example.com');
    expect(origins).toContain('https://create.example.com');
  });

  it('emits no duplicates when the same host arrives by two routes', () => {
    // Deployment config drifts; a duplicated entry is harmless to better-auth
    // but hides the fact that two config paths now disagree. Keep it single.
    const origins = buildTrustedOrigins({
      BETTER_AUTH_URL: DEPLOYED_WORKERS_ORIGIN,
      BETTER_AUTH_TRUSTED_ORIGINS: DEPLOYED_WORKERS_ORIGIN,
    });

    expect(origins.filter((o) => o === DEPLOYED_WORKERS_ORIGIN)).toHaveLength(1);
  });
});