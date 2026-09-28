# PRODUCTION HARDENING CHECKPOINT

**Purpose:** single resume point for this mission. A new session must read this
first and must NOT redo completed work.

## Repo state
- branch: `feat/cloudflare-workers`
- last commit: see `git log --oneline -1`
- working tree: commit before resuming
- app root: `D:\anything\apps\web`
- dev server used for verification: `node node_modules/next/dist/bin/next dev -p 4000`
  (the CSRF origin gate only trusts `http://localhost:4000` - do NOT use another
  port or every signup is rejected with `INVALID_ORIGIN`)

## Verified good recovery point
`git log --oneline -1` == the commit that took nested SQL fragments 66 -> 0.
At that commit: typecheck exit 0, 2645 unit tests pass, build exit 0, E2E 2 pass,
api-probe PASS, verify-sql-fixes 9/9.

## Exact commands (these work; the naive ones hang)
Run long jobs through a background .cmd and poll the log - foreground calls time
out at 30s and leave stuck node processes holding ~1GB.

```
# typecheck
node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit
# unit suite
node node_modules/vitest/vitest.mjs run --config src/app/api/vitest.config.ts
# build
node node_modules/next/dist/bin/next build
# e2e
node node_modules/@playwright/test/cli.js test
# api probe (needs server on :4000)
node scripts/api-probe.mjs
# live SQL verification
npx tsx scripts/verify-sql-fixes.mjs
# fragment scan (must print 0)
node scripts/scan-fragments.mjs
# authenticated browser QA (base URL is a POSITIONAL arg, not an env var)
node scripts/browser-qa.mjs http://localhost:4000 --auth --warm
```

## COMPLETE
- Defect #30 signup/session transaction visibility
- Defect #31 missing owner_user_id on org creation
- Defect #32 nested SQL fragments: **66 -> 0**, hard-zero guard in place
- Defect #33 contracts.metadata (migration 092)
- Defect #34 rate-limit uuid/text mismatch (migration 093)
- Defect #35 prompt-injection markers
- Defect #36 public feedback exposing user_id/author_id - re-verified live:
  public GET /api/feedback returns 200 with no ids
- Defect #37 sql.unsafe bound as a value -> 2 latent 500s; banned by guard
- Placeholder-offset bug in buildWhere (found by the live harness)
- templates enum validation both directions (shared lib/templateEnums)
- Migration gate: baseline + 93 migrations, idempotent, 0 drift vs live
- CSRF gate, client-secret removal, tax/payout UI, dependency upgrades
- Gates green at the recovery point above

## OPEN DEFECTS (blockers - the real remaining work)

Root cause of the cluster: several dashboard queries were written against a
schema that DOES NOT EXIST. Real schema facts (verified via information_schema):
- `leads` has NO first_name/last_name/property_address/deal_value. Those live in
  `metadata` jsonb, which contains: tier, phase, state, signals, propertyValue,
  motivationScore.
- `ai_conversations`: id, lead_id, channel, history(jsonb), status,
  confidence_score, requires_human, last_message_at, created_at. NO message_type.
  Table is currently EMPTY.
- Tables that DO NOT EXIST: `outreach_log`, `inbound_messages`, `daily_activity`,
  `messages`. Any query naming them must be rewritten to a real source, NOT given
  a new table by migration unless the product genuinely needs that history.

| ID | endpoint | current error | status |
|---|---|---|---|
| 38 | /api/dashboard/quick-stats | FIXED (was `message_type`) - now 200 | needs re-verify + test |
| 39 | /api/admin/stats | `column "createdAt" does not exist`, `relation "messages" does not exist` | OPEN |
| 40 | /api/dashboard/engagements | `column c.message_type does not exist` | OPEN |
| 43 | /api/dashboard/stats | `column "organization_id" does not exist` (on a table with no org column) | OPEN |
| 44 | /api/dashboard/funnel | `column "deal_value" does not exist` | OPEN |
| 45 | /api/dashboard/next-actions | `column l.first_name does not exist` | OPEN |
| 46 | /api/dashboard/activity | 500 internally but degrades to `{activities:[]}` via catch - SILENT, must fix not hide | OPEN |
| 47 | /api/dashboard/weekly-progress | 200 but `outreach_log` missing -> returns zeros; verify it is honest | OPEN |
| 41 | /buyers page | `TypeError: buyers.map is not a function` - response is not an array | OPEN |
| 42 | /pricing, /funnel pages | console errors / near-empty render (text=48) | OPEN |

