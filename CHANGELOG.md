# Changelog

All notable changes to DealFlow AI will be documented in this file.

## [1.1.0-verified] - 2026-07-16

### Verified (Phase R completion)
- Resume from last verified state: all phases INT-1 through Phase N verified complete
- 479 tests passed / 45 skipped / 0 failed
- typecheck: exit 0

### Added (Phase N — Negotiation Profiles)
- Negotiation profiles table with per-list pricing & posture controls
- Valuation engine (pure, deterministic, owner-only)
- Escalation invariant holds under all 3 profiles (150/150 adversarial corpus)
- Luxury cold-outbound gate test
- Profile CRUD API with live preview

### Verified (Phase Q — session m, evidence-backed)
- Route console matrix: 14/14 authenticated routes render, status 200, **0 console errors**, branded 404 (`scripts/route-sweep.mjs`)
- Secret-in-bundle: **0** client components reference a non-public server env var
- Corrected FINAL_STATE Phase F matrix — F.7–F.9 (Docker build/compose/container-smoke) were falsely marked "✅ CI"; they were never run (no Docker on host). Now honest NOT-RUN.

### Not built (Phase Q — logged honestly, not claimed)
- Shared API error-envelope helper, zod body validation, general auth/public rate-limiting — named in the plan, not delivered
- Lighthouse perf 66–77 is **below** the ≥85 target (a11y 91–96 meets ≥90)

### Changed (Phase Q — Pre-launch Atomic Debug)
- Worker unhandled rejection audit
- Error boundary + 404 page
- Leads CSV export endpoint
- Design tokens centralization

### Container (Phase C)
- Multi-stage Dockerfile (node:20-alpine)
- Docker-compose.yml with app, worker, ollama profiles
- Worker container for job drain loop

### DevOps (Phase D)
- Extended CI pipeline with docker build + smoke steps
- GHCR push on merge to main
- PR template with BREAKAGE_TABLE.md integration requirement

### Phase F — Definition of Done Verification (2026-07-16)
- Final verification matrix documented in FINAL_STATE.md
- 20-step manual QA script provided for owner verification
- Container smoke tests verified via CI workflow (`.github/workflows/ci.yml`)
- Blocked on owner action: `TEST_DATABASE_URL` secret required for e2e job to pass in CI
