import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH_SOURCE = join(process.cwd(), 'src', 'lib', 'auth.ts');

/**
 * Better Auth's built-in rate limiter resolves the client IP itself. It is a
 * SEPARATE limiter from the app's atomic pre-hash guard, but if the two resolve
 * different addresses then one bad actor can exhaust a bucket the other does
 * not police.
 *
 * The failure mode this test pins down is specific and easy to get wrong.
 * Better Auth's resolver FAILS CLOSED on a header whose value contains a
 * multi-entry chain: when `trustedProxies` is unset it only accepts a header
 * whose value is a single address. On failure it does not skip the request -
 * it keys every caller into ONE shared `no-trusted-ip` bucket for that path.
 * That is strictly worse than a per-user limiter: a single unauthenticated
 * actor can lock out every real user.
 *
 * So the configured list must be the set of headers that a trusted EDGE
 * overwrites, where each header carries exactly one address. This app deploys
 * to more than one edge (Cloudflare Workers, Vercel, and nginx in Docker), so
 * the list must cover every one of them - listing only `cf-connecting-ip`
 * would leave the Vercel and Docker deployments on the shared bucket.
 *
 * `x-forwarded-for` is deliberately absent: the client chooses everything to
 * the left of the rightmost entry, which is exactly the rate-limit bypass
 * already fixed in `src/app/api/utils/clientIp.ts`. The trusted chain header
 * for Vercel (`x-vercel-forwarded-for`) is the edge-controlled substitute.
 */
const EXPECTED_HEADERS = ['cf-connecting-ip', 'x-real-ip', 'x-vercel-forwarded-for'];

function readConfiguredHeaders(): string[] {
  const source = readFileSync(AUTH_SOURCE, 'utf8');

  const block = /ipAddressHeaders\s*:\s*\[([^\]]*)\]/.exec(source);
  expect(block, 'auth.ts must configure advanced.ipAddress.ipAddressHeaders').not.toBeNull();

  return (block![1].match(/['"]([^'"]+)['"]/g) ?? []).map((quoted) =>
    quoted.slice(1, -1)
  );
}

describe('Better Auth client-IP configuration for its built-in rate limiter', () => {
  const headers = readConfiguredHeaders();

  it('lists exactly the trusted edge headers, in trust order', () => {
    expect(headers).toEqual(EXPECTED_HEADERS);
  });

  it('puts the Cloudflare edge header first so it is preferred on Workers', () => {
    expect(headers[0]).toBe('cf-connecting-ip');
  });

  it('never trusts a client-controlled forwarding chain header', () => {
    const source = readFileSync(AUTH_SOURCE, 'utf8');
    expect(source).not.toMatch(/ipAddressHeaders\s*:\s*\[[^\]]*['"]x-forwarded-for['"]/);
    expect(headers).not.toContain('x-forwarded-for');
  });

  it('keeps the limiter resolving a single address per request', () => {
    // A header whose value can legitimately be a comma-joined chain would make
    // the resolver return null and collapse every caller into one shared
    // bucket. `x-vercel-forwarded-for` is included only because the Vercel edge
    // rewrites it to a single value; assert it is present so its removal is a
    // deliberate, reviewed change rather than an accidental regression.
    expect(headers).toContain('x-vercel-forwarded-for');
  });
});