NOTE ON 46/47: several routes wrap queries in `.catch(...)` and return an empty
or zero payload. That is a SILENT failure that makes broken SQL look like a
working page. The earlier fragment work already replaced several of these
catches with logging - keep doing that; do not reintroduce silent catches.

## WHAT TO DO NEXT, IN ORDER
1. Fix #39 admin/stats: drop `createdAt` (use created_at) and replace the
   `messages` relation with a real table.
2. Fix #40 engagements: replace `c.message_type` with a real ai_conversations
   column (channel / history / last_message_at).
3. Fix #43 stats, #44 funnel (`deal_value` -> real source, e.g. contracts
   contract_price_cents or leads.metadata), #45 next-actions
   (`l.first_name` -> leads.name or metadata).
4. Fix #46 activity: remove the silent catch, map to a real activity source
   (audit_logs / ai_conversations / campaign_leads all exist).
5. Fix #41 buyers: find the endpoint the page calls, make its response an array
   (or make the page handle the real shape). Do NOT fake data.
6. Fix #42 pricing/funnel console errors.
7. Add a regression test per fix; re-run: typecheck, unit suite, build, e2e,
   api-probe, browser QA. Browser QA must reach 70/70.
8. THEN restart the whole acceptance cycle (browser audit, console/network,
   security, data-leak, payment, database, performance, adversarial) and keep
   fixing whatever it finds.

## HOW TO REPRODUCE THE DASHBOARD CLUSTER
The dev server log lists every schema error:
`Select-String -Path dev4000.log -Pattern 'does not exist'`
and the api-probe now includes all 8 dashboard/admin endpoints, so a single
probe run shows current 200/500 for each.

## DO NOT
- Do not weaken the CSRF origin gate to make a probe pass.
- Do not add a migration to create `outreach_log`/`messages`/etc. just to silence
  a query; fix the query against the real schema.
- Do not reintroduce `.catch(() => [])` on a query - it converts a 500 into a
  plausible-looking empty result.
- Do not report 10/10 while any table above is OPEN.

## SCORE STATE
Not 10/10. The dashboard - the landing page of the product - has 5 endpoints
returning 500 and 2 more silently returning empty data. Scores on record:
security 8, engineering 8.5, testing 8.5, overall 8 - all now superseded downward
because the browser gate regressed to 61/70 with 9 failures.

---

## UPDATE (latest session) - dashboard cluster partially closed

Commit `8a10166` fixed 6 of the 8 schema-broken endpoints. Verified by live
HTTP against a signed-up user, not by inspection:

| endpoint | before | after |
|---|---|---|
| /api/dashboard/quick-stats | 500 | **200** |
| /api/dashboard/stats | 500 | **200** |
| /api/dashboard/engagements | 500 | **200** |
| /api/dashboard/funnel | 500 | **200** |
| /api/dashboard/activity | 500 silently -> [] | **200** |
| /api/dashboard/weekly-progress | 200 but zeros | **200** |
| /api/dashboard/next-actions | 500 | **UNVERIFIED** - last edit not re-probed |
| /api/admin/stats | 500 | **UNVERIFIED** - last edit not re-probed |

### IMMEDIATE NEXT ACTION - do this first
The last api-probe run failed at synthetic-user creation:
`POST /api/auth/sign-up/email -> 500` (HTML error page, dev log shows a ~98s
compile then a fast 500). Until that is resolved the probe cannot authenticate,
so NO authenticated endpoint can be verified. Two hypotheses to check in order:
1. Signup rate-limiting after many probe runs (the probe creates 2 users per
   run; it has run many times). Check for a 429 or a rate-limit log line.
2. A genuine regression from the last next-actions edit. Check with:
   `Select-String -Path dev4000.log -Pattern 'sign-up' -Context 0,10`
Restart the dev server first if the log looks stale:
   kill the node process holding port 4000, then
   `node node_modules/next/dist/bin/next dev -p 4000`

Once signup works: re-run `node scripts/api-probe.mjs` and confirm
next-actions + admin/stats are 200.

### THEN
1. Re-run the gates for the 6 changed files: typecheck, unit suite, build, e2e.
   They have NOT been re-run since commit 8a10166.
2. Defect #41 `/buyers` - `TypeError: buyers.map is not a function`. Find the
   endpoint the page calls and make its real response match what the page
   expects. Do not fake an array.
