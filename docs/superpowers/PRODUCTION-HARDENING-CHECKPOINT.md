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
