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
