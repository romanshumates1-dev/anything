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
  },
});
