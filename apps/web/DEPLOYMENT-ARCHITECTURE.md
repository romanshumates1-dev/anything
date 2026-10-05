# Verified deployment architecture — client IP trust

Evidence gathered at commit `dac5d6e` to close the `x-real-ip` verification
caveat raised when `advanced.ipAddress.ipAddressHeaders` was first configured.

## Why this document exists

`apps/web/src/lib/auth.ts` tells Better Auth's built-in rate limiter which
headers to trust when resolving the client IP. The initial value
(`['cf-connecting-ip']`) was written from an **assumption** that Docker runs
behind nginx, so `X-Real-IP` would be populated. That assumption was never
checked. This records what is actually true.

## What production actually runs

Probed with two read-only `GET /api/system/health` requests (no credentials):

| Host | Status | Edge headers observed |
|---|---|---|
| `https://dealswiftautomation.com` | 200 | `server: cloudflare`, `cf-ray: …-CMH` |
| `https://dealswift-app.romanshumates1.workers.dev` | 200 | `server: cloudflare`, `cf-ray: …-CMH` |

**No `x-vercel-id` or `x-vercel-*` header on either host.** Vercel is not serving
the live application, even though `DEPLOY.md` recommends Vercel and
`apps/web/vercel.json` exists with cron entries.

## Reverse-proxy inventory

Verified with `git ls-files` (not a directory listing, which had produced false
negatives earlier in this project):

```
git ls-files | Select-String -Pattern 'nginx|\.conf$|Caddyfile|traefik|haproxy'
→ 0 matches
```

The repository contains **no** nginx, Caddy, traefik, or haproxy config.

The root `Dockerfile` publishes the Next standalone server **directly**:

- `EXPOSE 4000`, `CMD ["node", "apps/web/server.js"]`
- `docker-compose.yml` maps `"4000:4000"` straight to the app service.

There is no proxy process in the Docker path, so **`x-real-ip` is never populated
in the self-hosted runtime.**

## Resulting trust chain

| Runtime | In production? | Proxy | Header reliably set | Trusted |
|---|---|---|---|---|
| Cloudflare Workers (apex) | **Yes — live** | Cloudflare edge | `cf-connecting-ip` | ✅ |
| Cloudflare Workers (workers.dev) | **Yes — live** | Cloudflare edge | `cf-connecting-ip` | ✅ |
| Vercel | Documented, not live | Vercel edge | `x-vercel-forwarded-for` | ✅ (defensive) |
| Docker / self-hosted | Documented, not live | none | *(no edge header)* | ⚠️ see below |
| nginx in front of Docker | **does not exist in this repo** | nginx | `x-real-ip` | ✅ (defensive) |

## Why the header list is what it is

`apps/web/src/lib/auth.ts`:

```ts
ipAddress: {
  ipAddressHeaders: ['cf-connecting-ip', 'x-real-ip', 'x-vercel-forwarded-for'],
},
```

This is byte-for-byte the union of the two trusted lists in
`src/app/api/utils/clientIp.ts`:

- `TRUSTED_SINGLE_HEADERS = ['cf-connecting-ip', 'x-real-ip']`
- `TRUSTED_CHAIN_HEADERS = ['x-vercel-forwarded-for']`

Reasons:

1. **`cf-connecting-ip` first** — the only header guaranteed edge-overwritten in
   every currently-live runtime.
2. **`x-real-ip` / `x-vercel-forwarded-for` retained as defensive entries.** They
   cost nothing when absent (the resolver falls through to the next header), and
   keeping them means the documented-but-inactive runtimes do not silently fall
   into the shared-bucket failure if they are ever activated.
3. **`x-forwarded-for` is excluded.** The client chooses everything to the left
   of the rightmost entry, which is the rate-limit bypass already fixed in
   `clientIp.ts`.

## The self-hosted caveat (honest limitation)

In the pure-Docker path there is **no edge**, so no header is set and Better
Auth's built-in limiter resolves `null`. Its documented behaviour on `null` is to
key **every caller into one shared `no-trusted-ip` bucket** per path, plus log:

> Rate limiting could not determine a client IP and is falling back to a single
> shared per-path bucket.

That is a **pre-existing condition**, not a regression introduced by `dac5d6e` —
previously the unconfigured default read `x-forwarded-for`, which is absent for
direct requests and equally resolves to `null`. This is unchanged by the fix.

Mitigation already in place: the app's own atomic pre-hash guard in
`src/lib/auth-cost-guard.ts` and the route-level limiters in
`src/app/api/utils/rateLimit.ts` use `getClientIp()`, which returns `null` and is
handled explicitly by callers. The primary brute-force control
(`reset-password`, 5/hour) is enforced by that path, not by Better Auth's
built-in limiter.

**If the Docker path is ever promoted to production**, place a proxy in front
that sets a single-value header, or accept the shared bucket knowingly. Do not
"fix" it by trusting `x-forwarded-for`.

## Regression guard

`src/app/api/utils/clientIp.deployment-architecture.test.ts` asserts that:

- `auth.ts` and `clientIp.ts` agree on the exact same trusted header set,
- `cf-connecting-ip` is first,
- neither resolver trusts `x-forwarded-for`,
- no nginx/Caddy config exists at the paths that would change this reasoning.

Adding a reverse proxy will fail that last assertion, forcing re-verification
rather than a silent assumption.