# Comprehensive Testing Plan: DealFlow AI Pipeline

**Created:** 2026-08-01
**Purpose:** REAL bug testing and verification of ALL implementations - no "I think it's done" situations

## Global Constraints

1. **REAL TESTS ONLY** - Every test must execute actual logic, not just check file existence
2. **Verify edge cases** - Test boundary conditions, error handling, and failure modes
3. **Frontend AND Backend** - Test both API endpoints and component logic
4. **No assumptions** - If a test passes, show the actual output proving it worked
5. **Fail fast** - Report failures immediately with specific line numbers and actual vs expected

## Test Categories

### Task 1: Negotiation Engine Tests
**Files:** `apps/web/src/app/api/utils/negotiationEngine.ts`
**Critical Logic:**
- $5,000 FEE_FLOOR_CENTS (500_000 cents) - HARD MINIMUM
- Inspection period: 7-21 days, default 14
- Attorney mod period: 3-10 days, default 5
- Closing timeline: 7-45 days, default 21
- Earnest money: $500-$5000, default $1000
- Concession curve: [0.4, 0.25, 0.15, 0.1]
- Seller side: opens LOW, concedes UP to ceiling
- Buyer side: opens HIGH, concedes DOWN to floor
- Walk away if fee floor violated

**Test Cases:**
1. Fee floor enforcement - reject $4,999 fee, accept $5,000
2. Inspection days clamping - request 5 days → clamp to 7
3. Inspection days clamping - request 30 days → clamp to 21
4. Buyer offer state creation - validate floor calculation
5. Seller negotiation - verify concession curve math
6. Buyer negotiation - verify never goes below floor
7. extractDollarAmountsCents - test $87,500, 87.5k, $1,234.56
8. numericGuard - test spelled amounts blocked
9. Walk away scenarios - exhausted curve, invalid geometry

### Task 2: Prospect Scoring Engine Tests  
**Files:** `apps/web/src/app/api/prospects/scoring-engine.ts`
**Critical Logic:**
- Seller weights: Pre-foreclosure +30, Tax delinquent +25, Probate +20, etc.
- Buyer weights: Cash +30, Multiple purchases +25, Previous closed +20, etc.
- Seller tiers: HOT (70+), WARM (50-69), COOL (30-49), COLD (<30)
- Buyer tiers: VIP (80+), VERIFIED (60-79), PROSPECT (40-59), UNVERIFIED (<40)
- Earnest money: VIP $100-500, VERIFIED $500-1500, PROSPECT $1500-3000, UNVERIFIED $3000-5000
- Score cap at 100

**Test Cases:**
1. Seller scoring - pre-foreclosure + tax delinquent = 55 (WARM)
2. Seller scoring - all signals max = 100 (capped)
3. Buyer scoring - VIP threshold (cash + purchases + POF + closed = 95)
4. Buyer scoring - UNVERIFIED threshold (no signals = 0)
5. Earnest money calculation by tier
6. Earnest money scaling by deal value
7. isContactable - COLD returns false
8. requiresPOF - UNVERIFIED returns true

### Task 3: Campaign Config Tests
**Files:** `apps/web/src/app/api/campaigns/config/high-volume.ts`
**Critical Logic:**
- AWS Credit ID: 10064436819
- Daily target: 150,000
- Max daily cap: 250,000
- Warmup schedule: Day 1 (10k) → Day 7 (150k)
- Quality gates: bounce <5%, complaint <0.1%, unsub <2%
- Pacing: 104/min, 6250/hr
- Cost: ~$14 per 150k

**Test Cases:**
1. getWarmupTarget - Day 1 = 10k, Day 4 = 75k, Day 8+ = 150k
2. checkQualityGates - 6% bounce rate fails
3. checkQualityGates - 0.05% complaint rate passes
4. calculatePacing - daily limit enforcement
5. calculatePacing - per-minute limit enforcement
6. estimateCost - 300k emails = $28
7. estimateMonthlyCost - 30 days at 150k = ~$420

### Task 4: Regional Compliance Tests
**Files:** `apps/web/src/app/api/compliance/messaging-gate.ts`, `regional-messaging/engine.ts`
**Critical Logic:**
- Florida quiet hours: 8pm (stricter than federal 9pm)
- Federal quiet hours: 8am-9pm
- State detection from address
- DNC registry check
- Required disclosures by state

**Test Cases:**
1. checkQuietHours - FL at 8:30pm = blocked
2. checkQuietHours - TX at 8:30pm = allowed (federal 9pm)
3. checkQuietHours - email channel = always allowed
4. Disclosure injection - SMS opt-out added
5. State-specific warnings - FL written consent warning
6. generateCompliantSms - includes STOP disclosure

### Task 5: Contract Engine Tests
**Files:** `apps/web/src/app/api/contracts/engine.ts`
**Critical Logic:**
- $5,000 MINIMUM_ASSIGNMENT_FEE enforced
- State detection from address
- Regional addendum generation (TX, FL, CA, generic)
- Required disclosures by state

**Test Cases:**
1. detectState - "123 Main St, Austin, TX 78701" → TX
2. detectState - "Los Angeles, California" → CA
3. generateContract - assignment with $4,999 fee throws error
4. generateContract - TX property includes Texas addendum
5. validateContractVariables - price mismatch detected
6. getRequiredDisclosures - CA includes earthquake zone

### Task 6: Alert System Tests
**Files:** `apps/web/src/app/api/alerts/notification-engine.ts`
**Critical Logic:**
- CRITICAL alerts send email + SMS
- Assignment fee paid triggers alert
- Proper alert formatting

**Test Cases:**
1. Alert level classification
2. Email + SMS both triggered for CRITICAL
3. Alert content formatting

### Task 7: E-Sign Engine Tests
**Files:** `apps/web/src/app/api/esign/self-hosted/engine.ts`
**Critical Logic:**
- SHA-256 document hashing
- Signature audit trail
- Document status transitions
- Signing session management

**Test Cases:**
1. createDocument - generates valid hash
2. applySignature - updates status correctly
3. Audit trail records all events
4. Expired document rejection

### Task 8: Payment Flow Tests
**Files:** `apps/web/src/app/api/payments/buyer-payment/route.ts`, `charge-assignment/route.ts`
**Critical Logic:**
- Payment BEFORE buyer signs
- Stripe integration
- Error handling

**Test Cases:**
1. Payment intent creation
2. Error on missing Stripe key
3. Invalid deal ID handling

## Execution Order

1. Task 1: Negotiation Engine (most critical - fee floor)
2. Task 2: Prospect Scoring Engine (buyer/seller qualification)
3. Task 3: Campaign Config (volume controls)
4. Task 4: Regional Compliance (legal requirements)
5. Task 5: Contract Engine (document generation)
6. Task 6-8: Supporting systems

## Success Criteria

- ALL tests execute and produce verifiable output
- Edge cases handled correctly (clamping, boundaries)
- Error messages are descriptive and accurate
- No assumptions - actual values logged
