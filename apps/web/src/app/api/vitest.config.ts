import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `@` resolves to apps/web/src so route handlers that import `@/lib/auth`,
// `@/app/api/utils/sql`, etc. load (and can be mocked) the same way they do at runtime.
const srcDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'node',
    setupFiles: [],
    include: ['**/*.test.ts'],
    // Live-DB suites (flows-live, sla, numberPoolStore) drive dozens of
    // SEQUENTIAL HTTP round-trips to a real Neon branch. Vitest's 5s default is
    // budgeted for in-process mocked work and is far too tight for that: CI run
    // 29723332177 failed `campaign_lifecycle` at 5006ms — 6ms over — while the
    // SAME commit passed on runs where Neon happened to be warm. That is the
    // whole of the long-standing "CI flake" (previously mis-attributed to
    // cancelled runs dirtying the shared test branch: SESSION_HANDOFF.md's
    // "CI flake note" and BREAKAGE_TABLE's campaign_lifecycle entries).
    //
    // Raised ONLY under RUN_LIVE_FLOWS so the mocked suite keeps the strict 5s
    // budget — a mocked test that takes >5s is a real hang and must still fail.
    ...(process.env.RUN_LIVE_FLOWS === '1'
      ? { testTimeout: 60_000, hookTimeout: 60_000 }
      : {}),

    // hookTimeout is deliberately separate from testTimeout above.
    //
    // The 5s rule exists to catch a HANGING TEST BODY. It was never intended to
    // bound SETUP, and applying it to hooks breaks any suite whose setup does
    // irreducible real work. Five suites here boot PGlite - a WASM build of
    // PostgreSQL - and run a multi-table DDL script in beforeAll
    // (aiCreditGate, aiCreditLimits, tenantIsolation, authz.e2e, and
    // multitenant-matrix). Measured on this machine, PGlite startup alone
    // exceeded 90s under load, so a 10s hook budget fails intermittently and
    // silently skips the ENTIRE file's tests: multitenant-matrix's 16 tenant
    // authorization tests were skipped this way, which is precisely the
    // coverage that must never quietly disappear.
    //
    // No test body timeout is relaxed. A hook that hangs is a far rarer and
    // more obvious failure than a test body that hangs, and 60s is still well
    // short of vitest's own 30s-per-1000-lines default for slow files.
    hookTimeout: 60_000,
  },
});
