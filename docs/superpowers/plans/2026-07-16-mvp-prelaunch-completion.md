# MVP Pre-Launch Completion Plan

**Date**: 2026-07-16  
**Branch**: `feat/mvp-prelaunch`  
**Baseline**: Typecheck ✅ | Tests 449 passed, 45 skipped, 0 failed

---

## Objective

Transform DealFlow AI into a production-ready MVP suitable for beta users, following the 12-phase prompt. Work is isolated on `feat/mvp-prelaunch`; pre-existing WIP is stashed and will be selectively integrated.

---

## Phase 1: Atomic Debugging

### Goal
Establish a clean, warning-free baseline. Fix every existing issue at root cause.

### Tasks
1. **Restore negotiation starter files** from stash (the only relevant pre-existing WIP).
2. **Run lint audit** with oxlint and address real issues.
3. **Fix Next 16 `params` deprecation** in dynamic routes.
4. **Verify no console errors** in dev build.
5. **Audit for dead code / unused imports**.
6. **Confirm all routes render** without hydration errors.

### Verification
- `yarn typecheck` exit 0
- `yarn test` 0 failures
- `oxlint` 0 errors
- Dev server starts without warnings

---

## Phase 2: Negotiation Engine Configurator

### Goal
Replace hardcoded negotiation logic with database-driven, versioned profiles.

### Database Changes
- Migration `011_negotiation_profiles.sql`
- Tables:
  - `negotiation_profiles`
  - `negotiation_profile_versions`
- Seed 18 default profiles

### API Changes
- `GET /api/negotiation/profiles`
- `POST /api/negotiation/profiles`
- `GET /api/negotiation/profiles/[id]`
- `PATCH /api/negotiation/profiles/[id]`
- `POST /api/negotiation/profiles/[id]/rollback`

### UI Changes
- New page: `/settings/negotiation-profiles`
- Reuse existing shadcn/ui components

### Verification
- Migration is idempotent
- API tests cover CRUD + rollback
- No hardcoded values remain in negotiation engine

---

## Phase 3: AI Negotiation Enhancement

### Goal
Generate comprehensive, configurable negotiation recommendations.

### Changes
- Extend `NegotiationResult` interface
- Update prompt builder to request new fields
- Update parser to validate new fields
- Update fallback calculator to use profile parameters
- Add disclaimer that outputs are guidance, not guarantees

### New Outputs
- walkAwayPrice
- counterOfferStrategy
- negotiationScript
- sellerPsychologySummary
- buyerExitStrategy
- riskAssessment
- assignmentFeasibility
- estimatedDaysToDisposition
- reasoningSummary

### Verification
- Unit tests for fallback calculator
- Parser tests for new fields
- Integration test with mocked AI

---

## Phase 4: UI/UX Polish

### Goal
Professional, accessible SaaS interface.

### Tasks
- Audit all major pages for empty/error/loading states
- Add dark mode toggle
- Add loading skeletons
- Improve responsive layouts
- Add toast notifications for key actions
- Verify keyboard navigation
- Run accessibility audit

### Verification
- Lighthouse scores improved
- Manual keyboard navigation test
- No console errors

---

## Phase 5: Backend Hardening

### Goal
Production-grade API reliability.

### Tasks
- Enhance rate limiting (per-user, Redis-backed)
- Add input validation schemas (Zod)
- Standardize error responses
- Improve background job retry logic
- Add request tracing

### Verification
- Rate limit tests
- Validation tests
- Error handling tests

---

## Phase 6: Database Optimization

### Goal
Performant, reliable data layer.

### Tasks
- Review schema for missing indexes
- Add foreign keys where appropriate
- Optimize slow queries
- Document migration rollback procedure

### Verification
- EXPLAIN ANALYZE on key queries
- Migration idempotency verified

---

## Phase 7: Docker Production Setup

### Goal
Production-ready containerization.

### Tasks
- Add Redis service
- Add Nginx reverse proxy
- Add health checks
- Create `docker-compose.prod.yml`
- Improve `docker-compose.yml` for dev
- Add graceful shutdown

### Verification
- `docker-compose up` starts all services
- Health checks pass
- Production image builds

---

## Phase 8: DevOps Pipeline

### Goal
Automated CI/CD for production.

### Tasks
- Add deploy workflow
- Add container build + push
- Add staging smoke tests
- Add production promotion gate
- Document rollback procedure

### Verification
- CI workflow validates
- Deployment steps documented

---

## Phase 9: Security Hardening

### Goal
Production security posture.

### Tasks
- HTTPS readiness headers
- CSP headers
- CORS hardening
- JWT validation review
- Dependency audit
- Secret rotation procedure

### Verification
- Security tests pass
- Dependency audit clean

---

## Phase 10: Observability

### Goal
Full operational visibility.

### Tasks
- Structured JSON logging
- Request correlation IDs
- Health dashboard enhancements
- Metrics collection
- Alerting thresholds

### Verification
- Logs are structured
- Health endpoint returns comprehensive status

---

## Phase 11: Testing

### Goal
Comprehensive test coverage.

### Tasks
- Add negotiation profile tests
- Add AI negotiation tests
- Add accessibility tests
- Add smoke tests
- Run full suite

### Verification
- 80%+ coverage on critical paths
- All tests pass

---

## Phase 12: Production Readiness

### Goal
Final verification before launch.

### Tasks
- Run full verification checklist
- Build production image
- Document deployment guide
- Document rollback guide
- Document monitoring guide
- Document known limitations

### Verification
- No TODOs in production code
- No build warnings
- All documentation complete

---

## Execution Notes

- Work in small, test-driven increments.
- Request code review between major phases.
- Keep commits atomic and well-described.
- Never suppress warnings; fix root causes.
- Preserve existing architecture unless absolutely necessary.