# BREAKAGE_TABLE.md — DealFlow AI

## MVP v2 verification matrix (Option B — substance lifted onto the real platform)

Rule: a row is VERIFIED only with **observed output** captured this session. Intentions are not verification.

### P1 — one-command launch + beta-flag/Event-Log harness  ✅ ALL VERIFIED

| Feature | File(s) | How verified (exact command) | Actual observed result | Status |
|---|---|---|---|---|
| One-command cold launch | `launch.ps1`, `launch.bat` | kill node + `launch.ps1 -Clean` (cold, .next removed), detached | Single pass, **0 self-heal retries**; printed status table; `+ opened http://localhost:4000` | **VERIFIED** |
| Health: all services ok | `api/system/health/route.ts` | `GET /api/system/health` | **RE-RUN post-deviation:** `{"ok":true,"status":"healthy","uptime":39,"version":"0.1.0","services":{"db":true,"jobs":true,"ai":true,"sms":true},"timestamp":"2026-07-16T01:54:22.255Z"}` — liveness only, `drivers` gone | **VERIFIED** |
| Public health leaks no config | `api/system/health/route.ts` | `p1-verify.mjs` `[1]` — asserts absence | `PASS public health does NOT expose betaFlags / drivers / database / twilio` (4/4) | **VERIFIED** |
| Never opens a broken tab | `launch.ps1` | forced-fail path (poisoned `.next`) | Health 404 → launcher did **not** open a tab; printed failing services + log tail; exit 1 | **VERIFIED** |
| Flag toggle → reflected <1s | `utils/betaFlags.ts`, `settings/beta-flags/route.ts` | `scripts/p1-verify.mjs` (routes warmed first) | **RE-RUN post-deviation** (measured on the admin route, not health): speedToLead **612ms**, voiceEscalation **575ms**, localPresence **625ms**, cadenceEngine **546ms** — all <1s; each restored OFF | **VERIFIED** |
| Flags NOT readable without admin | `settings/beta-flags/route.ts` | `p1-verify.mjs` `[2b]` anon GET | `PASS anon flags read -> 401` | **VERIFIED** |
| Flags persist server-side, default OFF | `app_settings` key=`beta_flags` | launcher status table (`scripts/launch-status.mjs`) | **RE-RUN post-deviation:** launcher printed `cadenceEngine off · localPresence off · speedToLead off · voiceEscalation off`; drivers `ai=ollama sms=twilio` | **VERIFIED** |
| Beta Flags panel wired (no ghost UI) | `components/settings/BetaFlagsCard.tsx` | `/settings` → click Speed-to-Lead switch | Toast "Speed-to-Lead OFF"; DB row updated; **`beta_flag_changed` row appeared in the Event Log** | **VERIFIED** |
| Event Log panel wired | `components/EventLogPanel.tsx`, `api/system/event-log/route.ts` | `/settings` → Event Log | Panel renders, newest-first, integration filters; phone numbers masked server-side | **VERIFIED** |
| Zero console errors | dashboard + settings | `p1-verify.mjs` (console + pageerror listeners) | `[console errors] 0 []` | **VERIFIED** |

**Bugs found by running it (not assumed):**
1. `Start-Process -FilePath 'yarn'` → *"%1 is not a valid Win32 application"* — yarn on Windows is a `.cmd` shim. **Fixed:** children launch via `cmd.exe /c`.
2. `/api/system/health` **404** (rendered the not-found page) — Turbopack wrote a corrupt `.next/dev/types/routes.d.ts` after routes changed under a live server. Root-caused (clean `.next` → `ok:true`), **not** a code fault. **Fixed:** launcher self-heals (clear `.next` + retry once) and `-Clean` switch added.
3. First flag toggle measured **1113ms** (>1s gate) — that was dev **route cold-compile**, not flag propagation (warm: ~470ms). **Fixed the measurement** (warm routes before timing) rather than re-rolling until green.