3. Defect #42 `/pricing` and `/funnel` console errors, `/funnel` text=48
   (near-empty render).
4. Re-run browser QA: `node scripts/browser-qa.mjs http://localhost:4000 --auth --warm`
   Target 70/70.
5. Then restart the FULL acceptance cycle: browser audit, console/network,
   security, data-leak, payment, database, performance, adversarial review - and
   keep fixing whatever that finds. The mission is not complete.

### Remaining silent-failure risk to audit for
Several routes still wrap queries in `.catch(...)` and return empty/zero
payloads (activity and weekly-progress were two). A 500 that renders as "no
data" is worse than a visible error. Sweep the api directory for
`.catch(() => [])` / `.catch(() => [{}])` / `.catch(() => ({` and decide, per
site, whether an empty result is genuinely the intended product behaviour.

---

## SESSION 3 UPDATE - dashboard cluster CLOSED, buyers fixed

Commit `21fabc7` (after `99705e2`, `8a10166`).

### The signup 500 was NOT an application bug - important distinction
Both hypotheses in the previous checkpoint were wrong. The cause was a corrupted
dev-server build cache: after `Remove-Item .next -Recurse` and a restart, signup
returns 200 and always has. Do not "fix" signup again. What the investigation DID
produce is a real defect: `api/auth/[...all]` logged nothing, because
`toNextJsHandler` reports upstream failures as a 5xx RESPONSE rather than a
throw. A silent 500 on sign-up is undiagnosable; it now logs any >=500 with its
body and still returns a generic message to the client.

### All 8 dashboard/admin endpoints now 200 (live, authenticated)
quick-stats, stats, engagements, funnel, activity, weekly-progress,
next-actions, admin/stats. All previously 500.

Two more found and fixed while closing this:
- `feedback`: `ORDER BY ${orderByClause}` bound a STRING as $n -> 500 for
  everyone. This is the SAME defect class I had previously "fixed" in that file,
  reintroduced. Nine duplicated query blocks are now ONE buildWhere query, so
  the access-control rules exist once. Invalid category/status is now 400.
- `duplicates`: a blanket `buildWhere()` -> `buildWhere(4)` had hit all four
  helpers; three had wrong offsets and 500'd. Now 4/1/1/3, each pinned by
  `verify-sql-fixes.mjs` case 8.

### Gates GREEN after commit 99705e2 / 21fabc7
- typecheck exit 0
- unit suite: 2645 passed / 0 failed (235 files), exit 0
- next build: exit 0 (compiled successfully)
- E2E: 2 passed, exit 0
- api-probe: PASS, exit 0 (incl. all 8 dashboard endpoints; POST /api/duplicates
  401 anonymous; public feedback has no user_id/author_id)
- verify-sql-fixes: 13/13 against the live database
- scan-fragments: 0 sites

### Test-suite flakiness fixed
`client-secret-scan` and `sql-fragment-composition` guards scan every file under
src/ and sat at vitest's 5s default; under load they timed out (2643/2645) while
the same 12 tests passed 12/12 in isolation. Both `describe` blocks now have a
30s timeout. A flaky guard is worse than a slow one.

### STILL OPEN
- Defect #42: `/pricing` and `/funnel` produce console errors; `/funnel` renders
  text=48 (near-empty). NOT yet investigated or fixed.
- Browser QA has NOT been re-run to completion since the buyers fix. The last
  complete run (before these fixes) was 61/70. Target is 70/70.
- Defect #41 (buyers) is fixed in code and typechecks, but is NOT yet
  browser-verified - confirm /buyers renders without the TypeError.

### NEXT ACTIONS, IN ORDER
1. `node scripts/browser-qa.mjs http://localhost:4000 --auth --warm`
   (needs the dev server on :4000 - the CSRF origin gate only trusts that port)
   Confirm /buyers, /pricing, /funnel. Record the TOTAL line.
2. Fix defect #42 (/pricing, /funnel console errors + near-empty /funnel).
3. Re-run the full gate after that change: typecheck, suite, build, e2e, probe.
4. THEN continue the original 17-item mission and the security addendum. Large
   parts of both remain unre-verified in this session.

### ENVIRONMENT GOTCHAS (cost real time - do not rediscover)
- Long jobs MUST run via a background .cmd + log polling. Foreground calls time
  out at 30s and leave ~1GB stuck node processes. Kill them by PID if so.
- Never run the unit suite concurrently with browser QA or the build: the
  whole-tree scan guards will time out and you will misread it as a failure.
