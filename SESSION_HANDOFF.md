# SESSION_HANDOFF.md — DealFlow AI

_Last session: 2026-07-14 (i). NEW 5-phase prompt (expansion/UX/globe/AI/hardening). Gate -1 clean (main==origin/main). **Phase 1 DONE**: Lead Finder expanded to NC, GA, MO, St. Louis (28 sources, migration 008) — 3 new PERMITTED open-data portals live robots-verified, rest MANUAL_ONLY; ingest+scoring proven on NC data (stacked 53 > single 42), 0 contact leak, suite 332 green. Next: Phase 2 (UX revamp)._

## Session (i) — Phase 2 (IN PROGRESS): click-reduction express paths
- **Campaign launch — Quick Launch express path** (`campaigns/wizard`): a "⚡ Quick Launch (Test Mode)" button on step 1 activates the campaign with smart defaults, FORCED into Personal Test Mode (no real sends — respects the 10DLC gate) — you never leave step 1. Proven live: fills name+opener+one verified test number → **ACTIVE test-mode campaign in 1 click** (`e2e/.proof/quick-launch-campaigns.png`).
  - **Before/after (activation clicks, after step-1 fields):** Next→Next→Next→Launch = **4 clicks across 4 screens** → Quick Launch = **1 click on 1 screen**.
- **Lead-gen → campaign** (`lead-finder`): after "Create campaign from segment", a direct **"Build campaign →"** CTA links straight to the wizard (was: plain text, user navigates manually). Multi-state subtitle + per-state attorney note.
- typecheck 0; suite 332/19 green; no logic/compliance change (Quick Launch only sets testMode+default opener, reuses the existing create+/start).
- **Phase 2 REMAINING (Gate 2 still OPEN):** full visual-system pass (tokens/spacing/palette), onboarding guidance, desktop parity + screenshots on BOTH web and desktop, before/after for the full lead-gen→campaign path. Ship-order: do NOT start Phase 3 until Gate 2 closes.

## Session (i) — Phase 1: Lead Finder multi-state expansion (NC/GA/MO/St. Louis)
- Interpreted "mousiri/St Louis" = **Missouri (statewide) + St. Louis (metro)** (confirmed).
- `db/migrations/008_lead_finder_states.sql`: 28 sources added to the EXISTING registry (no rebuild). Seller + buyer categories per jurisdiction; county probate/tax/deed/code/assessor = MANUAL_ONLY (conservative default).
- **Live robots checks (2026-07-14, pasted in report):** data.mo.gov (Socrata `/resource/`, 1s) → PERMITTED; nconemap.gov (ArcGIS Hub `/datasets,/api`, 60s) → PERMITTED; opendata.atlantaregional.com (ArcGIS Hub, 60s) → PERMITTED; www.stlouis-mo.gov (disallows `/data/*json`+`?parcelId`) → MANUAL_ONLY.
- Gate 1 proven live: NC Probate ingest → 2 rows, scored via EXISTING scorer (stacked probate+absentee+equity 53 > single 42), provenance intact, **0 contact data**. Migration wired into CI bootstrap. Existing suite 332/19 green. Test data cleaned.
- NOT LEGAL ADVICE: owner confirms each source's terms with an attorney **per state** (FINAL_STATE.md).

---

_Prior — session 2026-07-13 (f–h). Built the **Lead Finder** module (5 gates live), **Part B** deploy prep (DEPLOY.md + `anything-web` Vercel wiring), and an **AI-provider option** (hosted Claude OR local Ollama, in-app toggle). Suite 323/19, typecheck 0. Next: Part C, then full launch-verification pass._

## Session (h) — AI provider option (Anthropic hosted OR local Ollama)

Owner-requested optional feature: run the app's AI on Anthropic (credits) OR a local open-source model via Ollama (free per message), toggled in **Settings → AI Provider**.
- **Single entry point `callAI`** (`ai-provider.ts`) dispatches to `callAnthropic` (default) or `callOllama` (new `ollama-client.ts`, native `/api/chat`, same AnthropicResponse shape + shared error taxonomy). Only caller (`ai-orchestrator.ts`) updated; provider-agnostic.
- **`app_settings` table** (migration 007) + `ai-settings.ts` resolver: DB toggle → env (`AI_PROVIDER`/`OLLAMA_BASE_URL`/`OLLAMA_MODEL`) → default (anthropic), 15s cache. `PUT /api/settings/ai-provider` (admin) persists; `GET /api/system/ai-status` (admin) live-tests the active backend.
- **UI:** `AiProviderCard` in Settings — provider picker, Ollama URL/model, Save, Test connection, launch guide. Screenshot `e2e/.proof/ai-provider.png`.
- **Proven live:** toggle persists (source=db); Ollama status → clean "is `ollama serve` running?"; Anthropic status → real $0-credit error. 11 unit tests (mapping/resolution/dispatch). Added to `LAUNCH_VERIFICATION_CHECKLIST.md` §5.4.
- Note: this is the owner overriding the earlier "Anthropic-only runtime" rule with an explicit, opt-in local alternative. Anthropic remains the default; Ollama is a self-hosted open model, not a competing cloud vendor.