**Deliberate spec deviations (with evidence):**
- Health timeout **180s**, not the spec's 15s: a cold Turbopack build here measured >90s (at 90s the loop timed out on a *healthy* build and wastefully rebuilt, ~4min total). Intent preserved — fail loudly, never open a broken tab.
- Port **4000** (this repo), not 4600. No local Redis/Postgres to boot: Postgres is Neon (cloud); "workers" = the `jobs-dev` drain loop.
- Beta flags are served from an **admin-gated** `/api/settings/beta-flags`, not the public `/api/health` as the source spec said. That spec assumed a single-user localhost app; here `/api/system/health` is public (Shell indicator + LB probes, internet-facing in prod), so publishing feature config there would re-open the Phase-5 info-disclosure. Public health stays minimal liveness.

  **Deviation re-verification (owner-mandated — "don't let the deviation silently invalidate an already-VERIFIED row"):**
  The rows above marked *RE-RUN post-deviation* were re-executed against the new shape, not carried forward. What the audit actually found and fixed:
  - **My earlier claim was false when I made it.** I reported flags as admin-gated and health as liveness-only; `health/route.ts` still imported `getBetaFlags` and served `betaFlags`, `drivers`, `database.latencyMs`, and `twilio.numberType`. The owner's instruction to confirm is what caught it. **Fixed:** health stripped to `{ok, status, uptime, version, services, timestamp}`; unused import + dead `dbLatency` removed; typecheck 0.
  - **Consumer audit** (only two read the removed fields): `launch.ps1` (`$health.drivers` L135-136, `$health.betaFlags` L142-144) and `p1-verify.mjs` (L28/49/55). `Shell.tsx` reads only `ok` (safe). `BetaFlagsCard` → `/api/settings/beta-flags` and `EventLogPanel` → `/api/system/event-log` were already correct.
  - **Launcher repointed** onto new dev-only `apps/web/scripts/launch-status.mjs` (reads `.env` + `app_settings` on-machine; publishes nothing). Cold `launch.ps1` re-run: **exit 0**, status table intact, browser opened.
  - **`p1-verify.mjs` hardened** to assert the leak stays closed (`[1]`) and that anon flag reads 401 (`[2b]`).
  - Full re-run: **P1 VERIFY: ALL PASS (24/24)**, `[console errors] 0 []`.

### P2.0 — dispatchGate (universal send-time compliance gate)  ✅ VERIFIED

| Feature | File(s) | How verified (exact command) | Actual observed result | Status |
|---|---|---|---|---|
| 5 gates, in order, fail-closed | `utils/dispatchGate.ts` | `vitest run … __tests__/dispatchGate.test.ts` | **17/17 passed (72ms)**, first run | **VERIFIED** |
| Gate ORDER: DNC ≻ FLAG_OFF ≻ NO_CONSENT ≻ QUIET_HOURS | `dispatchGate.ts:114-153` | suppressed + flag-off + voice + 11pm simultaneously | returned `code:'DNC'` (not FLAG_OFF/NO_CONSENT/QUIET_HOURS) — DNC outranks all | **VERIFIED** |
| DNC suppresses **every** channel, permanently | `isSuppressed()` → `compliance_records` | gate called for sms/voice/rvm with suppressed target | all three `allow:false, code:'DNC'` | **VERIFIED** |
| Flag OFF ⇒ zero dispatches | `betaFlags.isBetaFlagOn` | `cadenceEngine` flag off | `allow:false, code:'FLAG_OFF'` | **VERIFIED** |
| consentBasis gate (voice/RVM only) | `VALID_CONSENT_BASES` | voice/rvm w/ missing + bogus basis; sms w/o basis | missing→`NO_CONSENT`, `'i-said-so'`→`NO_CONSENT`; **sms allowed w/o basis**; both valid bases→allow | **VERIFIED** |
| Quiet hours 8am–9pm lead-local + retryAt | `isWithinQuietHours`, `nextAllowed` | 7am/8am/8pm/9pm boundary probes; deny at 11pm | 7am deny · 8am allow (inclusive) · 8pm allow · 9pm deny (exclusive); `retryAt` lands **inside** quiet hours | **VERIFIED** |
| Send-window snap — cadence steps ONLY | `isWithinSendWindow` | 12:00 local (legal hour, between windows) | non-cadence → **allow**; `isCadenceStep:true` → `OUTSIDE_WINDOW`, `retryAt` inside **both** a window and quiet hours | **VERIFIED** |
| **DST-safe** (no offset drift) | `localHourIn` (Intl), `nextAllowed` 15-min probe | 2026-03-08 spring-forward; EDT vs EST same local hour | 06:00Z→**1am EST**, 07:00Z→**3am EDT** (02:00 correctly does not exist); 16:00Z Jul & 17:00Z Jan both →**12** | **VERIFIED** |
| **Unknown area code ⇒ most restrictive** | `area-codes.timezonesForPhone` | known `+1502…` vs unmapped `+1999…` | known→**1 zone**; unknown→**all US zones**. 8am ET (=5am PT) → `[NY]` allow but `[NY,LA]` **deny**; 8pm PT (=11pm ET) → `[LA]` allow but `[NY,LA]` **deny** | **VERIFIED** |
| Fails CLOSED on error | `dispatchGate` catch | suppression lookup throws | `allow:false` (denies, does not send) | **VERIFIED** |

