import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WEB_ROOT = process.cwd();
const REPO_ROOT = join(WEB_ROOT, '..', '..');
const AUTH_SOURCE = join(WEB_ROOT, 'src', 'lib', 'auth.ts');
const CLIENT_IP_SOURCE = join(WEB_ROOT, 'src', 'app', 'api', 'utils', 'clientIp.ts');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function headersFrom(source: string, marker: string): string[] {
  // Tolerate `name: [...]`, `name=[...]` and a trailing `as const`, since all
  // three forms appear across auth.ts and clientIp.ts.
  const block = new RegExp(`${marker}\\s*[:=]\\s*(?:as const\\s*)?\\[([^\\]]*)\\]`).exec(source);
  expect(block, `expected to find ${marker} in source`).not.toBeNull();
  return (block![1].match(/['"]([^'"]+)['"]/g) ?? []).map((q) => q.slice(1, -1));
}

/**
 * WHY THIS EXISTS
 * ---------------
 * `auth.ts` tells Better Auth's built-in rate limiter which headers to trust for
 * the client IP. That list was previously written from an assumption ("Docker
 * sits behind nginx, so X-Real-IP must be set") rather than from evidence. This
 * test pins the list to the architecture that was actually verified, so the two
 * IP resolvers cannot silently drift apart again.
 *
 * VERIFIED DEPLOYMENT ARCHITECTURE (see DEPLOYMENT-ARCHITECTURE.md)
 * -----------------------------------------------------------------
 * Production and workers.dev are BOTH served by Cloudflare:
 *   - `GET /api/system/health` on dealswiftautomation.com returns
 *     `server: cloudflare` + a `cf-ray` header, and the same is true of
 *     dealswift-app.romanshumates1.workers.dev.
 *   - No `x-vercel-id` / `x-vercel-*` header is present, so Vercel is NOT
 *     serving the live app despite DEPLOY.md recommending it.
 *   - The repo contains ZERO tracked nginx/Caddy/traefik/haproxy configs
 *     (`git ls-files` returns 0 matches), and the root Dockerfile publishes the
 *     Next server directly on :4000 with no proxy in front of it.
 *
 * So `cf-connecting-ip` is the ONLY header guaranteed to be edge-overwritten in
 * every currently-live runtime.
 *
 * `x-real-ip` and `x-vercel-forwarded-for` are retained as DEFENSIVE entries for
 * the self-hosted / Vercel paths that DEPLOY.md documents but that are not
 * currently serving traffic. They are safe to keep precisely because they are
 * edge-set headers, and they cost nothing when absent (the resolver simply
 * falls through). Removing them would re-open the shared-bucket failure on any
 * runtime that does front the app with a proxy.
 */
describe('client-IP trust architecture', () => {
  const authHeaders = headersFrom(read(AUTH_SOURCE), 'ipAddressHeaders');
  const clientIpSingle = headersFrom(read(CLIENT_IP_SOURCE), 'TRUSTED_SINGLE_HEADERS');
  const clientIpChain = headersFrom(read(CLIENT_IP_SOURCE), 'TRUSTED_CHAIN_HEADERS');

  it('agrees with the canonical clientIp resolver on every trusted header', () => {
    // The whole point of the fix: two independent IP resolvers must not drift.
    // If they disagree, one actor can exhaust a bucket the other does not police.
    expect([...authHeaders].sort()).toEqual([...clientIpSingle, ...clientIpChain].sort());
  });

  it('trusts cf-connecting-ip first, which is the only header live edges set', () => {
    expect(authHeaders[0]).toBe('cf-connecting-ip');
  });

  it('never trusts x-forwarded-for in either resolver', () => {
    expect(authHeaders).not.toContain('x-forwarded-for');
    expect(clientIpSingle).not.toContain('x-forwarded-for');
    expect(clientIpChain).not.toContain('x-forwarded-for');
  });

  it('records that no reverse-proxy config exists in the repository', () => {
    // Guards the reasoning above. If someone adds nginx later, this fails and
    // forces the header list to be re-verified rather than assumed.
    for (const candidate of ['nginx.conf', 'nginx/nginx.conf', 'Caddyfile']) {
      expect(existsSync(join(REPO_ROOT, candidate))).toBe(false);
    }
  });
});