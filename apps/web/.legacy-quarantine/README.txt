LEGACY QUARANTINE — 2026-09-20 stabilization pass (feat/cloudflare-workers)

billing-route-duplicates/
  plans-route.js.txt, subscribe-route.js.txt
  These were Next.js route handlers (route.js) sitting in the same directory
  as their typed ports (route.ts) — a duplicate-route hazard for Next's
  module resolution. Verified logic-equivalent before removal (identical
  exported symbols and SQL statement sets; .ts versions are strict
  supersets). Moved here (renamed .txt so they can never be picked up as
  route handlers again) rather than deleted, per the preservation rule.
  Live routes: src/app/api/billing/plans/route.ts, src/app/api/billing/subscribe/route.ts

run-artifacts/
  Disposable test/typecheck logs from the 2026-09-20 stabilization pass:
  - dbretry-red.out/err    : RED run of dbRetry.test.ts (module absent — expected fail)
  - fixtests*.out/err      : targeted suites (webhook 8/8, dbRetry 7/7, accessGate, rateLimit, auth, credits — all green)
  - fullsuite.out/err      : full vitest run — 2057 passed / 23 skipped / 30 todo, 0 failed
  - tsc*.out/err           : tsc --noEmit runs; final state 124 errors, ALL in
                             pre-existing *.test.ts files (0 in production sources,
                             0 in files changed by the stabilization pass). tsc is
                             not the project's gate; the OpenNext build excludes
                             test files and passes.
  Safe to delete this entire folder once verified.
