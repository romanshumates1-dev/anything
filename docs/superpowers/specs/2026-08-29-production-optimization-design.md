# DealFlow AI Production Optimization Design Spec

**Date:** 2026-08-29  
**Status:** Approved  
**Effort Estimate:** 6-9 hours

## Overview

Comprehensive production optimization covering security hardening, pipeline atomicity, bug fixes, and conversion optimization. Prioritized by risk: security vulnerabilities first, then data integrity, then stability, then growth.

---

## Phase 1: Security Hardening (Critical)

### 1.1 IDOR Vulnerability Fixes

5 routes allow cross-tenant data access by querying with ID alone.

| Route | Fix Required |
|-------|--------------|
| `prospects/[id]/messages/route.ts` | Add `organization_id` filter to all queries |
| `negotiation/profiles/[id]/route.ts` | Add org filter to `getProfile()` |
| `negotiation/sessions/[id]/pause/route.ts` | Add org filter to `pauseSession()` |
| `lead-finder/sources/[id]/route.ts` | Add org filter to GET/DELETE |
| `lead-finder/sources/[id]/fetch/route.ts` | Add org filter to fetch and insert |

**Pattern:**
```typescript
// Before (vulnerable)
const [item] = await sql`SELECT * FROM table WHERE id = ${id}`;

// After (secure)
const organization = await getOrganization();
const [item] = await sql`
  SELECT * FROM table 
  WHERE id = ${id} AND organization_id = ${organization.id}
`;
```

### 1.2 CSRF Enforcement

`requireValidCsrf()` exists but is never called. Add to all session-authenticated state-changing endpoints.

**Priority routes:**
- `admin/*` (user management, bans, subscriptions)
- `settings/*` (API keys, beta flags, number pool)
- `payments/route.ts`
- `approvals/[id]/route.ts`
- `leads/[id]/route.ts` (PATCH, DELETE)
- `campaigns/[id]/route.ts` (PATCH, DELETE)
- `contracts/generate/route.ts`, `contracts/send/route.ts`

