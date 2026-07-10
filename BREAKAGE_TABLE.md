# BREAKAGE_TABLE.md — DealFlow AI

Every defect found across this session.

| # | journey step | expected | actual | error evidence | status |
|---|--------------|----------|--------|----------------|--------|
| 1 | App shell / all tabs render | `yarn dev` serves styled pages at :4000; register→login→import→campaign→analytics walkable | First page request fails to compile; no page rendered in the live browser this session | `Error: Can't resolve 'tailwindcss' in 'd:\anything\apps'` (Next 16 turbopack + `@tailwindcss/postcss` resolving from the wrong dir) | OPEN |
| 2 | jobs-dev single-instance lock | 2nd `yarn jobs:dev` prints `[jobs-dev] already running, PID <n>` and exits 1 | Lock code written; pidfile created + confirmed (`type` showed PID 47112); 2nd-launch refusal NOT proven live (first instance blocks terminal under the 30s command-timeout harness) | pidfile `.jobs-dev.pid` present with live PID; `acquireLock()`/`releaseLock()` in `apps/web/scripts/jobs-dev.mjs` | FIXED (code) — 2nd-launch refusal UNPROVEN |
| 3 | `yarn dev:clean` | kill port 4000 + stale jobs-dev pid, then start dev | Not verified; inline `node -e` uses `&&` chaining which is not PowerShell-safe as written | `package.json` root `dev:clean` script | OPEN |
| 4 | E2E Playwright journey (10-step) | 3/3 consecutive green in the live app | Not run this session — blocked by the tailwindcss compile error (#1) | see row 1 | OPEN |
| 5 | jobs-dev ESM require | script runs under `node --env-file=.env` | `require('fs')` threw in ESM `.mjs` | converted to `import { readFileSync, writeFileSync, unlinkSync } from 'fs'` | FIXED + PROVEN (jobs-dev boots, polls) |