- Do not use `yarn` inside .cmd; call
  `node node_modules/typescript/bin/tsc -p tsconfig.typecheck.json --noEmit`,
  `node node_modules/vitest/vitest.mjs run --config src/app/api/vitest.config.ts`,
  `node node_modules/next/dist/bin/next build`,
  `node node_modules/@playwright/test/cli.js test`.
- browser-qa takes the base URL as a POSITIONAL arg, not an env var.
- PowerShell `-replace` on .ts files is risky: it once inserted a comment
  containing a BACKTICK inside a SQL template literal, which terminated the
  literal ("Error: Expected a semicolon"). Prefer the editor tool.
- `buildWhere(offset)`: offset = how many placeholders the ENCLOSING statement
  already consumed, so the fragment's first placeholder is $(offset+1).

---

## SESSION 4 - BROWSER QA 70/70 ACHIEVED

**Authenticated browser QA: 70 pass, 0 fail (of 70 route-viewports).**
Command: `node scripts/browser-qa.mjs http://localhost:4000 --auth --warm`
Real signed-up user, real Edge, desktop + mobile viewports, console and network
errors captured.

Progression across sessions (the number is the point, not any single run):
- 60/70 -> 61/70 -> 68/70 -> 69/70 -> **70/70**

Defects closed in this session:
- #42 /pricing React key warning (key was on the inner `tr` of a bare fragment).
  This was the last remaining browser failure.
- `/templates` mobile "text=48" was NOT an app defect: the first pass caught the
  page mid-compile. A warm re-run renders 98650B / text=3369, identical to
  desktop. Confirmed rather than assumed.

Browser tooling notes for the next session:
- The harness LOG IS BUFFERED. `Get-Content bqa.log` can return an empty file
  while the run is still going, which previously looked like a hung tool. Poll
  for the literal `TOTAL:` line, do not conclude the harness is broken.
- Start it alone. Running the unit suite or build concurrently starves it.
- If the dev server was restarted after a `use client` mistake, EVERY marketing
  route 500s - that is a fast global signal that a client component lost its
  directive.

### Still NOT done (unchanged, and the reason there is no final score)
- Original 17 items 1,2,4,6,8,9,10,12,13,14,15,16,17: not independently
  re-verified this session.
- Security addendum: no new adversarial pass this session.
- Data-leak audit, performance measurement, financial lifecycle tests: not run.
- 48 users have no org membership (historical orphans) - cleanup not done.
- Final full regression has NOT been re-run since the pricing fix.

---

## PERFORMANCE EVIDENCE (original item 6 - the "5-10 second" complaint)

Measured against the PRODUCTION build (`next build` output, served on :4001),
not the dev server. Unauthenticated requests, so these render the auth shell;
the point is server/route cost, not data volume.

| route | cold (1st hit) | warm (2nd hit) |
|---|---|---|
| /dashboard | 1490 ms | 42 ms |
| /payouts | 748 ms | 41 ms |
| /templates | 535 ms | 42 ms |
| / | 445 ms | 333 ms |
| /pricing | 295 ms | 95 ms |
| /contracts | 199 ms | 43 ms |
| /leads, /campaigns, /analytics, /crm | 77-107 ms | 37-44 ms |

FINDING: the reported 5-10 second load is NOT reproducible on a production
build. Warm server time is 37-95 ms for every route except the homepage
(333 ms). Cold cost is 445-1490 ms, which is normal first-hit work.

The multi-second numbers previously recorded were DEV-MODE JIT COMPILATION, not
application slowness - dev measurements in this mission ranged 3-16 s, and a
404 for a non-existent route took 5349 ms purely to compile. Any future
performance claim must state which build it was measured against, or it is
meaningless.

STILL TO DO for item 6: authenticated page loads with real data volumes, API
latency under load, N+1 query audit, bundle size, and a before/after comparison
for any optimization actually applied. The 5-10s claim is now answered
(measured, not reproduced) but the item is not COMPLETE.

Also noted: `/contacts` and `/earnings` return 404. These are NOT defects -
contacts live under `/crm` and `/leads`, earnings under `/payouts` and
`/reports`. Recording so a later session does not "fix" them.

---

## SESSION 4 - FINAL REGRESSION AFTER THE PRICING FIX (all green)

Run after the last code change, in one sequential pass:

