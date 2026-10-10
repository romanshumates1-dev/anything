# AI-HANDOFF Ã¢â‚¬â€ read this first

**Last updated:** 2026-10-09 (two milestones at `c621c8a`/`72d1020`: G2 step-1 guarded handler + Q1 execution-half verification)

## G2 MILESTONE — `72d1020` (2026-10-09): homepage 500 now DIAGNOSABLE (step 1)

**What shipped:** `scripts/patch-opennext-handler-guard.mjs` — a build-time patch that wraps the OpenNext-GENERATED call site `return await components.ComponentMod.handler(...)` in `.open-next/server-functions/default/apps/web/handler.mjs` with a `typeof` guard. On a failed page-module load it now logs a greppable `[g2-handler-guard]` marker (url, routeModule, nextApp, rssMB) and throws a named `PageModuleLoadError` instead of a silent `TypeError`.

**Wiring:** `cf:build` now runs it **after** `patch-opennext-instrumentation.mjs` (same target file), so the guard ships in every build. This was the critical gap — the patch + test existed but were NOT wired into the build, so the fix would never have reached production.

**Verification (all against the REAL generated bundle, not a fixture):**
- 5 regression tests green (`scripts/patch-opennext-handler-guard.test.ts`): real call site guarded, marker + named error, idempotent, no over-match, fail-safe exit 0 when `.open-next` absent.
- Ran the script on the shipped `handler.mjs`: guarded 1 call site (exit 0), `node --check` valid, second run idempotent, coexists with the already-applied instrumentation marker.

**Honest status:** This is matrix step 1 (diagnosability) ONLY. It does **not** reproduce or fix the 500 and does **not** confirm memory. Root cause remains unconfirmed; steps 2 (memory comparison) and 3 (bundle-splitting) are still open. **Do not record G2 as resolved.**

## Q1 MILESTONE — `c621c8a` (2026-10-09): disabled workflow phases verified not to execute

**What shipped:** `src/app/api/utils/__tests__/campaignPhases.execution.test.ts` — 6 tests closing the matrix's "Q1 enabled/disabled execution NOT VERIFIED" gap. The reporting half (`campaignPhases.enabled.test.ts`) and validation half (`SEQUENCE_CHANNEL_DISABLED`/`SEQUENCE_NONE_ENABLED`) were already pinned; the **execution** half was not. `toEngineSettings()` is the builder→engine hand-off (sole caller `campaigns/route.ts`); its `maxTouches` and `touchDelays[]` now have a regression test proving disabled phases are filtered out, so a campaign with calling OFF will not dial.

**Verification:** 6/6 green; mutation-proven (dropping either `.filter(p=>p.enabled)` in `campaignBuilder.ts` turns 6/6 red, restoring turns 6/6 green); sibling suite green at 49/49 across `campaignBuilder` + `campaignPhases.enabled` + the new file. Full-project `tsc` shows 0 errors in touched files (244 repo-wide are the documented pre-existing baseline).

**Honest status:** This is a TEST-only milestone — no production code changed, because the existing filter was already correct. It converts an unverified claim into a pinned one. Q1 is now fully verified on all three axes (report / validate / execute).




| Gate stage | Evidence | Status |
| --- | --- | --- |
| `cf:build` (legal:generate + OpenNext + scrub + patch) | `.gate2.log` L2–L497: "OpenNext build complete", 320/320 pages, worker saved | PASS |
| `cf:size` | `.gate2.log` L505: 6.78MB gzip = 67.8% of 10MB, 3.22MB headroom | PASS |
| secrets scan (3335 files) | `.gate2.log` L562: no secret values or shaped literals | PASS |
| `verify:release` (37 artifact checks) | exit 0 (`.art2.exit`), 37/37 | PASS |
| typecheck `tsc -p tsconfig.typecheck.json` | exit 0 (`.st-tc.exit`), empty log | PASS |
| oxlint on touched files | 0 warnings, 0 errors | PASS |
| SEO/static guards | 28/28 (seo-surface 10, static-assets 9, seo-ratchet 9) | PASS |
| sitemap (independent XML parse of build output) | 19 URLs, 19 unique, 1 homepage, `/cash-offer` present, 0 non-absolute | PASS |
| PNG/ICO (independent inflate+CRC decode of build output) | favicon 32×32, og-image 1200×630, apple-touch 180×180, ICO 3 entries | PASS |
| preview deploy | version `fa88d160` on `dealswift-app.romanshumates1.workers.dev` | PASS |
| preview browser verification | sitemap XML live; favicon.png 200 image/png 377B; favicon.ico 200 ICO 1162B; og-image.png 200 PNG 14418B; `/legal/terms` no template snippet | PASS |
| production apex | serves OLD worker (expected — deploy targets workers.dev only) | NOT DEPLOYED |

**Trap documented:** `legal:generate` rewrites `legal-docs.generated.ts` with byte-identical content on every build, tripping the deploy wrapper's mtime freshness guard. Fix used: restored the file's mtime (hash `4af599b3` unchanged); guard untouched. Do NOT "fix" by weakening the guard or adding `--allow-stale` to the runbook.

**Next:** cutover to apex is an OWNER DECISION (wrangler.jsonc documents it: adding the apex route replaces DNS serving WordPress). Until then, continue matrix OPEN WORK: G2 (homepage 500, BLOCKED-EXTERNAL — now UNBLOCKED for tail diagnostics since auth works), DEPLOY cutover (owner decision), G1b (owner decision).
**Purpose:** a new model should understand the project state from this file in under a minute, without reading history or re-auditing.

---

## Ã¢Å¡Â Ã¯Â¸Â UNCOMMITTED WORK IN THE TREE Ã¢â‚¬â€ SEO-SURFACE + STATIC-ASSET REPAIR (2026-10-09)

**Read this before touching anything SEO, metadata, or `public/` image related.**

A live production audit of `dealswiftautomation.com` (2026-10-09) found eight
defects that every existing gate passed. Two guard tests were written for them
and are **REDÃ¢â€ â€™GREEN mutation-proven**, but the fixes are **NOT YET COMMITTED**
(`git status` no longer shows them). **Committed as `129a77c`.**

