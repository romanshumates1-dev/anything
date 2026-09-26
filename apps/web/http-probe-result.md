# HTTP Probe — Production Site (run 2026-09-20)

Playwright browser probe was **blocked** (no browser installable in this environment — see
`browser-probe-status.md`). This HTTP-level probe covers everything detectable without a browser engine.

## Methodology
`Invoke-WebRequest` GETs against both production hostnames for a set of paths. Each result records
status code, elapsed ms, content-type, response body size (capped at 200 bytes), and redirect count.

## Results

### `https://dealswiftautomation.com` (custom domain)
| Path | Status | Time | Notes |
|------|--------|------|-------|
| `/` | 200 | 2651ms | Cold load |
| `/account/signin` | 200 | 222ms | |
| `/api/system/health` | 200 | 429ms | |
| `/api/billing/plans` | 200 | 206ms | |
| `/api/auth/get-session` | 200 | 285ms | Unauthenticated: returns `null` (4 bytes) |
| `/api/usage` | 401 | 688ms | Expected — requires session |
| `/api/credits` | 401 | 1256ms | Expected — requires session |
| `/robots.txt` | 200 | 220ms | |
| `/sitemap.xml` | 200 | 296ms | |
| `/favicon.ico` | 200 | 288ms | |
| `/wp-admin/install.php` | 404 | 314ms | WordPress scanner — correctly blocked |

### `https://dealswift-app.romanshumates1.workers.dev` (workers.dev)
| Path | Status | Time | Notes |
|------|--------|------|-------|
| `/` | 200 | 3821ms | Cold load |
| `/account/signin` | 200 | 529ms | |
| `/api/system/health` | 200 | 482ms | |
| `/api/billing/plans` | 200 | 196ms | |
| `/api/auth/get-session` | 200 | 249ms | Unauthenticated: returns `null` (4 bytes) |
| `/api/usage` | 401 | 62ms | Expected — requires session |
| `/api/credits` | 401 | 61ms | Expected — requires session |
| `/robots.txt` | 200 | 85ms | |
| `/sitemap.xml` | 200 | 96ms | |
| `/favicon.ico` | 200 | 85ms | |
| `/wp-admin/install.php` | 404 | 190ms | WordPress scanner — correctly blocked |

## Conclusions
- No 5xx errors on any path on either hostname.
- No unexpected redirects (all redirect count = 0 where relevant).
- Auth-gated endpoints correctly return 401 without a session — not a bug.
- WordPress scanner path returns 404 (not 200) — the site is not accidentally exposing a
  WordPress install; the scanner probe is properly rejected.
- Both hostnames serve identical content (same Worker).
- **Gap:** JS console errors, RSC hydration failures, client-side render errors not detectable
  without a real browser. See `browser-probe-status.md`.