| gate | command | result |
|---|---|---|
| typecheck | tsc -p tsconfig.typecheck.json --noEmit | **exit 0** |
| unit suite | vitest run --config src/app/api/vitest.config.ts | **2645 passed / 0 failed** (235 files), exit 0 |
| production build | next build | **exit 0**, compiled successfully |
| E2E | playwright test | **2 passed**, exit 0 |
| browser QA | browser-qa.mjs --auth --warm | **70/70** |
| tenant isolation | tenant-isolation-probe.mjs | **15 checks, 0 leaks**, exit 0 |
| api-probe | api-probe.mjs | **PASS**, exit 0 |
| live SQL | verify-sql-fixes.mjs | **13/13** |
| fragments | scan-fragments.mjs | **0** |

Run them SEQUENTIALLY, never concurrently - concurrent runs starve the
whole-tree scan guards and produce false failures.

## SCORE (honest, and NOT 10/10)

The regression is fully green and the browser gate that was 60/70 is now 70/70.
But 10/10 requires the whole acceptance scope, and much of it has still not been
exercised. Scoring only what has evidence:

- Original 17 tasks: **6/10** - item 11 (restricted signup) COMPLETE with both
  branches proven; item 6 (performance) measured and answered; items 1,2,4,8,9,
  10,12,13,14,15,16,17 not independently re-verified this session.
- Security: **7/10** - CSRF/CORS/IDOR/tenant isolation/admin escalation/secret
  exposure all verified by execution, but no fresh AI-injection, SSRF, XSS,
  webhook-replay or rate-limit-bypass pass was run this session.
- Engineering quality: **8/10** - shared SQL builder, per-file ratchets replaced
  by hard zero, real schema verification, honest treatment of un-derivable data.
  The `.catch(() => [])` silent-failure pattern still needs a full audit.
- Testing/QA: **8/10** - 2645 unit tests, 70/70 browser, 15-check isolation
  probe, live SQL harness, migration gate. Mutation/property/fuzz testing absent.
- Performance readiness: **6/10** - the 5-10s claim is answered and not
  reproducible (37-95ms warm), but authenticated loads, API latency under load,
  N+1 and bundle analysis are not done.
- Financial readiness: **3/10** - no lifecycle testing this session; Stripe
  credentials absent. Atomicity/idempotency/concurrency of credits, payouts and
  tax withholding are UNVERIFIED.
- Database: **8/10** - 93 migrations gated, schema verified against reality.
  48 orphaned users (no org membership) still need cleanup.

**OVERALL: 7/10** - not 10/10. The gate that was failing (browser QA) now
passes completely, but the security addendum, the financial lifecycle, most of
the 17 original items, and the data-leak/performance audits remain unexercised.
Those are the next sessions' work, enumerated in the master manifest.

---

## CORRECTION - financial readiness was scored wrong

I previously scored financial readiness 3/10 "no lifecycle testing this
session". That was unfair: I did not look. Corrected from evidence:

Existing and PASSING (inside the 2645):
- idempotency 90 references, duplicate-event 81, race 35, concurrency 33,
  insufficient-funds 28, replay 24, atomicity 21 across
  src/app/api/{billing,payments,withdrawals,tax,esign} and utils, including
  real PGlite-backed concurrency tests (`taxLedgerConcurrency.pglite.test.ts`,
  `aiCreditLimits.pglite.test.ts`). None of these are skipped.
- Credit gates, tax withholding, withdrawal rules, tax report and tax settings
  all have dedicated suites.

REAL GAP FOUND WHILE CHECKING:
- `src/app/api/bank-accounts/__tests__/bank-accounts.test.ts` - **31 tests, all
  31 skipped**. Bank accounts are the payout DESTINATION, so this is a
  financial code path with zero active coverage. Highest-value financial work
  remaining.
- `sla.test.ts` 9/10 skipped, `numberPoolStore.test.ts` 8/9 skipped,
  `flows-live.test.ts` 3/4 skipped.

Corrected financial readiness: **6/10** (was wrongly 3/10). Not higher because
bank-account/payout-destination logic is unexercised and live Stripe flows
remain BLOCKED on credentials.

---

## SESSION 4 CLOSE - STATE AT CHECKPOINT

Commit: e8e62e8 (branch `feat/cloudflare-workers`, clean tree).

### Achieved this session (all evidence-backed)
- Authenticated browser QA: **60/70 -> 70/70**. Defect #42 (React key on a bare
  fragment) was the last failure.