| # | Defect (all verified live) | Fix | Test |
| --- | --- | --- | --- |
| 1 | `sitemap.ts` listed the homepage **twice** (`{url: BASE_URL}` and ``{url: `${BASE_URL}`}`` Ã¢â‚¬â€ same string). A repeated `<loc>` makes the sitemap malformed; GSC rejects the whole file | rewritten to derive the origin from `siteOrigin()` and build each entry from a PATH, so no URL is spelled twice | `seo-surface.guard.test.ts` Ã¢â€ â€™ "emits every URL exactly once" |
| 2 | `/cash-offer` is indexable (has a canonical, inside `(marketing)`) but was **absent from the sitemap** | added at priority 0.9 | same file Ã¢â€ â€™ "lists the indexable cash-offer landing page" |
| 3 | `/pricing` set `title: "Pricing - DealFlow AI"` under a `%s Ã¢â‚¬â€ DealFlow AI` template Ã¢â€ â€™ production rendered **"Pricing - DealFlow AI Ã¢â‚¬â€ DealFlow AI"** as both `<title>` and `og:title` | title is now brand-free | same file Ã¢â€ â€™ "no marketing page title literal repeats the brand" |
| 4 | **No `og:image` anywhere** while `twitter:card` is `summary_large_image` Ã¢â‚¬â€ a card promising an image it could not fill | `canonicalFor` now attaches an absolute `openGraph.images` (it is the ONE choke point every marketing page spreads; page-level `openGraph` **replaces** rather than deep-merges the layout's) + `twitter.images` on the marketing layout + a real generated `public/og-image.png` | same file Ã¢â€ â€™ "canonicalFor attaches an og:image that exists on disk" |
| 5 | All nine `/legal/*` pages published **"Ã¢â‚¬Â¦ Template Ã¢â‚¬â€ requires attorney review before launch."** as their meta description Ã¢â‚¬â€ internal process text served as the search snippet | new `legalMetaDescription(doc)` in `lib/legal.ts` **derives** the snippet from the document's own opening paragraph, so it cannot drift from the markdown and never calls a doc a template | same file Ã¢â€ â€™ "no marketing metadata ships internal placeholder text" |
| 6 | `/faq` rendered 15 Q&As with **no FAQPage JSON-LD**, so none of it was eligible for rich results (while `/reviews` already ships AggregateRating) | content extracted to `src/lib/faq-content.ts` (single source), schema in `src/lib/faq-schema.ts`, emitted as a `<script type="application/ld+json">` | same file Ã¢â€ â€™ "the FAQ page renders an FAQPage JSON-LD script" |
| 7 | `public/favicon.png` **was not a PNG**. Magic bytes `ef bf bd 50 4e 47` Ã¢â‚¬â€ a UTF-8 replacement char where `0x89` belongs; 771 mangled sequences; 3477 bytes. Committed broken since the initial commit and served live. `favicon.ico` was a **byte-for-byte copy of it**, so legacy `/favicon.ico` got garbage too. **Irrecoverable Ã¢â‚¬â€ the original bytes are gone** | regenerated from code by `apps/web/scripts/generate-brand-assets.mjs` (dependency-free PNG+ICO encoder; do NOT introduce `sharp` as a dependency Ã¢â‚¬â€ it is only transitive) | `static-assets.guard.test.ts` Ã¢â€ â€™ "passes a full structural walk (signature, per-chunk CRC, IDAT inflate)" |
| 8 | (consequential) no Apple touch icon | generated 180Ãƒâ€”180 `apple-touch-icon.png`, declared via `icons.apple` in the root layout | covered by the `public/` PNG sweep |

**Evidence:** `seo-surface.guard.test.ts` 10/10, `static-assets.guard.test.ts`
9/9, plus new `src/app/(marketing)/faq/faq-jsonld.render.test.tsx` (5/5) which
**mounts the real page with `renderToStaticMarkup`** and proves the ld+json
reaches the DOM (4481 chars, all 15 questions, no raw `<` survives). Sibling
guards `seo-ratchet`, `static-metadata.guard`, `blank-page-guard`,
`operational-disclosure-guard` and `src/lib/legal.test.ts` Ã¢â‚¬â€ **38/38 pass**.
`tsc --noEmit` reports **zero errors in every file touched** (the ~250 repo-wide
errors are pre-existing: the untouched HEAD copy of
`tenant-isolation-2026-09-26.test.ts` alone already yields 16).

**Mutation-proven (each reverted fix makes its gate FAIL):** duplicate sitemap
URL + dropped `/cash-offer` Ã¢â€ â€™ both sitemap tests fail with exact messages;
brand re-doubled on `/pricing` Ã¢â€ â€™ title test fails naming the rendered string;
`openGraph.images` removed Ã¢â€ â€™ og:image test fails; `</` escape removed from
`jsonLdForEmbed` Ã¢â€ â€™ `raw "<" survives in the embedded JSON-LD`.

### TWO TRAPS THIS WORK HIT Ã¢â‚¬â€ do not repeat

1. **The CRC-32 table builder in the generator originally read
   `c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 8`** Ã¢â‚¬â€ `>>> 8` instead of `>>> 1`
   in the else-branch. It produced files with a valid signature and valid IHDR
   dimensions that failed every chunk CRC, i.e. exactly the class this guard
   exists to catch, generated by the guard's own tooling. **The guard was right
   and the generator was wrong.** Always verify a generated PNG with an
   independent decoder (e.g. `sharp` metadata) before trusting it.
2. **The first version of the JSON-LD escape test grepped `faq/page.tsx` for an
   inline `JSON.stringify(...).replace(/</`.** That assertion forced the escape
   to be duplicated into the page, away from the helper that builds the payload
   Ã¢â‚¬â€ a test that could pass while the embedded string was still built unsafely.
   It is now behavioural: it calls `jsonLdForEmbed` with a real
   `</script><img onerror>` break-out attempt and asserts no `<` survives, then
   separately asserts the page actually *uses* the helper.

### NOT DONE / DELIBERATE SCOPE LIMITS

- **Mojibake in `faq-content.ts`** (`ÃƒÂ¢Ã¢â€šÂ¬"` where an em dash belongs, inherited
  verbatim from the original page). Left as-is: pre-existing rendering noise
  across the marketing tree, not one of the eight audited defects.
  `scripts/audit-marketing-text.mjs` (untracked) lists the affected files.
- The OG card is drawn with the monogram + geometric rules, **not** the
  wordmark, because setting real type would mean embedding a font. The 1200Ãƒâ€”630
  dimensions are pinned by the guard; swapping in a font-rendered card is safe.
- **Nothing here is deployed.** `og-image.png`/`apple-touch-icon.png` are new
  files under `public/`, so confirm `cf:build` picks them up and that `_headers`
  does not need a caching entry.

---

## CURRENT BRANCH

`feat/cloudflare-workers`

## CURRENT HEAD

`2b33606` Ã¢â‚¬â€ on `feat/cloudflare-workers`. None of this is deployed to
production; the last live Worker is still `85de11a9` from `a576f2f`. The
`dealswift-loadtest` worker DOES serve the analytics fix (probe 2026-10-07:
104 routes / 0 server faults).

| Commit | What | Evidence |
| --- | --- | --- |
| `2b33606` | **H1 LOCAL HALF CLOSED Ã¢â‚¬â€ authenticated console sweep** Ã¢â‚¬â€ new `apps/web/e2e/authenticated-console.spec.ts` (7 tests). Verifies once (not repeatedly) that existing infra supports an authenticated browser sweep with zero owner input, then runs it. Anti-vacuity guard probes `/api/auth/get-session` and hard-fails if the session is absent; 6 authenticated routes (`/dashboard`, `/campaigns`, `/lead-finder`, `/settings/billing`, `/achievements`, `/inbox`) each assert HTTP 200 + real visible h1/main content + no error boundary + no uncaught `pageerror` + no failed same-origin request + no fabricated mock data (H2/fa43bd0 guard) | `yarn test:e2e -- authenticated-console.spec.ts` from `apps/web`: **9 passed / 1 skipped** (this spec 7/7 pass, every route status=200 content=true boundary=false leak=0 console=0 pageErr=0 failedReq=0; plus committed marketing 2/2). Negative/mutation case: temp copy with a synthetic `pageerror` pushed into `wire()` Ã¢â€ â€™ pageErr=1 and **all 6 route tests FAIL**; real copy in the same run pageErr=0 Ã¢â€ â€™ all 6 pass; temp copy deleted after. Gate genuinely fires. **Scope: LOCAL half only** Ã¢â‚¬â€ the PRODUCTION sustained-load noises (CF RUM beacon `/cdn-cgi/rum`, 503/1102 CPU ceiling) are production-only and remain BLOCKED-EXTERNAL behind DEPLOY; NOT claimed clean. Runner caveat: must use `yarn test:e2e` (workspace-resolved `@playwright/test`); `npx playwright` throws the dual-instance `_currentSuite` error even on the committed `marketing.spec.ts` (pre-existing monorepo quirk, not a spec defect). Production code untouched |

| Commit | What | Evidence |
| --- | --- | --- |
| `48bdaf3` | **H1 test-only fix Ã¢â‚¬â€ `next/link` mock leaked `prefetch` onto `<a>`** Ã¢â‚¬â€ 1 test added to `apps/web/src/components/Shell.test.tsx` (11 total in file), which now **destructures `prefetch` out** of its `next/link` mock. **`Shell.tsx` deliberately NOT modified** Ã¢â‚¬â€ the leak is in the TEST mock, not production: real `next/link` consumes `prefetch` and never forwards it to the DOM. Defect was an AVOIDABLE console error (`Received \`false\` for a non-boolean attribute \`prefetch\``), i.e. H1 "no avoidable console errors" | real impl **11/11 pass** (`cd apps/web && npx vitest run --config src/app/api/vitest.config.ts src/components/Shell.test.tsx --reporter=verbose`); negative case: temp copy `Shell.h1mut.test.tsx` with the `prefetch` destructure reverted to the leaking `...rest` Ã¢â€ â€™ **test FAILS**, diff shows React's verbatim non-boolean-attribute warning; temp file deleted after. Behavioural assertion (captures real `console.error` calls) **plus** a loud `anchors > 0` guard so an empty render cannot trivially pass; regression suite `src/components` **9 files / 59 tests pass** |
| `954c910` | **B1/B2 CLOSED Ã¢â‚¬â€ Shell sidebar long-identity contract** Ã¢â‚¬â€ 2 tests added to `apps/web/src/components/Shell.test.tsx` (10 total in file). Pins `truncate` + `min-w-0` + `title` on BOTH identity blocks for an explicit 120-char display name and a 254-char RFC-limit email. **`Shell.tsx` deliberately NOT modified** Ã¢â‚¬â€ no defect was demonstrated | real impl **10/10 pass** (`npx vitest run --config src/app/api/vitest.config.ts src/components/Shell.test.tsx --reporter=verbose`); negative case: temp copy `Shell.mutcheck.tmp.tsx` with all 12 `truncate`/`min-w-0`/`title=` sites stripped Ã¢â€ â€™ **both new tests FAIL** (`expected ... to contain 'truncate'`); temp files deleted after. Behavioural assertions on rendered DOM, not source text |
| `a0c9ec6` | **CRM analytics phantom columns** Ã¢â‚¬â€ see below | guards 8/8; oxlint 0/0; tsc clean; utils+pglite 1146 pass / 0 fail; **probe 104 routes / 0 SERVER_FAULTS** |
| `4036224` | `qa-accept.mjs` + `qa-page-probe.mjs` Ã¢â‚¬â€ legal-acceptance setup + authenticated page-route HTTP baseline | probe: 104 routes, 0 server faults (2026-10-07) |
| `8681150` | **run-migrations silently skipped commented statements** (deployed live 500). Comment-gated statements never ran: **388 of 773** statements applied corpus-wide, **1 of 13** CREATE TABLEs in 099, then "All migrations complete!" + exit 0. Also fixed a semicolon-then-trailing-comment merge in 082 and 3 swallowed `.catch` sites in `rewards/page.tsx` | 9 new guard tests; 3133 pass / 26 skip / 0 fail; gate PASS |
| `7e63233` | docs(matrix): V3 complete incl. rewards page | Ã¢â‚¬â€ |
| `2a6bc1a` | **V3-UI** rewards page + gamification sidebar gating | Ã¢â‚¬â€ |
| `a857b31` | docs(state): Y1/U1 and X1 verified at `68a67b4` | Ã¢â‚¬â€ |
| `68a67b4` | **X1 VERIFIED** Ã¢â‚¬â€ `entitlements.ts` fails closed on every degraded input | 16 tests |
| `a5fc054` | **Y1/U1 VERIFIED** Ã¢â‚¬â€ disabled stages never reported active | 15 + 28 tests |
| `ed683e5` | **V3** reward layer: migration 099 + economy + exactly-once claims | 58 tests |
| `141e063` | `/api/rewards` behind session + ON/OFF gates | 13 tests |
| `d5d6094` | `x-real-ip` caveat closed | 4 tests |
| `dac5d6e` | Better Auth limiter resolves client IP from the canonical trust list | 136 tests |

Gates at `a0c9ec6`: **full suite 3139 passed / 26 skipped / 0 failed** (290
files, 207.6s), typecheck (`tsc -p tsconfig.typecheck.json --noEmit`) clean,
oxlint 0/0 on changed files, schema-truth + SQL-fragment guards 8/8, page probe
**104 routes / 0 SERVER_FAULTS** against `dealswift-loadtest`.
Gates at `8681150`: typecheck `TC_EXIT=0`, oxlint 0/0, **3133 passed / 26 skipped /
0 failed** (290 files), MIGRATION_GATE PASS (99 fresh-install + 101 idempotent
re-run, 17/17 tables).

Ã¢Å¡Â Ã¯Â¸Â Keep this value current on every state commit Ã¢â‚¬â€ it has been stale before, and
a checkpoint whose HEAD does not match the repository is exactly how a new model
re-audits from scratch. Verify with `git log --oneline -3`.

## NEXT ACTION

**G2 Ã¢â‚¬â€ BLOCKED-EXTERNAL (2026-10-07).** Diagnostics are live
(`a576f2f`, Worker `85de11a9`); on the next occurrence run
`wrangler tail --format pretty` and grep `[worker:unhandled]`. 40/40 no-repro
so far Ã¢â‚¬â€ act only on new evidence.

**BLOCKER**: No Cloudflare authentication credentials (CF_API_TOKEN/CF_ACCOUNT_ID)
present locally; `npx wrangler whoami` times out with no stored auth config.
The controlled concurrency diagnostic against `dealswift-loadtest` cannot execute.
This is an environment prerequisite, not a code defect.

**Local work completed while G2 is blocked:**
1. **M1 Ã¢â‚¬â€ CLOSED (`d0a9921`):** `taxWithholdingStore.pglite.test.ts` (18 tests)
   verifies the tax withholding store against real Postgres (PGlite). Migration 090
   applied; settings upsert + CHECK constraint, `recordWithholding` idempotency,
   `getWithheldBalance` tenant-scoped aggregate, `listLedger` date-range scoping,
   cross-tenant isolation, money conservation. All 18/18 pass.
2. **DEPLOY guard Ã¢â‚¬â€ CLOSED (`6ff97f0`):** `wrangler-deploy.guard.test.ts` (11 tests)
   pins the stale-artifact guard in `wrangler-deploy.mjs`, preventing the silent-
   stale-deploy defect from regressing. All 11/11 pass.
4. **H1 Ã¢â‚¬â€ avoidable console error in the test suite (CLOSED `48bdaf3`).** The
   `next/link` mock in `Shell.test.tsx` spread `...rest` onto a raw `<a>`, so
   React logged `Received \`false\` for a non-boolean attribute \`prefetch\`` on
   every render. The mock now destructures `prefetch` out and drops it (same
   convention as `dashboard-summary-fanout.test.tsx`), and a new test asserts
   the render emits no non-boolean-attribute warning. **`Shell.tsx` was NOT
   changed** Ã¢â‚¬â€ real `next/link` consumes `prefetch`; the leak was test-only.
   Mutation-proven: reverting the destructure in a temp copy makes the new test
   FAIL. 11/11 in the file, `src/components` 9 files / 59 tests pass.
   **Do not revisit unless that mock regresses.**
5. **B1/B2 Ã¢â‚¬â€ CLOSED (`954c910`):** Shell sidebar long-identity contract. 2 tests
   added (10 total in `Shell.test.tsx`) pinning `truncate` + `min-w-0` + `title`
   on both identity blocks for an explicit long display name and a 254-char
   RFC-limit email. **`Shell.tsx` was NOT changed** Ã¢â‚¬â€ a mutation check on a
   temporary copy proved the existing implementation already correct.
   Anti-loop rule applied: **do not revisit unless `Shell.tsx` changes.**

Queue, in order:

1. **X1 / Y1 / U1** Ã¢â‚¬â€ Ã¢Å“â€¦ CLOSED `a5fc054`, `68a67b4`. Do not redo.
2. **V3-UI** Ã¢â‚¬â€ Ã¢Å“â€¦ CLOSED `2a6bc1a`. Do not rebuild.
3. **QA-ACCEPT** Ã¢â‚¬â€ Ã¢Å“â€¦ CLOSED (legal acceptance recorded; `qa-accept.mjs` +
   `qa-page-probe.mjs` committed `4036224`; probe 104 routes / 0 SERVER_FAULTS).
4. **Analytics phantom columns** Ã¢â‚¬â€ Ã¢Å“â€¦ CLOSED `a0c9ec6` (all 8 `analytics/crm`
   variants 200, incl. `groupBy=zipCode` and `view=outreach`).
5. **B1/B2 Shell long-identity** Ã¢â‚¬â€ Ã¢Å“â€¦ CLOSED `954c910`. Do not revisit (anti-loop
   rule: only if `Shell.tsx` changes or the evidence is invalidated).
6. **G2** Ã¢â‚¬â€ *(NEXT)* intermittent `GET /` 500, cause unidentified.
6. **G1b** Ã¢â‚¬â€ Free-plan resource ceiling (Cloudflare 1102); owner decision.
7. **Deployment** Ã¢â‚¬â€ none of this is deployed to production; last live Worker is
   `85de11a9`. Always `yarn cf:build` before `scripts/wrangler-deploy.mjs`.
8. `BLOCKED-EXTERNAL`: Stripe live keys/webhook secret, Apollo keys, Bedrock,
   Google OAuth, Workers paid plan.

Open findings that must not be confused with completed work:

1. **Intermittent `GET /` 500** Ã¢â‚¬â€ diagnostics live (`a576f2f`, Worker `85de11a9`);
   **root cause unresolved**. Next occurrence: `wrangler tail --format pretty`,
   grep `[worker:unhandled]`.
2. **503 under sustained load** Ã¢â‚¬â€ **zero 5xx across 108 concurrent requests** on
   the isolated worker, but probe5/probe6 (2026-10-06) hit alternating 200/503
   under sustained sequential probing with `wrangler tail` confirming **CPU
   limit hit (Free plan)** Ã¢â‚¬â€ sustained traffic trips the ceiling too, not just
   bursts. Homepage warm median 124ms; cost is isolate cold start. Owner
   decision (G1b).
3. **Sign-in rate-limit "race" Ã¢â‚¬â€ WITHDRAWN, FALSE POSITIVE** (`d2eb0fe`). Limiter
   HOLDS (3,3,3,3,1 admitted vs limit 3, 64 concurrent requests). The old
   "admitted=4" was a fixed-window boundary artifact. **Do not rewrite it.**

### ISOLATED ENVIRONMENT EXISTS Ã¢â‚¬â€ use it, do not recreate

`apps/web/wrangler.loadtest.jsonc` Ã¢â€ â€™ Worker **`dealswift-loadtest`**, 32 secrets
provisioned, **disjoint from the apex**. Ã¢Å¡Â Ã¯Â¸Â `dealswiftautomation.com` and
`dealswift-app.romanshumates1.workers.dev` are **THE SAME WORKER** Ã¢â‚¬â€ "workers.dev"
is **not** isolation. Probe scripts refuse to run unless `BASE` contains
`loadtest`. **All concurrency/load work belongs here.**

Never load-test the live apex; a previous session caused a real ~90s outage.

## THE `run-migrations.mjs` TRAP Ã¢â‚¬â€ read before touching migrations

`db/migrations/` is applied by **three different runners** and they are not
interchangeable:

| Runner | Splitter | Used by |
| --- | --- | --- |
| `scripts/migrate.mjs` | its own `splitSql` | `DEPLOY.md`, docker seed |
| `scripts/migration-gate.mjs` | `scripts/lib/split-sql.mjs` (**vetted**) | the PASS/FAIL gate |
| `scripts/run-migrations.mjs` | its own copy | single-file apply |

`run-migrations.mjs` drifted from the vetted splitter and lost statements
silently. **MIGRATION_GATE PASS does not imply `run-migrations.mjs` is correct** Ã¢â‚¬â€
they are different code paths. That is now pinned by
`scripts/run-migrations.guard.test.ts`, which asserts the two agree statement
for statement across all 99 files. If you add a migration and the gate passes,
confirm the guard still passes too.

## DO NOT REPEAT (learned the hard way)

- **Do not re-open B1/B2 (Shell sidebar long-identity) or edit `Shell.tsx` for
  it.** CLOSED at `954c910` with 10 tests, mutation-proven (stripping
  `truncate`/`min-w-0`/`title` in a temp copy fails both new tests; real impl
  10/10). `Shell.tsx` was already correct. Only revisit if `Shell.tsx` itself
  changes or the evidence is invalidated Ã¢â‚¬â€ **not** to manufacture a diff.
- **Do not "fix" the `prefetch` warning in `Shell.tsx`.** CLOSED at `48bdaf3`:
  the leak was in the TEST's `next/link` mock spreading `...rest` onto a raw
  `<a>`, not in production. Real `next/link` consumes `prefetch` and never
  renders it to the DOM. The mock now destructures `prefetch` out; a guard test
  fails if it comes back. Editing `Shell.tsx` for this would be a fake fix.
- **Do not re-audit `COMPLETE` / `LIVE VERIFIED` matrix rows.** That is the
  model-switch loop this file exists to prevent. Check the matrix first.
- **Do not declare a feature absent from one grep or one directory.** Ten
  false negatives are already recorded in the matrix (wrong path, wrong name).
  Before "ABSENT": check `src/**`, `api/**` routes, DB migrations, git history
  and branches.
- **Do not trust a passing gate as proof a sibling code path is also correct.**
  This is how the migration defect survived: `MIGRATION_GATE: PASS` while
  `run-migrations.mjs` applied half the corpus. Diff the paths.
- **Do not load/concurrency/CPU-stress the production apex.** A prior session
  caused a real ~90s outage. All of that belongs on `dealswift-loadtest`.
- **Do not trust `x-forwarded-for`** as a client IP. Use the canonical
  `clientIp.ts` trust list; a new test fails if `auth.ts` and `clientIp.ts`
  disagree.
- **Do not claim a negative result without a control.** When tailing logs to
  prove a warning is *gone*, first prove the tail can surface *a* warning.

## CURRENT SCORE

**8.5/10.** Unchanged by this session, and deliberately so: everything fixed
here was a *correctness* defect, not a missing capability. Full gate green does
not move the score; it is the baseline the score is measured against.

The ceiling is set by three *unmeasured* items, none of them code-fixable here:

- no money-moving path has live evidence (Stripe is test-mode verified; signed
  webhook delivery to the deployed Worker is unproven)
- 503s under sustained load (Free plan, not configurable)
- intermittent homepage 500, cause unidentified

`PRODUCTION_ENGINEERING_AUDIT.md` says 6/10. **It is stale** Ã¢â‚¬â€ dated 2026-10-03
against `c87d510`, and superseded by the matrix. Do not act on it.

## WITHDRAWN DEFECT Ã¢â‚¬â€ `/dashboard` "45s timeout" NEVER EXISTED (`f0074e2`)

Measured on Worker `8b0da56b`, authenticated, real browser: HTTP **200**, DOM
ready **219ms**, content visible **548ms**, heading `Welcome back, QA Audit Bot`.
The harness awaited `waitUntil: 'networkidle'`, which never settles on an
authenticated page (shell RSC prefetch, React Query revalidation, onboarding
PATCH on mount). **The instrument was wrong, not the product.** Endpoints behind
it measured 83Ã¢â‚¬â€œ405ms. Do not "fix" dashboard performance Ã¢â‚¬â€ there is no evidence
of a defect.

## LIVE-VERIFIED (authenticated, Worker `8b0da56b`)

`routes=6 clean=6 noisy=0` Ã¢â‚¬â€ the first genuinely clean authenticated run in this
project (`f0074e2`). Single sequential browser run; no load testing, per the
production safety rule.

| Route | Status | DOM ready | Mock data | Console | Page errors | Boundary |
| --- | --- | --- | --- | --- | --- | --- |
| `/dashboard` | 200 | 268ms | none | 0 | 0 | none |
| `/campaigns` | 200 | 248ms | Ã¢â‚¬â€ | 0 | 0 | none |
| `/lead-finder` | 200 | 298ms | Ã¢â‚¬â€ | 0 | 0 | none |
| `/settings/billing` | 200 | 432ms | Ã¢â‚¬â€ | 0 | 0 | none |
| `/achievements` | 200 | 206ms | **none** | 0 | 0 | none |
| `/inbox` | 200 | 258ms | **none** | 0 | 0 | none |

`ERR_ABORTED` counts are **benign** and tracked separately: measured 19 API
requests initiated / 5 aborted on `/dashboard`, **0 failures across 10s idle**,
every aborted endpoint returning 200 on a direct call, and
`/api/user/preferences` requested **twice** Ã¢â‚¬â€ the strict-mode double-mount
signature. Real failures still count.

---

## COMPLETED RECENTLY

| Commit | What | Verification |
| --- | --- | --- |
| `cab6955` | Restored canonical `src/instrumentation.ts`; added sync contract guard for the required OpenNext Worker stub | **6/6 targeted tests; lint 0/0; `cf:build` passed; final handler asserted patched. Not deployed.** |
| `52ad8e5` | Aborted static chunks classified benign (asset confirmed served 200/28KB) | **FULL GATE: 3006 tests passed, 0 failed; build OK; browser clean=6 noisy=0** |
| `f0074e2` | `/dashboard` "45s timeout" Ã¢â‚¬â€ **harness bug, defect disproven**; `networkidle`Ã¢â€ â€™`domcontentloaded`; benign aborts separated | 6/6 routes 200, DOM ready 153Ã¢â‚¬â€œ503ms |
| `0437912` | QA harness: creds no longer mangled by `cmd`; FATAL when logged out; mock-leak assertion added | **Live on Worker `8b0da56b`**: `/achievements` + `/inbox` 200, mockLeak=0, 0 console/page errors |
| `fa43bd0` | `/achievements` + `/inbox` now render REAL data (were hardcoded mock rows); thread selects `body`; dead controls removed | 44/44 related suites; 9/9 endpoints.contract; typecheck + oxlint clean; live-verified above |
| `6b30d2c` | Achievement points awarded exactly once (was repeatable by any caller); POST now gamification-gated; progress validated | **RED 8 failed/3 passed Ã¢â€ â€™ GREEN 11/11**; 44/44 across achievements/conversations/leaderboard/gamification |
| `ff3b262` | Tenant-isolation guard given an I/O timeout budget (fixed the suite's only failure) | 2 passed in 339ms; 27 passed across sibling guards |
| `2ea6db3` | Referral share links pointed at the real signup route (`/signup` 404'd in production) | 14 passed; live 404 reproduced pre-fix |
| `27cae46` | Single source for `/api/user/preferences` reads | pre-existing |

## Ã¢Å¡Â Ã¯Â¸Â FABRICATED-DATA CLASS Ã¢â‚¬â€ read before trusting any "LIVE VERIFIED" UI row

Ten false negatives were found earlier (code missing that was assumed absent).
This class is the **opposite** and had never been searched for: pages that
**exist, return 200, and display invented data**. They survive every
"does it exist?" audit. Both were found under requirements already marked
verified.

| Where | What it showed | Now |
| --- | --- | --- |
| `/achievements` | Hardcoded 20 rows after a fake `setTimeout(500)`; never called the API. Fake points, fake 2024 dates, invented "$500,000 Platinum Club" tier | Real `fetch` + server aggregates (`fa43bd0`) |
| `/inbox` | `return data.length > 0 ? data : mockConversations;` Ã¢â‚¬â€ **an empty inbox rendered four strangers' rows**, and an outage was indistinguishable from success | Real fetch; error Ã¢â€°Â  empty (`fa43bd0`) |
| Contact panel | Hardcoded Stage "Interested", Score 85, "123 Main St, Miami FL" | Real fields (`fa43bd0`) |
| Achievement POST | Credited points whenever the **request** said `unlock` Ã¢â‚¬â€ repeatable | Award on real transition only (`6b30d2c`) |

**When verifying a UI requirement, confirm the page actually CALLS its endpoint.**
A 200 plus a passing API test proves nothing if the component never issues the
request. `/leaderboard` was already correct and says so in a comment Ã¢â‚¬â€ that is
the pattern to expect.

## VERIFIED FACTS

Reusable. Do not re-verify unless the relevant code, deployment or environment changes.

- **`/signup?ref=` is FIXED IN PRODUCTION.** It returned 404; it now returns
  **307 Ã¢â€ â€™ `/account/signup`**, with `?ref=CODE` and `&plan=pro` both preserved,
  landing on a 200 whose HTML contains the ref. Verified live 2026-10-04.
- **Referral banner renders on the live homepage** (3/3 requests 200) and
  `/referrals` returns 200. LIVE VERIFIED.
- **The deployed production Worker is `85de11a9`, built from commit `a576f2f`**
  (2026-10-04). The older `499ceb4c` / `5c52120` figure is superseded.
- **The Free-plan CPU ceiling is RESOLVED for authenticated APIs.** The old
  "15/24 routes 503 / /dashboard 12.4s" no longer reproduces. Live 2026-10-04:
  sign-in 200; `/api/dashboard/summary` 200 in 964ms **10/10 consecutive**;
  `/api/usage` 504ms; `/api/credits` 365ms; `/api/system/health` 180ms.
- Ã¢Å“â€¦ **Authenticated PAGE routes ARE verified.** Legal acceptance was recorded
  for the QA account; `scripts/qa-page-probe.mjs` (committed `4036224`) reports
  **104 routes / 100 OK / 4 benign redirects / 0 SERVER_FAULTS** against
  `dealswift-loadtest` (2026-10-07). The old "every route 307s to
  `/legal/accept`" note is historical Ã¢â‚¬â€ do not re-open it.
- Ã¢Å“â€¦ **CRM analytics schema-truth fix (`a0c9ec6`).** `contracts.lead_id`,
  `message_events.opened_at` and `leads.zip_code` were phantom columns that
  500'd the outreach and regional-zip views. Joins now use
  `seller_lead_id = l.id::text`, opens report honestly 0, regional uses
  `leads.zip`. Pinned by `schemaColumnTruth.guard.test.ts` (static tree scan +
  regression samples). All 8 `analytics/crm` variants 200 on the deployed
  loadtest worker.
- Ã¢Å¡Â Ã¯Â¸Â **`/contacts` is a 404 because that route genuinely does not exist** Ã¢â‚¬â€ only
  the public `/(marketing)/contact` is registered. The CRM contacts requirement
  is **CLOSED** via `/crm` (matrix false negative #8). Not a broken link; do not
  create a duplicate page.
- Ã¢Å¡Â Ã¯Â¸Â **`scripts/wrangler-deploy.mjs` does NOT rebuild.** It deploys whatever is
  already in `.open-next`. Running it after a code change ships stale artifacts
  *and reports success*. Always `yarn cf:build` first. This cost a full deploy
  cycle on 2026-10-04.
- Ã¢Å¡Â Ã¯Â¸Â **`scripts/deployed-browser-qa.mjs` HANGS** Ã¢â‚¬â€ and the cause is now understood.
  It sweeps ~24 routes across two viewports with **no delay between routes**,
  each allowing `domcontentloaded` 45s + `load` 20s + `networkidle` 12s. That is
  exactly the burst pattern that trips the shared CPU ceiling, so the script was
  very likely being throttled into its own long timeouts rather than being stuck
  on a bug. **Do not re-run it against production as written.** Use
  `scripts/authenticated-console-check.mjs` (hard per-route timeout, fewer
  routes), and add cooldowns between navigations if you extend it.
- Ã¢Å¡Â Ã¯Â¸Â **THE BINDING CONSTRAINT: burst load breaches the Free-plan CPU ceiling.**
  **Confirmed production incident:** three consecutive `GET /` returned
  **503 / Cloudflare 1102**, plus 503 on all four routes in a browser sweep;
  recovered to 200 after ~90s cooldown. Single requests are healthy (pages
  193Ã¢â‚¬â€œ315ms; dashboard summary 10/10 clean).
  `limits.cpu_ms` is **rejected on the Free plan**, so this cannot be configured;
  it can only be bought or avoided. **Owner decision.**
- Ã°Å¸Å¡Â¨ **DO NOT load-test production. MANDATORY STANDING RULE.**
  **On 2026-10-04 this session caused a real incident**: a browser sweep tripped
  the CPU ceiling and `GET /` returned **503 / Cloudflare 1102** to real visitors
  for ~90s. Never run burst/concurrency/load/CPU-exhaustion tests against the
  live apex. Use local, preview, staging, workers.dev test deploys, mocks or
  PGlite. Keep live testing to a handful of requests with cooldowns.
  Full rule: `DEALSWIFT-AI-PROJECT-CHECKPOINT.md` Ã¢â€ â€™ PRODUCTION SAFETY RULE.
  **If you see 503s, stop polling and wait 60Ã¢â‚¬â€œ90s** Ã¢â‚¬â€ polling keeps the ceiling
  saturated. `/api/system/health` returning 200 while `/` still 503s is the early
  signal that it has cleared.
- **AI credit caps are enforced ATOMICALLY in Postgres** and verified on a real
  engine (PGlite): *"never oversells the cap under CONCURRENT consumption"*, plus
  daily/weekly/monthly denial, period boundaries, tenant isolation, and release
  never going negative Ã¢â‚¬â€ 10/10 pass, 2026-10-04. **Do not rebuild this.**
- **Purchased credits are correctly excluded** from the included-credit caps
  (`aiCreditLimits.ts:181-183`, `aiCreditGate.ts:103-108`).
- Sign-in CPU: 200 in 490ms; throttle refuses in 75ms pre-hash. Deployed at
  Worker `dd557bc1`. (Pre-dates this session; not re-verified here.)
- Referral attribution chain is pinned by 10 tests including 401/403/400 paths,
  self-referral rejection and legacy `?ref` preservation.

## OPEN BLOCKERS

**External Ã¢â‚¬â€ cannot be resolved in code:**

| Blocker | Blocks |
| --- | --- |
| `STRIPE_SECRET_KEY` absent | ALL live billing, subscriptions, payments, payouts |
| Apollo API key absent | live Apollo lead search |
| Bedrock credentials absent | live AI provider calls |
| Google OAuth credentials absent | live Google sign-in |
| Workers plan decision (owner) | full CPU headroom |

**Internal Ã¢â‚¬â€ unresolved production defects:**

1. **Intermittent `GET /` 500.** Cause UNIDENTIFIED. `TypeError:
   components.ComponentMod.handler is not a function`. Did not reproduce in
   40/40 controlled requests. The opennextjs chunk-loading hypothesis was
   investigated and **DISPROVEN** (deployed `handler.mjs` verified sound:
   2038 cases, all `require()` inlined, zero absolute paths). Do not re-investigate
   the chunk hypothesis without new evidence.
2. **Free-plan CPU ceiling.** Sign-in is FIXED (`c87d510`, deployed). Authenticated
   *page renders* remain broken: 15/24 routes 503, `/dashboard` 12.4s. Partially
   addressed by `503845f` (dashboard fan-out collapsed to one Worker invocation,
   deployed evidence still pending).

## CRITICAL WARNINGS

- Ã¢Å¡Â Ã¯Â¸Â **THE INHERITED MATRIX WAS WRONG TEN TIMES.** Every "ABSENT" claim was
  re-verified individually and ten were false negatives: AI credit caps, earnings
  date filters, AI calling, voice selection, trial demo data, referral banner,
  **CRM contacts page**, **gamification XP**, and two others.
  **Before rebuilding anything marked ABSENT, search by CONCEPT Ã¢â‚¬â€ file contents,
  DB columns, exports, the 86-page/370-route build manifest Ã¢â‚¬â€ not by directory
  name.** `api/crm`, `api/contacts`, `api/v1/contacts` and `app/crm` all exist
  under names you would never guess. Directory search alone has produced a false
  negative every single time it was trusted.
- Ã¢Å¡Â Ã¯Â¸Â **NEVER PASS QA CREDENTIALS VIA `cmd /c set VAR=value`.** cmd re-parses that
  line, so Node received values that were not the ones in the file. This produced
  a browser `401 Invalid email or password` **while a direct API call with the same
  credentials returned 200** Ã¢â‚¬â€ indistinguishable from a dead production login.
  Fixed in `0437912`: `authenticated-console-check.mjs` now reads
  `$TEMP\qa-cred.json` inside Node. **Production sign-in is healthy** Ã¢â‚¬â€ verified
  200, `hasSession: true`, redirect to `/dashboard`. Do not re-diagnose it.
- Ã¢Å¡Â Ã¯Â¸Â **A CLEAN BROWSER SWEEP MEANS NOTHING IF THE SESSION WAS NOT REAL.** The same
  script used to continue after sign-in failed, verifying every route logged out Ã¢â‚¬â€
  and unauthenticated pages render clean, so it reported tidy results. It now
  prints `SESSION_PROBE` and a FATAL when `hasSession !== true`. Always read that
  line before trusting any route result from it.
- Ã¢Å¡Â Ã¯Â¸Â **THE MATRIX HAS PRODUCED TEN FALSE NEGATIVES *AND* FALSE POSITIVES.**
  False negatives (assumed absent, actually present) are recorded above.
  False positives Ã¢â‚¬â€ **code that exists, returns 200, and shows invented data** Ã¢â‚¬â€
  were never searched for until 2026-10-04 and are just as dangerous: they
  certify a requirement as verified when the verification proves nothing.
  `/achievements` and `/inbox` both passed "live 200" while rendering hardcoded
  rows. **Before believing any UI evidence, confirm the component actually CALLS
  its endpoint.** A passing API test does not help if the page never issues the
  request.
- Ã¢Å¡Â Ã¯Â¸Â **CHECK YOUR OWN SEARCH FLAGS BEFORE BELIEVING A ZERO.** This cycle I used a
  non-recursive `Get-ChildItem -File` on `apps/web/db/`, which silently skipped
  `db/migrations/`, and nearly recorded an 11th false negative claiming the
  achievements tables did not exist. They do Ã¢â‚¬â€ in migration 068. Use
  `git ls-files` to enumerate files reliably before concluding anything is absent.
  The pre-existing `.tmp-*.log` files and `.tmp-qa-creds.env` are untracked
  scratch. **`.tmp-qa-creds.env` may contain credentials Ã¢â‚¬â€ never commit it and
  never print its contents.**
- `git status` shows `docs/superpowers/PRODUCTION_ENGINEERING_AUDIT.md` as
  untracked; it is a *historical, partly incorrect* report. Treat as context, not
  truth (priority order: repo > checkpoint > matrix > reports).

## DO NOT REPEAT

- Do **not** re-implement/rework AI credit weekly/daily caps Ã¢â‚¬â€ they exist and are tested.
- Do **not** "fix" the sign-in rate limiter. The "RACY: limit bypassed" verdict was
  a **false positive** from a fixed-window boundary artifact in the measuring
  script. Mid-window retest on the isolated worker: admitted 3,3,3,3,1 against a
  limit of 3 over 64 concurrent requests Ã¢â‚¬â€ it **holds** (`d2eb0fe`). Acting on
  the old claim would have meant rewriting a working security control.
- Do **not** treat `dealswift-app.romanshumates1.workers.dev` as an isolated
  environment. It is **THE SAME WORKER** as the apex (no `routes` entry in
  wrangler.jsonc). Use **`dealswift-loadtest.romanshumates1.workers.dev`**
  (`wrangler.loadtest.jsonc`), which is genuinely disjoint.
- Do **not** run `_ratelimit-race.mjs` / `_argon2-parallel.mjs` against the apex.
  They now refuse unless `BASE` contains `loadtest`; that guard exists because a
  past session caused a real ~90s outage by bursting production.
- Do **not** re-add "the homepage 500 has no telemetry" as an open finding. The
  worker `fetch` wrapper logs unhandled throws as `[worker:unhandled]` with
  `suspected_resource_kill` (`a576f2f`). The 500 itself is **still unfixed and
  unreproduced** Ã¢â‚¬â€ only its observability changed. Do not read that as a fix.
- Do **not** "fix" `/dashboard` performance. **The 45s timeout defect never
  existed** Ã¢â‚¬â€ it was the QA harness waiting on `networkidle` (`f0074e2`). Real
  measurement: HTTP 200, DOM ready 219ms, content visible 548ms. The harness now
  reports `domReady` per route, so genuine slowness would show as a number.
- Do **not** treat `ERR_ABORTED` counts as failures. Measured: 19 API requests
  initiated / 5 aborted on `/dashboard`, **0 failures in 10s idle**, every aborted
  endpoint returning 200 directly, and `/api/user/preferences` requested twice Ã¢â‚¬â€
  the strict-mode double-mount signature. The harness separates `benignAborts`.
  Timeouts, 4xx/5xx and connection errors still count as failures.
- Do **not** re-run the fabricated-data sweep. All 76 authenticated `page.tsx`
  files were checked on 2026-10-04 by **shape** (`|| mock`, `?? mock`,
  `if (!res.ok) return mockÃ¢â‚¬Â¦`, pages with no API call, hardcoded name/address
  literals) and **no further instances were found**. The 17 pages that make no
  API call were each inspected and are legitimate: marketing/legal (static),
  `campaigns/planner` (a calculator), `admin/users` (4-line re-export of a
  component that does fetch), `(dashboard)/automation`, `settings/accessibility`,
  and two access-state pages.
- Do **not** treat the 19 `if (!res.ok) return []` sites as this same defect Ã¢â‚¬â€
  they return an empty state, not fabricated content. Known weaker error
  affordance, deliberately not bundled; do not "fix" them as a side effect.
- Do **not** re-implement/rework the achievement points-award guard Ã¢â‚¬â€ fixed in `6b30d2c`
  with 11 tests. The award now depends on a real unlocked transition, not on the request.
- Do **not** re-wire `/achievements` or `/inbox` to their APIs Ã¢â‚¬â€ done in `fa43bd0`.
  Do not reintroduce a mock fallback there; that fallback was the defect.
- Do **not** re-audit whether the achievements/leaderboard backends exist Ã¢â‚¬â€ they do,
  with schema in `db/migrations/068_user_profile_and_gamification.sql`. Note
  `apps/web/db/migrations/` is the real path: `apps/web/db/` also holds loose
  `.sql` files, and a non-recursive search of the parent **misses the migrations**.
- Do **not** enable the inbox message composer without an explicit product decision Ã¢â‚¬â€
  it triggers real outbound SMS/email.
- Do **not** re-implement/rework the sign-in pre-hash cost guard Ã¢â‚¬â€ deployed and measured.
- Do **not** re-investigate the opennextjs chunk-loading cause of the homepage 500 Ã¢â‚¬â€ disproven.
- Do **not** re-run the full 3013-test suite for an isolated change. It takes ~6
  minutes and `collect` is 268s. Use targeted runs.
- Do **not** rebuild the referral-link fix Ã¢â‚¬â€ landed in `2ea6db3`.
- Do **not** re-audit billing/tax/withdrawals absent a dependency change.
- Do **not** edit `Shell.tsx` to silence the `prefetch` console warning Ã¢â‚¬â€ the
  leak was in the test's `next/link` mock, fixed at `48bdaf3`. Production
  `next/link` consumes `prefetch`; nothing to change there.

## REQUIRED FILES TO READ

1. `DEALSWIFT-AI-PROJECT-CHECKPOINT.md` Ã¢â‚¬â€ full state
2. `UNIFIED-REQUIREMENTS-MATRIX.md` Ã¢â‚¬â€ per-requirement status + evidence
3. `apps/web/src/app/api/utils/aiCreditDb.ts` Ã¢â‚¬â€ where NEXT ACTION begins