## Session (f) — Lead Finder module (standalone, plugs into the pipeline)

New module: `apps/web/src/app/lead-finder/` (UI) + `apps/web/src/app/api/lead-finder/*` (routes) + migration `006_lead_finder.sql` (`lead_sources`, `sourced_leads`, `lead_source_uploads`). Added to the sidebar + the RBAC middleware matcher (admin-gated) + CI migration bootstrap.

**Compliance is the architecture:** `sourced_leads` has NO phone/email columns; the CSV normalizer strips any contact-looking column before persistence (skip-trace resolves phones downstream). Registry marks each source PERMITTED / MANUAL_ONLY / PROHIBITED; only **Louisville Metro Open Data** is PERMITTED (live robots check 2026-07-12: `/resource/` allowed, 60s crawl-delay). All others MANUAL_ONLY (owner uploads; never scraped). Routes refuse to set PERMITTED without a recorded live robots check. NOT LEGAL ADVICE note in FINAL_STATE.md.

**Gates proven live (all 5):**
- G1 registry: `/api/lead-finder/sources` lists 9 seeded KY sources with verified access_method + terms_status; UI shows upload slots + PERMITTED/MANUAL badges.
- G2 ingest: probate fixture (4 rows) → 2 inserted, 1 deduped (parcel+address), 1 failed; DB grep proves **0 contact-data fields** populated; provenance on every row.
- G3 scoring: stacked Jane Heir (probate+absentee+equity)=**53** > single Bob Local (probate)=**37**; human "why" strings correct. (No standalone scorer existed to wire into — the score lives on the sourced lead and maps into `leads.metadata` at handoff; verified there is no second scorer.)
- G4 handoff: "Create campaign from segment" → 2 `leads` rows (source=lead-finder, phone/email NULL, metadata carries score+provenance+needs_skip_trace); sourced_leads flip to handed_off. Feeds the EXISTING import→skip-trace→DNC→wizard machine.
- G5 UI: live screenshot `e2e/.proof/lead-finder.png` — registry + scored table + segment action, real data. Desktop surfaces it automatically (Electron loads the web app).

10 new unit tests (normalizer/scorer/dedupe/compliance-strip). Suite 306 passed / 19 skipped; typecheck 0.

## Session (g) — Part B: deploy prep for dealswiftautomation.com

- **B1 scaffold sweep (BREAKAGE_TABLE session g):** web runtime is already env-driven (`BETTER_AUTH_URL`, `PUBLIC_WEBHOOK_URL`, auth `trustedOrigins`) — no hardcoded scaffold host. The `NEXT_PUBLIC_CREATE_*` refs are a dev-only social shim, inert in prod. The one hardcoded host was the **desktop** prod default (`https://app.dealflow.ai`) → **fixed** to `https://dealswiftautomation.com` (env-overridable via `DEALFLOW_APP_URL`; desktop `tsc` 0). That also satisfies Part C (desktop points at the domain in prod; it loads the gated web app so it honors domain-lock + RBAC automatically).
- **B2 `DEPLOY.md` written** (repo root): host = **Vercel + Vercel Cron + Neon** (NO Redis — the job queue is Postgres-backed, grep-verified; the drain is `POST /api/jobs/process`). Includes DNS records for apex+www, full prod env-var list (names+purpose, no values), idempotent schema+migrations apply (incl. 006), Vercel Cron job runner, Twilio prod webhook, first-deploy checklist, and `git push`=redeploy. Owner-login steps tagged BLOCKED-ON-OWNER.
- **B3:** auto-deploy documented (push to main → CI → Vercel build). Actual wiring is BLOCKED-ON-OWNER (needs the Vercel account + domain + prod secrets).

**Deferred (next):** automated fetch worker for PERMITTED sources (Louisville Open Data SODA API, robots-honoring + 60s rate-limit) — deferred until the owner confirms dataset terms with a KY attorney. Also: prompt-3 Launch Verification as a formal checklist pass; owner-blocked items (Anthropic credit, DNS, Vercel/Twilio logins) per DEPLOY.md.