- Dashboard/admin 500 cluster: all 8 endpoints 200 (was 8 broken).
- Defect #41 /buyers: response shape + surfaced error state.
- Defect #37 sql.unsafe; auth 5xx observability; fragment hard-zero guard.
- New `scripts/tenant-isolation-probe.mjs`: 15 checks, 0 leaks.
- Performance answered: 5-10s claim NOT reproducible on production build
  (warm 37-95ms, cold 445-1490ms). The old numbers were dev-mode JIT.
- Full sequential regression green: typecheck 0, 2645/0 unit, build 0, E2E 2/0.

### Highest-value UNBLOCKED work remaining, in order
1. **bank-accounts: 31 tests, all skipped.** Payout destination with zero active
   coverage. Un-skip or write real tests. Highest financial risk found.
2. **Silent-failure audit**: sweep `src/app/api` for
   `.catch(() => [])` / `.catch(() => [{}])` / `.catch(() => ({` and decide per
   site whether an empty result is genuinely intended. A 500 that renders as
   "no data" is how defects #46/#47 hid. The dashboard work fixed 2 instances;
   the class is unaudited.
3. **Security addendum not yet exercised this session**: AI prompt injection,
   indirect injection, SSRF, XSS, CSRF, webhook replay/forgery, rate-limit
   bypass, file/upload abuse, path traversal, security headers, open redirect.
   Tenant isolation / IDOR / admin escalation IS done (15/0).
4. **Data-leak audit**: client bundles, source maps, cookies, localStorage, log
   output, error messages, downloadable files. Only the secret-VALUE scan in
   104 client assets has been run.
5. **48 orphaned users** (no organization_members row) - cleanup or explicit
   decision; they 403 on every org-scoped API.
6. **Original 17 items** 1,2,4,8,9,10,12,13,14,15,16,17: independent
   re-verification, several with real browser workflows.
7. **Mutation / property / fuzz testing** - none exist. Listed as a
   professional-QA principle but never applied.
8. Re-run the full regression after whatever changes next.

### Do NOT redo
Dashboard/schema work, fragment sweep, browser QA, perf measurement, tenant
isolation probe. All verified green at e8e62e8.

### Score
OVERALL 7/10. Not 10/10. Reasons are enumerated in
PRODUCTION-HARDENING-MASTER-STATUS.md section C/E and in the SESSION 4 score
table above. The single largest gap is item 2 + 3 above: unexercised security
addendum plus an unaudited silent-failure class.

---

## SESSION 5 - SILENT-FAILURE CLASS AUDIT (the #1 ranked item)

Requirement was: "one `.catch(() => [])` -> search for ALL swallowed-error
patterns". Done, and it was much larger than a handful.

### Scope found
**99 files, ~155 sites.** My earlier estimate of "182" counted per-line matches
including comment lines; the guard's authoritative count strips comments.

Notably NOT only analytics: financially and compliance critical paths were
affected, including `api/payments/refund`, `api/payments/mark-paid`,
`api/billing/subscribe`, `api/lead-finder/apollo`, `api/esign/self-hosted`, and
`api/utils/dncRegistry`.

### Triage - most are benign, and saying so matters
- `await request.json().catch(() => ({}))` in `payments/refund`,
  `payments/mark-paid`, `billing/subscribe` - this tolerates an EMPTY or
  malformed request body. It is not swallowing a database failure. It is
  acceptable ONLY because those routes validate the body afterwards; that
  validation is what must be confirmed, not the catch.
- Genuine DB-error swallows: the rest, and `dncRegistry` was the worst.

### Fixed: dncRegistry.hasSmsConsent
The `contact_list_members` consent lookup used `.catch(() => [])` while the
`compliance_records` read directly above it THREW. Two defects in one function:
inconsistent failure behaviour, and a swallowed database error that is
indistinguishable from "no consent on file" - so a database outage would look
exactly like an absence of consent records and would never be noticed.

It fails CLOSED (no rows => no consent => do not contact), so it was not a
consent bypass, and it is deliberately still not a throw: consent lookups run
inside send loops and failing closed is correct. The failure is now LOGGED, so
the outage is visible. This is the shape every site in this class should end at:
fail in the safe direction, but never silently.

### Enforced going forward
`src/app/api/__tests__/security/swallowed-error.guard.test.ts` (3 tests, passing):
1. A silent catch in a file with no baseline entry FAILS immediately.
2. A baselined file may not exceed its recorded count, so the total can only
   fall; fixing a site means lowering its number deliberately.