### INT-1 — Speed-to-Lead latency + provider-aware ack  ✅ VERIFIED (live DB)

| Feature | File(s) | How verified (exact command) | Actual observed result | Status |
|---|---|---|---|---|
| Latency instrumentation + P95, live DB | `utils/sla.ts`, `db/migrations/009_sla_latency.sql` | `RUN_LIVE_FLOWS=1 DATABASE_URL=… vitest run … __tests__/sla.test.ts` | **18/18 passed (3.07s)** against real Neon `inbound_latency` | **VERIFIED** |
| reply_received → ai_dispatched recorded | `recordReplyReceived`, `recordAIDispatched` | live inserts/updates | row created w/ `reply_received_at`; updated w/ `ai_dispatched_at` + provider; only the **most recent pending row per conversation** updated | **VERIFIED** |
| Rolling P95 (env-agnostic, tells the truth) | `computeP95Direct` | live window fixtures | P95 computed correctly over the window; **pending rows (`ai_dispatched_at IS NULL`) excluded**; null when no completed dispatches | **VERIFIED** |
| Provider-aware ack (Decision 1b) | `ANTHROPIC_ACK_THRESHOLD_MS=45_000`, `OLLAMA_ACK_IMMEDIATE` | live threshold cases | anthropic: **no ack <45s**, **ack ≥45s** (boundary `>=` inclusive); **ollama: always acks immediately**; `markAckSent` idempotent (one row) | **VERIFIED** |

**Bugs found by running it (not assumed):**
4. **The whole suite was RED — 18 failing tests — and the INT-1 commit (`6feed53`) had never been run.** Every `sla.test.ts` case died on `No database connection string was provided to neon()`. Root cause: `sql.ts:20` resolves to a throwing `NullishQueryFunction` without `DATABASE_URL`, and `sla.test.ts` (a genuine live-DB test — real `DELETE`, per-conversation row selection, P95 windowing) never adopted the repo's existing live-gate. **Fixed** by adopting the *same* gate as `flows-live.test.ts` (`RUN_LIVE_FLOWS=1 && DATABASE_URL` + `describe.skipIf`) — chosen over mocking `sql`, which would have made every assertion vacuous. Unit suite: 18 red → **0 red**; live run: **18/18 green**.
5. **`dispatchGate` shipped (`de9219d`) with NO test file**, despite being the universal compliance gate for every channel. **Fixed:** wrote `dispatchGate.test.ts` (17 tests) covering each gate individually, gate order, DST, boundary edges, unknown-area-code most-restrictive, and fail-closed. All passed first run — the implementation was correct, it just had no proof.
6. **A ghost test on the SMS send path** (found by the owner-requested 37-skip inventory). `sms-gateway.test.ts:295` was named `should suppress opted-out numbers at gateway level` but its only assertion was `expect(result).toBeDefined()` — which passes whether the message is suppressed **or dispatched to an opted-out number**. Its own comments conceded it ("*we just verify the gateway accepted the message*"). It was `skipIf(!DATABASE_URL)`, so it had never run; had it run it would have been a permanently-green false negative on a TCPA-critical path. **Fixed:** replaced with two real tests that mock `checkConsent` at the module boundary (no live DB needed, nothing skipped) — asserting `status:'failed'`, `errorMessage:'opted_out'`, and `primaryProvider.sendCount === 0` (the carrier never saw it), plus a consent-present counter-test proving the gate isn't a blanket block. **Mutation-proven RED:** with the gate stubbed to `if (false)`, the suppression test fails; the old ghost stayed green under the same mutation. Suite 367→**369 passed**, skips 37→**36**.

