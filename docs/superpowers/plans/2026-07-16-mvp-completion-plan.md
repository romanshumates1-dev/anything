# MVP Pre-Launch Completion Plan

**Date**: 2026-07-16  
**Goal**: Convert DealFlow AI into a polished, production-ready MVP for beta users  
**Architecture**: Next.js 16 monorepo + Neon Postgres + Edge API routes  
**Tech Stack**: TypeScript, React 19, TailwindCSS v4, Vitest, Playwright  
**Global Constraints**: No breaking changes, preserve existing architecture, fix at root cause

---

## Phase 1 — Cleanup & Security Hardening

### Step 1.1: Fix 40 oxlint warnings (unused imports/vars)
**Files**: 22 test files + 4 production files  
**Action**: Remove unused imports, prefix unused params/vars with `_`  
**Verify**: `yarn dlx oxlint@1.58.0 --no-ignore apps/web/src` → 0 warnings  

### Step 1.2: Remove false-security `security.ts`
**File**: `apps/web/src/app/api/utils/security.ts`  
**Reason**: App uses parameterized queries via `sql` tagged template. The incomplete regex-based SQL sanitizer gives false sense of security. Remove file + its test + all imports.  
**Verify**: typecheck 0, tests pass  

### Step 1.3: Add CSP + HSTS headers
**File**: `next.config.js` (security headers)  
**Action**: Add Content-Security-Policy and Strict-Transport-Security  

### Step 1.4: Fix `v1/approvals/route.ts` bug
**File**: `apps/web/src/app/api/v1/approvals/route.ts`  
**Action**: Fix query variable reassignment (currently sets broken query when `status` param provided)  

---

## Phase 2 — UI/UX Polish (Design System)

### Step 2.1: Add loading skeleton components
**Files**: `ui/skeleton.tsx` (exists), add skeleton patterns for every data view  
**Action**: Create reusable `DataTableSkeleton`, `CardSkeleton`, `ListSkeleton`  

### Step 2.2: Add empty state components
**Files**: `ui/empty.tsx` (exists but may need enhancement)  
**Action**: Create reusable `EmptyState` with icon, title, description, action CTA  

### Step 2.3: Add confirmation dialogs for destructive actions
**Files**: Integrate `ui/alert-dialog.tsx` into campaign delete, API key revoke  

### Step 2.4: Add toast notifications consistency
**Files**: Integrate `sonner` toast across all user actions  

### Step 2.5: Responsive layout audit + fix
**Files**: Check Shell, dashboard, campaigns, inbox, settings pages  

### Step 2.6: Dark/light mode polish
**Files**: Ensure all new components respect theme  

---

## Phase 3 — Observability (OpenTelemetry)

### Step 3.1: Wire OpenTelemetry SDK
**File**: `apps/web/src/app/api/utils/observability.ts` (expand)  
**Action**: Add structured logging, request tracing, basic metrics  

### Step 3.2: Add health dashboard
**File**: `apps/web/src/app/api/system/health/route.ts` (expand)  
**Action**: Add service detail, queue depth, latency metrics  

### Step 3.3: Add Prometheus metrics endpoint
**File**: `apps/web/src/app/api/system/metrics/route.ts` (populate)  
**Action**: Expose counter/gauges for job queue, SMS, AI calls  

---

## Phase 4 — Negotiation Profiles Expansion

### Step 4.1: Add 17 more seed profiles
**File**: `db/migrations/013_more_negotiation_profiles.sql`  
**Action**: Add profiles for all 20+ acquisition strategies from spec  

### Step 4.2: Add profile versioning
**Files**: Add `version` column to `negotiation_profiles`, create history table  

### Step 4.3: Full profile CRUD editor page
**File**: Settings → Negotiation Profiles page  
**Action**: Complete the editor (not just preview card)  

---

## Phase 5 — Testing Expansion

### Step 5.1: Add E2E tests for settings pages
**File**: `apps/web/e2e/settings.spec.ts`  
**Action**: Beta flags toggle, API key create/revoke, number pool add/remove  

### Step 5.2: Add accessibility tests
**File**: `apps/web/e2e/a11y.spec.ts`  
**Action**: Axe-core integration in Playwright  

### Step 5.3: Add load test for jobs queue
**File**: Add test with 1000 concurrent job processing  

---

## Phase 6 — Verification

### Step 6.1: Run full CI pipeline
**Action**: Push to main, verify all 6 jobs pass  

### Step 6.2: Complete 20-step manual QA
**Action**: Run verification script from FINAL_STATE.md  

### Step 6.3: Document remaining known limitations
**File**: Update FINAL_STATE.md