3. `api/feedback/route.ts` and `api/duplicates/route.ts` are asserted at ZERO, so
   the two already-fixed routes cannot regress.

The guard is the deliverable here, not the count. The count cannot drop by 155
edits in one session, but it can now never rise again silently.

### Next in this class
Ranked by risk:
1. `api/analytics/advanced/route.ts` - 16 sites, the single worst file.
2. `api/utils/pipeline-health-engine.ts` and `api/campaigns/monitor/route.ts` -
   7 each.
3. `api/utils/trustSignals.ts` (6), `api/system/cron` (5),
   `api/utils/buyerDiscoveryEngine` (5), `api/debrief` (5),
   `api/analytics/ai-recommendations` (5).
4. Sweep the remaining ~90 single-site files.

Note for whoever continues: some baseline entries are deliberately higher than
the true count (the ratchet permits baseline >= actual). That is safe, but do
not read the baseline total as the exact number of remaining defects.

---

## SESSION 5 CLOSE - STATE AT CHECKPOINT

Commit: 5261678 (branch `feat/cloudflare-workers`, clean tree).
Gates after this change: typecheck exit 0; **2648 passed / 0 failed (236
files)**, exit 0. Browser QA 70/70 and tenant isolation 15/0 were verified
before it and are not re-run for a docs+guard+dnc change, but MUST be re-run
before any completion claim.

