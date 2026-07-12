# BREAKAGE_TABLE.md — DealFlow AI

Live-app defect ledger. Rows are worked in journey order; auth gate outranks all.
Evidence for FIXED+PROVEN rows lives in `apps/web/e2e/.proof/` (screenshots +
`walk-report.json`) and the Playwright journey spec (`apps/web/e2e/journey.spec.ts`).

Session 2026-07-10 (b): drove the full live journey in system Edge
(register → every tab → import → wizard build+launch → inbox → approvals). The
tailwindcss root fix (`next.config.js` `turbopack.root`) was already applied and
is now PROVEN live. Five additional real defects surfaced and were fixed.

| # | journey step | expected | actual (before) | error evidence | status |
|---|--------------|----------|-----------------|----------------|--------|
| 1 | App shell / all tabs render | `yarn dev` serves styled pages at :4000 | (was) compile error, no page rendered | `Error: Can't resolve 'tailwindcss'` — fixed by `turbopack.root: __dirname` in `next.config.js` | **FIXED+PROVEN** — dashboard renders fully styled (`e2e/.proof/01-after-register.png`); all 10 routes HTTP 200 |
| 2 | Jobs engine + signup compile | `/api/jobs/process` 200; pages compile | `500` on `/api/jobs/process`, cascading `500` on `/account/signup` (blank) | `Module not found: Can't resolve 'uuid'` at `src/app/api/gateway/sms-gateway.ts:13` (de-hoisted by `nmHoistingLimits: workspaces`; `uuid` never a declared dep) | **FIXED+PROVEN** — switched to `node:crypto` `randomUUID`; `/api/jobs/process`→200, signup renders form (probe) |
| 3 | Auth gate: register → dashboard | GUI signup lands authenticated | (blocked by #2) | n/a | **FIXED+PROVEN** — `walk-*.mjs` registers via GUI → lands on `/` dashboard (screenshot) |
| 4 | Every authenticated page (Shell) | no console/hydration errors | `<a> cannot be a descendant of <a>` hydration error on every page | nested anchors: `<Link><SidebarMenuButton asChild><a>` in `Shell.tsx` | **FIXED+PROVEN** — collapsed to `<SidebarMenuButton asChild><Link>`; walk shows 0 hydration errors |
| 5 | Sidebar approvals badge | `GET /api/approvals/count` → `{count}` | `405` on every page (fell through to `approvals/[id]`, POST-only) | walk `failedNet: 405 GET /api/approvals/count` | **FIXED+PROVEN** — new `approvals/count/route.ts`; returns 200 `{count}` |
| 6 | Contracts tab | `GET /api/contracts` → array | `404` (route never existed) | walk `failedNet: 404 GET /api/contracts` | **FIXED+PROVEN** — new `contracts/route.ts` (org-scoped, `contracts` table); 200 |
| 7 | Analytics tab funnel | `GET /api/analytics` → funnel object | `404` (missing) → then `500` enum error | `404`, then `invalid input value for enum contact_status: "FAILED"` | **FIXED+PROVEN** — new `analytics/route.ts`; funnel renders non-zero (Engaged 11, Negotiated 11), $0 cost (`e2e/.proof/tab-analytics.png`) |
| 8 | Import (paste + file) → DB | 10-row mixed fixture previewed + persisted | (not previously proven live) | n/a | **FIXED+PROVEN** — `import-walk.mjs`: paste→`{inserted:8,duplicates:1,failed:1}` (8 DB rows), file→`{inserted:3}` (3 DB rows) |
| 9 | Wizard build + **launch** → ACTIVE | "Launch Campaign" activates the campaign | campaign stayed **DRAFT** — `launch()` was identical to `saveDraft()`, never called `/start` | create route hardcodes `'DRAFT'`; wizard never hit the (existing, tested) `[id]/start` route | **FIXED+PROVEN** — `launch()` now creates → POST `/start`; 4 ACTIVE campaigns in DB; journey asserts `status === 'ACTIVE'` 3/3 |
| 10 | Signed inbound webhook (e2e) | signed Twilio POST → 200 | `403` invalid signature | test signed `localhost` URL; route validates against `PUBLIC_WEBHOOK_URL` (now set to ngrok) | **FIXED+PROVEN** — test signs `env.PUBLIC_WEBHOOK_URL || localhost` (matches real Twilio); journey 3/3 |
| 11 | E2E journey (10-step) | 3/3 consecutive green live | (was) blocked by #1 | n/a | **FIXED+PROVEN** — `journey.spec.ts` 3/3 green (`--repeat-each=3`); unit suite 252 passed / 19 skipped |
| 12 | **White screen** on real-user first load | app renders (login for guests) | **blank white screen** — every page stuck | `GET /api/auth/get-session 500` (repeated "Jest worker child process exceptions") → `useSession()` never resolves → Shell/pages stuck. Caused by a stale/uncleared `.next` cache + orphaned Playwright/tinypool workers starving the dev server. | **FIXED+PROVEN** — killed orphaned workers + cleared `.next` + clean reboot; get-session 200 (4/4); unauth `/` → signin form renders (`unauth-probe.mjs`) |
| 13 | Marketing landing at `/` | guests see marketing; users see app | marketing landing **unreachable** — `app/page.tsx` (dashboard) and `app/(marketing)/page.tsx` both resolved to `/`; dashboard won | route collision; `GET /dashboard` also 404'd (sidebar "Dashboard" link broken) | **FIXED+PROVEN** (owner chose "marketing for guests, app for users") — moved dashboard to `app/dashboard/page.tsx`, marketing group owns `/`, authed `/` → redirect `/dashboard`; marketing spec 2/2 green |
| 14 | Marketing e2e spec was stale | tests the real funnel | asserted a hero/CTA/destination that never existed (CTAs → `/contact`, not signin; no "DealFlow AI" heading) | old `marketing.spec.ts` | **FIXED+PROVEN** — rewritten unauthenticated: home hero → Pricing nav → `/pricing` ($99) → CTA → `/contact`; + Sign In nav → `/account/signin` |

## Session 2026-07-12 (e) — RBAC/domain-lock hardening (adversarial review → 5 fixes)

Resumed the in-flight domain-lock + RBAC work (uncommitted on `main`). Ran a 4-dimension
adversarial code review + verification over the diff, then fixed every confirmed defect.
All five FIXED live this session (curl/DB evidence captured, not just unit tests).

| # | area | expected | actual (before) | evidence | status |
|---|------|----------|-----------------|----------|--------|
| 15 | **CI typecheck** (`tsc -p tsconfig.typecheck.json`) | exit 0 | **2× `TS2304 Cannot find name 'money'`** at `analytics/route.ts:161` — `money()` used in the margin-note template but never defined in the module (only a client const in `analytics/page.tsx`). A prior `npx tsc --noEmit` was a FALSE PASS (npx pulled a stub tsc that printed "not the tsc you're looking for" + exit 0). | `./node_modules/.bin/tsc -p tsconfig.typecheck.json` → 2 errors before, exit 0 after | **FIXED+PROVEN** — added local `money()` helper mirroring the page formatter |
| 16 | **API-key revocation** (`DELETE /api/settings/api-keys/[id]`) | admin deletes key → `{success:true}` | **every revocation 404'd** — handler read `props.params.id` synchronously, but Next 16 route params is a `Promise` → `id` always `undefined` → `WHERE id=undefined` no match. No key could ever be revoked. | fresh admin deleting OWN key: `404` before, `{"success":true}` 200 after (live curl) | **FIXED+PROVEN** — `const { id } = await props.params` (matches sibling admin route) |
| 17 | **Session revocation / role demotion** | demote/revoke cuts off access on next request | **retained access up to 7 days** — `session.cookieCache` (maxAge 7d) served the signed session (and role) without a DB read; deleting the DB session row also blinded the deny-only middleware (falls through on null lookup) → `getSession` kept returning the cached session. The revocation control defeated its own detection. | after `DELETE FROM session`: `/api/campaigns` 200→**401**, `get-session`→**null** (live) | **FIXED+PROVEN** — disabled `cookieCache` (auth.ts); DB session table is now the single source of truth, revocation immediate |
| 18 | **`/api/system/*` info-leak** | operational data admin-only | `/api/system/database`, `/metrics`, `/queue-status` had **no auth at all** (anon read of connection counts, AI/SMS aggregates, queue depth); `/readiness` was any-session (below-role MEMBER could read it via the middleware `/api/system` exemption). | anon → **401** on all four after; `/health` stays public (Shell.tsx); admin cookie → 200 (live) | **FIXED+PROVEN** — `requireAdmin()` guard on the 4 data routes; `/health` (public liveness) + `/cron` (secret) unchanged |
| 19 | **Analytics margin display** | "Est. revenue" = total revenue | showed `estimatedRevenueCents` (only the *estimated slice*) while "Est. margin" derived from `revenueCents` (actual+est) → with any recorded fee, revenue rendered *smaller* than margin (nonsensical) | one-line fix to `margin.revenueCents` | **FIXED** — typecheck + suite green; API already exposed `revenueCents` |

**Live RBAC proof captured this session (Gates A1/A2):** out-of-domain register **403** + login **403** (no user row created); in-domain MEMBER → `/dashboard` redirects `/pending-access`, `/api/campaigns` **403**, admin API **403**, key issuance **403**; promote→ADMIN → `/dashboard` 200 + admin API 200; admin issues v1 key → `/api/v1/campaigns` 200 → owner demoted → **same key 403** (layer-4 owner check); org-isolation approval suite green (8/8). Owner `roman.shumate@dealswiftautomation.com` confirmed **ADMIN** (single admin row). All test users/keys/sessions torn down after.

**Known limitations (documented, not fixed — low risk / out of scope):** (a) last-admin demotion guard is count-then-update — a TOCTOU race needs two simultaneous demotions of the last two admins (unit-tested for the sequential case, which is the real-world path); (b) pre-existing v1 API keys with NULL/foreign `created_by` now fail closed (403) by design — owner reissues under a live admin; (c) per-key rate-limit uses an in-memory Map (per-isolate; documented in middleware); (d) dev-only social sign-in shim (`test@example.com`) is rejected by the domain hook (correct — not an allowed domain).

## Environmental / owner-blocked (not code defects)

| # | item | detail | status |
|---|------|--------|--------|
| E1 | `YARN_TMP_FOLDER` env var | set in the inherited **process** env (not User/Machine registry) to `d:\anything\.yarn\tmp`; Yarn 4.12 rejects the legacy `tmpFolder` setting → **every** `yarn` command fails with "Unrecognized or legacy configuration settings". Workaround: `unset YARN_TMP_FOLDER` inline. Not persisted, so fresh terminals are unaffected. | WORKAROUND (unset inline) |
| E2 | Anthropic API key invalid | preflight Check 4: `HTTP 401 authentication_error: invalid x-api-key`. Key in `apps/web/.env` was valid in the prior handoff → rotated/expired. Blocks live AI replies (`ai_reply` jobs) but NOT the GUI journey. | **BLOCKED-ON-OWNER** — supply a valid `ANTHROPIC_API_KEY` |
| E3 | Preflight Check 7 (job engine) | polls for an `ai_reply` transition; fails when no `jobs:dev` worker is running during preflight AND because the AI key (E2) is invalid. Job enqueue itself works (8 `ai_reply` rows enqueued by the journey). | downstream of E2 + worker not running |

## Deferred (dev-tooling, not the GUI journey)

| # | item | status |
|---|------|--------|
| D1 | `jobs-dev` 2nd-launch refusal | lock code + pidfile written; 2nd-instance refusal still unproven under the command-timeout harness |
| D2 | root `dev:clean` script | `scripts/dev-clean.mjs` exists; `&&` chaining runs fine via Yarn's portable shell, unverified end-to-end |
| D3 | analytics "% of sent" cosmetic | when `sent=0`, `total = sent || 1` yields "1100% of sent"; counts are correct; pre-existing page math, out of scope |