**Exceptions (already protected):**
- Webhook endpoints (signature validation)
- v1/* API routes (API key auth)
- Auth endpoints

**Implementation:**
```typescript
export async function POST(req: NextRequest) {
  const csrfError = requireValidCsrf(req);
  if (csrfError) return csrfError;
  // ... rest of handler
}
```

### 1.3 Token Hashing

E-sign session tokens stored in plaintext. Hash before storage.

**File:** `esign/self-hosted/route.ts`

```typescript
import { createHash } from 'crypto';

// Before storing
const tokenHash = createHash('sha256').update(session.token).digest('hex');
await sql`INSERT INTO esign_sessions (token, ...) VALUES (${tokenHash}, ...)`;

// Before lookup
const tokenHash = createHash('sha256').update(token).digest('hex');
const [session] = await sql`SELECT * FROM esign_sessions WHERE token = ${tokenHash}`;
```

---

## Phase 2: Pipeline Atomicity (High Priority)

### 2.1 Routes Needing Transactions

7 routes perform multiple writes without transaction wrapping.

| Route | Tables Affected | Risk |
|-------|-----------------|------|
| `campaigns/[id]/launch/route.ts` | campaign_leads, ai_conversations, campaigns | Partial launch state |
| `contracts/generate/route.ts` | contracts, leads | Orphan contracts |
| `contracts/send/route.ts` | contracts (insert + update) | Missing envelope ID |
| `leads/[id]/route.ts` DELETE | leads, campaign_leads | Orphan campaign_leads |
| `leads/bulk/route.ts` | imports, leads, import_failures | Partial import |
| `esign/webhook/route.ts` | esign_events, contracts, payments_ledger | Missing payment records |
| `payments/webhook/route.ts` | payments_ledger + job enqueue | Duplicate jobs |

**Implementation Pattern:**
```typescript
// Before (non-atomic)
await sql`INSERT INTO contracts ...`;
await sql`UPDATE leads SET status = 'UNDER_CONTRACT' ...`;

// After (atomic)
await sql.transaction([
  sql`INSERT INTO contracts ...`,
  sql`UPDATE leads SET status = 'UNDER_CONTRACT' ...`,
]);
```

### 2.2 Priority Order

1. `esign/webhook/route.ts` - Payment creation on contract sign is critical
2. `campaigns/[id]/launch/route.ts` - High volume operations
3. `leads/bulk/route.ts` - Import integrity
4. `contracts/generate/route.ts` - Contract + lead status
5. `contracts/send/route.ts` - Contract + envelope
6. `leads/[id]/route.ts` DELETE - Cleanup integrity
7. `payments/webhook/route.ts` - Idempotency

---

## Phase 3: Bug Fixes (19 Failing Tests)

### 3.1 Critical (Pipeline/Contracts)

| Test File | Likely Issue |
|-----------|--------------|
| `pipeline-integration.test.ts` | Mock/stub mismatch after refactors |
| `contracts/engine.test.ts` | Contract generation API changes |
| `negotiationEngine.test.ts` | Negotiation flow changes |

### 3.2 Lead Finder (5 tests)

| Test File | Likely Issue |
|-----------|--------------|
| `lead-finder/sources/[id]/fetch/route.test.ts` | Returns 404/403 instead of 502 |
| `lead-finder/create-campaign/dealTarget.test.ts` | API signature changes |
| `lead-finder/create-campaign/route.test.ts` | API signature changes |
| `lead-finder/plan/route.test.ts` | Planner changes |
| `lead-finder/utils/planner.test.ts` | Planner changes |

### 3.3 E2E (2 tests)

| Test File | Likely Issue |
|-----------|--------------|
| `e2e/journey.spec.ts` | Selector/flow changes |
| `e2e/marketing.spec.ts` | Marketing page changes |

### 3.4 Other

- `ai-orchestrator.test.ts` - Provider fallback changes
- `payments/webhook.test.ts` - Webhook signature
- `stripeProvider.test.ts` - Mock setup
- `ingestion.test.ts` - Data format changes
- `messaging.gate.test.ts` - Gate logic changes
- `ownerNumberCollision.test.ts` - Number assignment
- `scoring-engine.test.ts` - Scoring algorithm
- `high-volume.test.ts` - Config changes

---

## Phase 4: Conversion Optimization

### 4.1 Quick Wins (High Impact)

**Fix broken CTAs:**
| File | Line | Current | Fix |
|------|------|---------|-----|
| `(marketing)/page.tsx` | 166 | `/contact` | `/account/signup` |
| `(marketing)/how-it-works/page.tsx` | 186 | `/contact` | `/account/signup` |

**Add urgency banner to homepage:**
```tsx
import { UrgencyBanner } from '@/components/marketing';
// Add at top of page
<UrgencyBanner variant="spots" spotsRemaining={847} discount={50} />
```

**Add CTA to features page:**
```tsx
// Add after features grid
<section className="mt-16 text-center">
  <Link href="/account/signup" className="...">Start Free Trial</Link>
</section>
```

### 4.2 Signup Page Enhancement

Add social proof and value reinforcement:
- "Join 500+ wholesalers" counter
- Key benefits sidebar (3 bullet points)
- Trust badges (SOC 2, encryption)
- Plan preview if `?plan=` param present

### 4.3 Analytics Hooks (Future)

- Funnel tracking: page view → signup click → trial start → paid conversion
- A/B test framework for pricing experiments
- Exit intent detection

---

## Implementation Order

1. **Phase 1.1** - IDOR fixes (5 routes) - 30 min
2. **Phase 1.2** - CSRF enforcement (15+ routes) - 1 hour
3. **Phase 1.3** - Token hashing - 15 min
4. **Phase 2** - Transactions (7 routes) - 1.5 hours
5. **Phase 3** - Bug fixes (19 tests) - 2-4 hours
6. **Phase 4.1** - CTA fixes - 15 min
7. **Phase 4.2** - Signup enhancement - 1 hour

---

## Success Criteria

- [ ] All 5 IDOR routes have organization_id checks
- [ ] CSRF applied to all state-changing session-auth routes
- [ ] E-sign tokens hashed before storage
- [ ] All 7 multi-write routes use transactions
- [ ] Test pass rate improved (target: <10 failing)
- [ ] All marketing CTAs point to `/account/signup`
- [ ] Typecheck passes with 0 errors

---

## Out of Scope

- New feature development
- UI redesign beyond conversion fixes
- Database schema changes
- Third-party integrations