### Done this session
- Silent-failure CLASS audit (the #1 ranked item): 99 files / ~155 sites found,
  triaged, one safety-critical fix (dncRegistry consent lookup), and the class is
  now enforced by a ratchet guard that can only tighten.

### Next work, ranked, all UNBLOCKED
1. `api/analytics/advanced/route.ts` - **16 silent catches in one file**, the
   worst remaining cluster. Then `utils/pipeline-health-engine` (7) and
   `api/campaigns/monitor` (7).
2. **bank-accounts: 31 tests, all skipped** - payout destination, zero active
   coverage. Highest financial risk.
3. **Security addendum still unexercised**: AI prompt/indirect injection, SSRF,
   XSS, CSRF, webhook forgery, rate-limit bypass, upload abuse, path traversal,
   open redirect, security headers. Tenant isolation / IDOR / admin escalation
   IS done (15 checks, 0 leaks).
4. **Data-leak audit**: bundles, source maps, cookies, localStorage, logs, error
   messages, downloads. Only the secret-VALUE scan across 104 client assets has
   been run.
5. **48 orphaned users** (no organization_members row) - establish why, decide
   repair vs leave, and check for any security implication. Do not delete data.
6. **Original 17 items** 1,2,4,8,9,10,12,13,14,15,16,17: independent
   re-verification with real browser workflows.
7. **Mutation / property testing**: none exist. Apply to financial calculation,
   limits, state machines and authorization.
8. Full regression after whatever changes next.

### Do NOT redo
Browser QA (70/70), tenant-isolation probe (15/0), dashboard/schema repair,
fragment sweep (0), production performance measurement, financial invariant
coverage check (idempotency/concurrency/replay all present and passing).

### Score
Still **7/10**. Unchanged by this session: the class is now enforced rather than
closed, and the ranked items above are untouched. 10/10 remains unjustified.

---

## SESSION 6 CLOSE - STATE AT CHECKPOINT

Commit: 233bdea (branch `feat/cloudflare-workers`, clean tree).
Gates after these changes: typecheck exit 0; **2658 passed / 0 failed (237
files)**, exit 0; api-probe PASS. Browser QA 70/70 and tenant isolation 15/0
predate them - re-run before any completion claim.

### Done this session
1. **Silent-failure class**: worst file closed. `api/analytics/advanced` went
   16 -> 0 silent catches via a new shared `utils/queryFallback.logFallback`
   helper (observability only, behaviour unchanged; verified the endpoint still
   returns 200 with and without a campaign filter). Guard baseline for that file
   removed, so any reappearance fails the build.
2. **dncRegistry.hasSmsConsent** fixed: was `.catch(() => [])` beside a query
   that THREW, so a DB outage was indistinguishable from "no consent on file".
   Fails closed (correct) but is no longer silent.
3. **bank-accounts given real coverage** (was 31 `it.todo` placeholders under a
   stale "routes not implemented" comment, on the payout path). New 10-test
   security suite: public shape leaks nothing, encryption produces real
   ciphertext, fingerprint is per-user and non-reversible, ABA checksum and
   4-17 digit boundaries.

### Next work, ranked, all UNBLOCKED
1. **Security addendum - the largest remaining gap.** Unexercised: AI prompt
   and indirect injection, SSRF, XSS, CSRF, webhook forgery/replay,
   rate-limit bypass, upload abuse, path traversal, open redirect, security
   headers, CORS. (Tenant isolation / IDOR / admin escalation IS done: 15
   checks, 0 leaks.)
2. **Data-leak audit**: client bundles, source maps, cookies, localStorage, log
   output, error messages, downloads. Only the secret-VALUE scan across 104
   client assets has been run.
3. **48 orphaned users** (no organization_members row) - establish why, decide
   repair vs leave, check for security implication. Do not delete data.
4. Remaining silent-failure files: `utils/pipeline-health-engine` (7),
   `api/campaigns/monitor` (7), `utils/trustSignals` (6), then ~90 single-site
   files. The helper and pattern already exist; this is mechanical.
5. **Original 17 items** 1,2,4,8,9,10,12,13,14,15,16,17 - independent
   re-verification with real browser workflows.
6. **Mutation / property testing**: none exist. Apply to financial calculation,
   limits, state machines, authorization.
7. Full regression after whatever changes next.

### Do NOT redo
Browser QA (70/70), tenant isolation (15/0), dashboard/schema repair, fragment
sweep (0), production performance measurement, financial invariant coverage
check, bank-accounts, analytics/advanced.

### Score
Still **7/10**. This session closed a ranked class defect and the highest
financial-coverage gap, but the security addendum and data-leak audit - the two
largest gates - are untouched. 10/10 remains unjustified.

---

## SESSION 7 - SECURITY ADDENDUM + DATA-LEAK AUDIT (partial but real)

### Executed security verification (was: asserted from code review)
`scripts/security-probe.mjs` against the PRODUCTION build: **17 checks, 0
failures** (16 before the header addition).
- CSRF: hostile `Origin: https://evil.example.com` -> 403
- path traversal: 401/404 across 5 payloads incl. encoded %2e%2e and
  /static/../../.env - no filesystem disclosure
- webhook forgery: unsigned payloads to payments + esign webhooks -> 503, i.e.
  FAIL CLOSED rather than processing an unverified event
- XSS: `<script>alert(1)</script>` in a filter is not reflected raw
- open redirect: `callbackUrl=https://evil.example.com` resolves to a LOCAL
  error page, not the attacker's origin
- security headers: CSP, X-Content-Type-Options, X-Frame-Options,
  Referrer-Policy all present

Together with `tenant-isolation-probe.mjs` (15 checks, 0 leaks) the authz,
tenant, CSRF, traversal, forgery, XSS, redirect and header classes now have
executed evidence rather than review-based confidence.

### Data-leak audit (partial)
- Client bundles: 104 assets scanned for 8 exact secret values -> **0 found**
- Source maps shipped: **0** `.map` files under `.next/static`
- Error disclosure: 500/401 bodies are generic; no neon/postgres/stack text
  reaches the client
- Debug endpoints: `/api/debug`, `/api/health`, `/api/env` -> 404;
  `/api/system/health` is intentionally public and returns only
  `{ok,status,timestamp}` - verified no internals
- **FIXED (LOW):** `X-Powered-By: Next.js` was advertising the stack to any
  unauthenticated scanner. `poweredByHeader: false` added, and the security
  probe now asserts its absence so it cannot regress.

### STILL NOT EXERCISED (do not claim these)
- SSRF (only matters where the server fetches user-supplied URLs)
- upload / file-handling abuse
- rate-limit BYPASS specifically (limits are enforced and 429s observed, but no
  bypass attempt was made)
- AI prompt injection / indirect injection / context leakage end-to-end
- cookies / localStorage / log-output content audit
- downloadable-file authorization

### Remaining silent-failure work
`utils/pipeline-health-engine` (7), `api/campaigns/monitor` (7),
`utils/trustSignals` (6), then ~90 single-site files. `logFallback` exists and
the pattern is established; this is mechanical.

---

## X-POWERED-BY FIX VERIFIED (not just applied)

- `next build` after `poweredByHeader: false` -> **exit 0**
- production server restarted, `scripts/security-probe.mjs` re-run against it:
  **17 checks, 0 failures**, with `OK x-powered-by` (header absent)

The fix is confirmed by a request to the rebuilt server, not by reading the
config. The probe now fails the build if the header ever returns.