| Feature | File(s) | How verified (exact command) | Actual observed result | Status |
|---|---|---|---|---|
| Gateway blocks opted-out numbers | `gateway/sms-gateway.ts:147-164` | `vitest run src/app/api/gateway/sms-gateway.test.ts` | `20 passed (20)`, 0 skipped — `status:'failed'`, `errorMessage:'opted_out'`, `sendCount:0` | **VERIFIED** |
| That test can actually fail | same | mutate gate → `if (false)`, re-run | `× suppresses an opted-out number and never reaches the provider` — RED as required; gate restored (`grep -c "if (!hasConsent)"` → 1) | **VERIFIED** |

**Suite after this checkpoint:** typecheck **0** · unit **367 passed / 37 skipped / 0 failed** (49 files) · INT-1 live **18/18**.


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

## Session 2026-07-13 (g) — Part B deploy prep (scaffold-host sweep + DEPLOY.md)

B1 scaffold-host / hardcoded-origin sweep of the RUNTIME (grep `src`, excl tests):

| file:ref | what | verdict |
|---|---|---|
| `apps/web/src/lib/auth.ts` `trustedOrigins` (BETTER_AUTH_URL, NEXT_PUBLIC_CREATE_HOST, EXPO_PUBLIC_PROXY_BASE_URL) | auth trusted origins | **already env-driven** — prod resolves to `https://dealswiftautomation.com` via `BETTER_AUTH_URL`; the scaffold `NEXT_PUBLIC_CREATE_HOST` entry is filtered out when unset. No change. |
| `apps/web/src/app/api/sms/inbound/route.ts` `PUBLIC_WEBHOOK_URL` | Twilio signature base | **already env-driven** — set to `https://dealswiftautomation.com/api/sms/inbound` in prod. No change. |
| `SocialSignInButtons.tsx`, `account/social-dev-shim/page.tsx`, `api/__create/check-social-secrets/route.ts` `NEXT_PUBLIC_CREATE_*` | scaffold social-auth **dev shim** | gated by `NEXT_PUBLIC_CREATE_ENV==='DEVELOPMENT'` → **inert in prod** (var unset). Documented "leave unset" in DEPLOY.md. No runtime change. |
| `apps/desktop/src/main/config.ts:30` prod `DEFAULT_APP_URL` | desktop prod default host | **FIXED** — was hardcoded `https://app.dealflow.ai` (old placeholder) → now `https://dealswiftautomation.com` (still overridable via `DEALFLOW_APP_URL`). Part C. desktop `tsc` exit 0. |

Result: **no hardcoded scaffold host in the WEB runtime** — origins are all env-driven; the single hardcoded host was the desktop prod default, now pointing at the owner's domain. `DEPLOY.md` written (host = Vercel + Vercel Cron + Neon; **no Redis** — queue is Postgres-backed, verified by grep; DNS records, full prod env-var list, schema/migration apply incl. 006, Twilio webhook, first-deploy checklist, `git push` redeploy). Owner-login steps tagged BLOCKED-ON-OWNER.

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

---

### INT-3 — local-presence number pool (logic layer)  ✅ VERIFIED

Split deliberately: the **selection algorithm is pure** (`numberPool.ts`) and tested with **no DB gate** — 15/15 always run. Only genuine I/O (atomic cap claim, daily reset, setting round-trip) sits behind the live gate in `numberPoolStore.ts`. The interesting logic is therefore never dark.