---

_Prior — session 2026-07-12 (e). Reconciled repo state, hardened the in-flight domain-lock + RBAC work: adversarial code review → fixed 5 confirmed defects (incl. a CI-blocking typecheck error, fully-broken API-key revocation, and a 7-day session-revocation hole) — all proven live. Suite 296/19, e2e 3/3, typecheck 0._

## Session (e) — STEP -1 reconciliation + RBAC/domain-lock hardening

**Reconciliation (source of truth = `main`, clean):** local `main` == `origin/main` (a630589), no divergence. Other branches (`verification-sprint`, `agents/*`, two `copilot/*`) are all ≤ main or 1 stale commit behind on unrelated tooling — none ahead with real work. The uncommitted working tree WAS the in-flight domain-lock + RBAC feature (Part A of the RBAC/deploy prompt): `access-control.ts`, `authz.ts`, admin routes/UI, migrations 004/005, middleware access gate, auth domain hooks. Docs matched git. No merge/rebase needed.

**RBAC state = functionally complete + now hardened.** Enforced in depth (all proven live this session):
- **Layer 1/2 (register/login):** out-of-domain email → 403 at both `/sign-up/email` and `/sign-in/email`; no user row created. In-domain signup → MEMBER.
- **Layer 3 (middleware access gate):** in-domain MEMBER (below `MIN_ACCESS_ROLE=ADMIN`) → `/pending-access` redirect / 403 JSON; out-of-domain session → `/access-restricted` / 403; ADMIN passes.
- **Layer 4 (v1 API):** key issuance admin-only; key validity re-checks owner domain+role every request (proved: valid key → 403 the instant its owner is demoted).
- **Admin UI:** promote/demote live; last-admin guard unit-tested; owner `roman.shumate@dealswiftautomation.com` seeded ADMIN (single admin row confirmed).

**5 defects found by adversarial review + fixed + PROVEN (see BREAKAGE_TABLE rows 15–19):**
1. `analytics/route.ts` `money()` undefined → CI typecheck failed (my earlier `npx tsc` was a false pass). Added local helper.
2. `DELETE /api/settings/api-keys/[id]` read `props.params.id` sync → Next 16 params is a Promise → revocation 100% broken (404). Now `await`ed.
3. `session.cookieCache` (7-day) served stale sessions → demotion/revocation didn't take effect for up to 7 days. **Disabled cookieCache** → revocation immediate (live: `/api/campaigns` 200→401 on session delete).
4. `/api/system/{database,metrics,queue-status}` had NO auth; `/readiness` any-session → operational-data leak. Added `requireAdmin` (health/cron unchanged).
5. Analytics "Est. revenue" showed the estimated slice, not total. Fixed to `revenueCents`.

**Gates this session:** typecheck exit 0 · unit 296 passed / 19 skipped · e2e journey 1/1 + marketing 2/2 green.

---

_Prior — session 2026-07-10 (d): Wired the owner's Anthropic key (live call proven), resolved the "Gemini" confusion, deepened analytics, added a CRM._

