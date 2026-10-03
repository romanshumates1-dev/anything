/**
 * better-auth trusted origins — the allowlist that decides which browser
 * origins may POST to /api/auth/*.
 *
 * WHY THIS IS A SEPARATE MODULE (and not a literal inside src/lib/auth.ts)
 * ------------------------------------------------------------------------
 * `auth.ts` opens a `Pool` at module scope, so it cannot be imported by a unit
 * test at all (no test in this repo imports it). An allowlist that decides
 * whether users can log in MUST be testable, so the list is built here as a
 * pure function and `auth.ts` calls it. `auth.ts` keeps ownership of the
 * `betterAuth({ trustedOrigins })` wiring; nothing else moves.
 *
 * THE DEFECT THIS FIXES (measured against the deployed Worker)
 * ----------------------------------------------------------
 * Four Origin headers, one endpoint, `POST /api/auth/sign-in/email` with
 * valid credentials:
 *
 *   https://dealswiftautomation.com                  -> 200
 *   https://dealswift-app.romanshumates1.workers.dev  -> 403 INVALID_ORIGIN
 *   http://localhost:4000                             -> 403
 *   https://www.dealswiftautomation.com               -> 403
 *
 * The old list was built only from `BETTER_AUTH_URL` plus two optional env
 * vars. `BETTER_AUTH_URL` is the apex, so it was trusted; the workers.dev host
 * — which is where the app is actually DEPLOYED while the apex still serves an
 * older Worker, because wrangler.jsonc carries no `routes` entry — was not.
 * Consequence: from a browser on the deploy target, EVERY sign-in and sign-up
 * attempt failed with 403 `INVALID_ORIGIN`, deterministically. That is what
 * made authenticated browser QA unreachable, and it is a different failure
 * from the Workers Free-plan argon2 503s: this one is configuration, not CPU.
 *
 * THE RULE
 * --------
 * A host the app is served from that is missing from this list is an app that
 * cannot be logged into on that host — while looking perfectly healthy on every
 * other host. Add hosts here as they are deployed; never widen with a wildcard.
 *
 * A wildcard is specifically refused below. `*` would convert this allowlist
 * into "trust every site on the internet to POST authenticated requests at
 * this origin", which is precisely the CSRF protection better-auth is giving
 * us here. Same for blank entries: an empty origin matches no real request, so
 * it is a bug that hides behind a plausible-looking config line.
 */

/**
 * The deployed Worker host, pinned as a default.
 *
 * Wrangler's worker name (`dealswift-app`, see wrangler.jsonc) plus the
 * account subdomain form the workers.dev hostname. It is spelled out here
 * rather than derived, because deriving it would need the account subdomain
 * (owner/tenant-specific) and a silently wrong derivation would reproduce this
 * exact 403 while appearing to be configured.
 *
 * Keep this in sync with the apex entry in wrangler.jsonc's "Deploy target"
 * comment; a new deploy host needs an entry here too.
 */
export const DEPLOYED_WORKERS_ORIGIN = 'https://dealswift-app.romanshumates1.workers.dev';

/**
 * Build the trusted-origin list.
 *
 * Accepts an env object so the behaviour is testable without mutating
 * `process.env`; defaults to the real environment at the call site in auth.ts.
 *
 * Entries, in order:
 *   1. BETTER_AUTH_URL — the canonical/base URL (the apex in production).
 *   2. EXPO_PUBLIC_PROXY_BASE_URL — the mobile iframe proxy (session cookies
 *      are SameSite=None for those frames, so its origin must be allowed).
 *   3. https://${NEXT_PUBLIC_CREATE_HOST} — the lead-creation host.
 *   4. BETTER_AUTH_TRUSTED_ORIGINS — operator-supplied, comma-separated, for
 *      any future host. Exact origins only; no patterns.
 *   5. DEPLOYED_WORKERS_ORIGIN — the current deploy target, always present.
 */
export function buildTrustedOrigins(
  env: Record<string, string | undefined> = process.env
): string[] {
  const candidates: string[] = [];

  const push = (value: string | null | undefined) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    // A wildcard or a pattern is refused rather than normalised away: if a
    // deployment genuinely needs a broader rule, that is a security decision
    // to make deliberately in review, not a typo to tolerate.
    if (trimmed === '*' || trimmed.includes('*')) return;
    candidates.push(trimmed);
  };

  push(env.BETTER_AUTH_URL);
  push(env.EXPO_PUBLIC_PROXY_BASE_URL);
  push(env.NEXT_PUBLIC_CREATE_HOST ? `https://${env.NEXT_PUBLIC_CREATE_HOST}` : null);
  push(DEPLOYED_WORKERS_ORIGIN);

  for (const entry of (env.BETTER_AUTH_TRUSTED_ORIGINS ?? '').split(',')) {
    push(entry);
  }

  // Dedupe preserving first-seen order: duplicated entries are harmless to
  // better-auth but mask the fact that two config paths now disagree.
  return Array.from(new Set(candidates));
}