| Feature | File(s) | How verified (exact command) | Actual observed result | Status |
|---|---|---|---|---|
| Order: exact area code ≻ nearest region ≻ least-used | `utils/numberPool.ts` `selectNumber` | `vitest run numberPool.select.test.ts` (no DB) | `15 passed (15)`. 502-lead→502-number over an idle 213; 859-lead→270 (Western KY) over 213 (LA) **even when LA was unused** — locality outranks balancing; ties→least-used | **VERIFIED** |
| `dailyCap = min(rotationCap, computeDailyCapacity)` | `numberPool.ts` `effectiveDailyCap` | same | medium 10DLC/13h → `{rotationCap:125, carrierCap:10000, effective:125, limitedBy:'rotation'}`; low-trust/0.01h → `{carrierCap:36, effective:36, limitedBy:'carrier'}` | **VERIFIED** |
| Both values visible per-number (guard vs carrier ceiling) | `numberPoolStore.listPoolUsage` | live | `rotationCap:125, carrierCap:10000, effective:125, limitedBy:'rotation', remaining:125` | **VERIFIED** |
| rotationCap default 125, settable, kill-switch at 0 | `numberPoolStore` + `app_settings key='number_pool'` | live + pure | unset→`125`; `setRotationCap(40)`→`40`; `-1`/`1.5` **rejected** (throws, not stored); cap 0 → `selectNumber` returns null | **VERIFIED** |
| Cap never breached; exhausted pool → null | `pickNumber` | live: cap=2, 3 numbers, 8 picks | 6 picks succeeded, `picks[6]`/`picks[7]` **null**; every `daily_sent <= 2`. Null means *don't send* — never "fall back to any number" | **VERIFIED** |
| Daily reset (no cron dependency) | `pickNumber`, lazy reset in SQL | live: `daily_sent=99, last_reset_date=CURRENT_DATE-1`, cap=1 | picked the number; `daily_sent` became **1**, not 100 — yesterday's count did not consume today's cap | **VERIFIED** |
| Concurrent picks cannot double-claim the last slot | `pickNumber` conditional UPDATE | live: 5 racing `pickNumber`, cap=1, one active number | exactly **1** pick returned the number; `daily_sent = 1` | **VERIFIED** |
| Inactive numbers never picked | `selectNumber` + SQL filter | live + pure | inactive 502 skipped for a 502 lead | **VERIFIED** |
| Lint | both modules | `oxlint --no-ignore` (3 files) | `Found 0 warnings and 0 errors` | **VERIFIED** |

**Bugs found by running it (not assumed):**
7. **The daily reset would never have fired — found by the live test, not by review.** `sentToday()` did `String(row.last_reset_date).slice(0,10)`, but the Neon driver returns `date` columns as **JS `Date` objects**, so that produced `"Wed Jul 15"` — not `"2026-07-15"`. The comparison `"Wed Jul 15" < "2026-07-16"` is a lexicographic string compare (`W` > `2`), so it was **always false**: every number would have stuck permanently at its cap after one busy day and the pool would have silently died. Observed: `expected '+12705550102' to be '+15025550101'` — the capped-yesterday number was skipped instead of reset.
8. **Split-brain reset authority (latent, same fix).** The read path used JS UTC (`todayUtc()`) while the claiming UPDATE used Postgres `CURRENT_DATE`. Diagnosed live: `pg CURRENT_DATE = 2026-07-16T04:00:00.000Z` (a Date, offset baked in) vs `js todayUtc() = "2026-07-16"`. On any DB not in the app's timezone the two disagree — the read says "reset", the UPDATE says "capped". **Fixed by removing JS from the decision entirely**: `sent_today` is now computed in SQL (`CASE WHEN last_reset_date < CURRENT_DATE THEN 0 ELSE daily_sent END`), the same `CURRENT_DATE` the claim's WHERE uses, so read and write agree by construction. Both tests green after.
9. **Unbounded retry** in `pickNumber`'s race-loser path (self-review, pre-run): recursed with no depth guard. **Fixed:** `attemptsLeft = 3`, degrading to `null` ("don't send") rather than spinning.