## Session (d) — Anthropic key, Gemini audit, analytics depth, CRM
- **AI vendor = Anthropic (Claude), confirmed.** The 4 "Gemini" references were stale UI TEXT only (2 marketing pages, 2 dashboard health panels) — zero runtime Gemini/Google calls. All relabelled to "Claude". The message path already uses the shared `anthropic-client.ts`.
- **Owner's new Anthropic key set** in gitignored `apps/web/.env` + `ANTHROPIC_MODEL=claude-sonnet-5`. **Live call PROVEN**: preflight Check 4 → `model=claude-sonnet-5, input_tokens=17, output_tokens=4` ✅. ⚠️ The key was pasted in plaintext chat — **owner should rotate it** in the Anthropic console.
- **Analytics deepened** (`/api/analytics` + `/analytics` page, extended not replaced): per-stage conversion rates, response/opt-out/delivery rates, cost-per-contact, cost-per-deal, ESTIMATED profit margin (real costs − closed×assumed fee via `ASSIGNMENT_FEE_CENTS`), per-campaign table, 14-day time series. Proven live with seeded mock data ($0): overall conv 1.9%, response 42.9%, opt-out 5.7%, cost/deal $1.73, est. margin $19,996.55 (`e2e/.proof/c-analytics.png`).
- **CRM added** (`/crm` page + `/api/crm/contacts` list + `[id]` detail): filterable contact table (status/campaign/search), CSV export, per-contact drawer with conversation history + negotiation ladder + manual opt-out. Over EXISTING campaign_contacts data (no new lead system). Sidebar link added.
- **Gates**: typecheck exit 0; unit 252 passed / 19 skipped; e2e 3/3 green.
- **Operational lesson (reinforced): after adding/removing route files, RESTART with `rm -rf apps/web/.next`.** A warm restart left a partial route manifest (whole `/api/*` tree 404'd); clearing `.next` fixed it. Also unset BOTH `YARN_TMP_FOLDER` and `ELECTRON_RUN_AS_NODE` before yarn/electron.
- **Deferred (owner chose local-only earlier; v3.0 prompt Missions B/D):** own-domain deploy to dealswiftautomation.com (that domain is a SEPARATE marketing site, not this app), Lighthouse, Windows installer, 5k-contact sim, real-SMS loopback. Not started this session.



## Session (c) additions — white screen + marketing routing
- **White screen (real-user first load) FIXED.** Root cause: `GET /api/auth/get-session` was 500ing ("Jest worker child process exceptions") because a stale/uncleared `.next` cache + orphaned Playwright/tinypool workers I'd left running starved the dev server and crashed the auth-route worker. Every page's `useSession()` then hung → blank render. Fix: kill orphaned workers, clear `.next`, clean reboot → get-session 200 (4/4); unauthenticated `/` now renders the sign-in form (`unauth-probe.mjs`). **Operational lesson: don't leave orphaned `next dev` / playwright test-server / tinypool processes running — they starve the dev server. Kill stragglers + `rm -rf apps/web/.next` if pages start rendering blank.**
- **Marketing landing was unreachable + `/dashboard` 404'd.** `app/page.tsx` (dashboard) and `app/(marketing)/page.tsx` both resolved to `/`; the dashboard won, hiding the marketing site, and the sidebar "Dashboard" link (`/dashboard`) 404'd. Per owner decision (**marketing for guests, app for users**): moved dashboard → `app/dashboard/page.tsx`, marketing group now owns `/`, and authenticated `/` redirects to `/dashboard`.
- **Full e2e suite GREEN**: `journey.spec.ts` + `marketing.spec.ts` (rewritten for the real unauthenticated funnel) = **3/3**. Typecheck exit 0; unit 252 passed / 19 skipped.
- **Known follow-up (non-blocking):** marketing pages are still wrapped by the client `Shell`, so guest `/` SSRs a brief spinner before the marketing content hydrates in (bad for SEO/first-paint). Proper fix = move the app `Shell` into an `(app)` route group so marketing renders server-only. Deferred.



## Preflight Table (latest run — dev server up)

```
#  | CHECK                 | RESULT
───┼───────────────────────┼────────
1  | ENVIRONMENT VARIABLES | ✅ PASS
2  | DATABASE              | ✅ PASS
3  | CAMPAIGN STATE        | ✅ PASS
4  | ANTHROPIC API         | ❌ FAIL  (invalid x-api-key — BLOCKED-ON-OWNER)
5  | TWILIO REST           | ✅ PASS
6  | WEBHOOK REACHABILITY  | ✅ PASS  (was FAIL; recovered — dev server + uuid fix)
7  | JOB ENGINE            | ❌ FAIL  (downstream of #4 + no jobs:dev during preflight)
8  | OUTBOUND              | ✅ PASS

Total: 22 PASS, 2 FAIL, 1 SKIP
```

## Proven working in the LIVE app this session (evidence in `apps/web/e2e/.proof/`)

| Journey step | Proof |
|--------------|-------|
| App shell + tailwind styling | dashboard renders fully styled — `01-after-register.png`; all 10 routes HTTP 200 |
| Register → dashboard (auth gate) | GUI signup lands authenticated on `/` (`walk-*.mjs`) |
| Every sidebar tab | 8 tabs + wizard + import, **0 console errors, 0 failed network calls** (`walk-report.json`) |
| Lead import (paste) | 10-row mixed fixture → `{inserted:8, duplicates:1, failed:1}`, **8 rows in live DB** |
| Lead import (file) | CSV upload → `{inserted:3}`, **3 rows in live DB** |
| Analytics funnel | renders non-zero (Engaged 11, Negotiated 11), $0 cost — `tab-analytics.png` |
| Wizard build + launch → ACTIVE | 4 ACTIVE campaigns in DB; journey asserts `status==='ACTIVE'` |
| Inbox thread + approvals unblock | journey spec 3/3 green (inbound → thread renders → approve → NEGOTIATING in DB) |
| Jobs enqueue | 8 `ai_reply` jobs enqueued by journey inbound steps |
| E2E journey (10-step) | `journey.spec.ts` **3/3 green** (`--repeat-each=3`) |
| Unit/integration suite | **252 passed / 19 skipped** (`npx vitest run`) |

## Fixes shipped this session (all FIXED+PROVEN — see BREAKAGE_TABLE.md rows 2,4–10)

- `sms-gateway.ts`: `uuid` → `node:crypto` `randomUUID` (de-hoist broke the import; 500'd jobs + cascaded to signup).
- `Shell.tsx`: collapsed nested `<a>` (hydration error every page) to `<SidebarMenuButton asChild><Link>`.
- New routes: `api/approvals/count` (405→200), `api/contracts` (404→200), `api/analytics` (404→funnel).
- Wizard `launch()`: now creates → POST `/start` so "Launch" actually ACTIVATES (was identical to saveDraft).
- `journey.spec.ts`: inbound signs `PUBLIC_WEBHOOK_URL` (403→200) + new `status==='ACTIVE'` assertion.

## Single next task
No OPEN GUI-journey rows remain. Next: **owner supplies a valid `ANTHROPIC_API_KEY`**
in `apps/web/.env`, then re-run `node --env-file=.env scripts/preflight.mjs` — Checks
4 + 7 should flip to PASS, unblocking live AI replies (the last unproven link is a
real SMS→AI round-trip, which needs the valid key + a running `yarn jobs:dev`).

## Pending owner actions
- **BLOCKED-ON-OWNER: Anthropic API key has $0 credit balance.** As of session (e) the key AUTHENTICATES (no longer 401) but every call 400s with `"Your credit balance is too low to access the Anthropic API"` (preflight Check 4 + job engine Check 7 dead-letter after 3 attempts). Owner must add credits/upgrade at console.anthropic.com → Plans & Billing. Nothing in code blocks AI; this is purely account billing.
- ngrok running (`ngrok http 4000`) + Twilio Console webhook → `POST https://<ngrok>/api/sms/inbound` for a real inbound round-trip.
- Live test-mode campaign launch via GUI wizard for a real SMS send.

## Environment gotcha (applies to THIS shell only)
`YARN_TMP_FOLDER` is set in the inherited process env and breaks every `yarn`
command (Yarn 4.12 rejects the legacy `tmpFolder` setting). Prefix yarn/node
commands with `unset YARN_TMP_FOLDER;`. Not persisted to the registry → fresh
terminals are fine.

## How to boot + re-verify
```
# T1 (dev server):   unset YARN_TMP_FOLDER; cd apps/web && yarn dev            # :4000
# T2 (jobs runner):  unset YARN_TMP_FOLDER; cd apps/web && node --env-file=.env scripts/jobs-dev.mjs
# preflight:         cd apps/web && node --env-file=.env scripts/preflight.mjs
# live walk:         cd apps/web && node --env-file=.env scripts/live-walk.mjs       # screenshots every tab
# import proof:      cd apps/web && node --env-file=.env scripts/import-walk.mjs     # paste+file+DB verify
# e2e journey 3/3:   cd apps/web && PW_CHANNEL=msedge npx playwright test e2e/journey.spec.ts --repeat-each=3
# unit suite:        cd apps/web && npx vitest run --config src/app/api/vitest.config.ts
```

## Uncommitted changes this session (code)
- `apps/web/src/app/api/gateway/sms-gateway.ts` — uuid → randomUUID.
- `apps/web/src/components/Shell.tsx` — sidebar anchor nesting fix.
- `apps/web/src/app/api/approvals/count/route.ts` — NEW.
- `apps/web/src/app/api/contracts/route.ts` — NEW.
- `apps/web/src/app/api/analytics/route.ts` — NEW.
- `apps/web/src/app/campaigns/wizard/page.tsx` — launch() activates via /start.
- `apps/web/e2e/journey.spec.ts` — signing URL + ACTIVE assertion.
- Proof/driver scripts: `scripts/live-walk.mjs`, `scripts/import-walk.mjs`, `scripts/probe-signup.mjs`, `scripts/introspect.mjs`, `scripts/enum.mjs`, `scripts/jobs-check.mjs`; screenshots in `e2e/.proof/`.

## .env edits this session
None. (Anthropic key untouched — its invalidity is an owner action, not a code change.)

## Storage note
C: has 58G free, D: has 2.7T free — healthy (the prior "C: 100% full" is solved by
`.yarnrc.yml` redirecting the yarn cache to D:). `apps/web/.next` is ~856M (live dev
cache, regenerable). NOT DealFlow: `d:\anything\odysseus\**\data\*.db` — a separate
project's DBs, with an accidental-looking `odysseus/odysseus/` duplicate. Left for the
owner to review/delete (not created here).
