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
