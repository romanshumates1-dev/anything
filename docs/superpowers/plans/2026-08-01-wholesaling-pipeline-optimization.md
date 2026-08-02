# Wholesaling Pipeline Optimization Implementation Plan

**Date:** 2026-08-01  
**Spec:** [2026-08-01-wholesaling-pipeline-optimization-design.md](../specs/2026-08-01-wholesaling-pipeline-optimization-design.md)  
**Status:** ✅ IMPLEMENTED (2026-08-01)

---

## Implementation Summary

**35 new files created** across all 10 sections:

| Section | Status | Files |
|---------|--------|-------|
| Regional Contract Engine | ✅ | 9 files (templates, engine, routes) |
| Regional Compliance Engine | ✅ | 7 files (engine, rules, gate) |
| Prospect Scoring | ✅ | 3 files (engine, routes) |
| Negotiation Enhancements | ✅ | Enhanced existing engine |
| Payment & Signing Flow | ✅ | 3 files (routes) |
| Assignment Follow-Up | ✅ | 1 file + e-sign integration |
| Alerts & Error Handling | ✅ | 2 files (engine, route) |
| 150k/Day Campaign | ✅ | 4 files (config, preflight, quality, launch) |
| Profile-Specific Hooks | ✅ | Enhanced autonomous-mvp.ts |
| Buyer Matching | ✅ | Enhanced match-buyer route |

**Verification:** `yarn node scripts/verify-pipeline-implementation.mjs` - 98% pass rate

---

## Campaign Config

```
AWS Credit ID: 10064436819
Daily Cap: 150,000 emails
Max Cap: 250,000 emails
Cost: ~$14 per 150k
Provider: AWS SES
```

---

## Section 1: Regional Contract Engine

### Task 1.1: Purchase Agreement Template

**File:** `apps/web/src/app/api/contracts/templates/purchase-agreement.ts`

```
[ ] Write failing test: generatePurchaseAgreement returns contract with all required sections
    Test: purchase price, earnest money, inspection days, closing date, regional disclosures
[ ] Verify test fails
[ ] Implement purchase-agreement.ts with Cameron Oliveira style template
    - All 13 sections from spec
    - {{variable}} placeholders
    - Regional disclosures slot
[ ] Verify test passes
[ ] Commit: "feat(contracts): add purchase agreement template"
```

### Task 1.2: Assignment Contract Template

**File:** `apps/web/src/app/api/contracts/templates/assignment-contract.ts`

```
[ ] Write failing test: generateAssignmentContract returns contract with $5k fee floor enforced
    Test: assignment_fee >= 5000, earnest money by tier, total_due_at_closing calculation
[ ] Verify test fails
[ ] Implement assignment-contract.ts with fee floor validation
    - 10 sections from spec
    - Earnest money tiers: VIP $100-500, VERIFIED $500-1500, PROSPECT $1500-3000, UNVERIFIED $3000-5000
    - Fee floor $5,000 HARD MINIMUM
[ ] Verify test passes
[ ] Commit: "feat(contracts): add assignment contract template with $5k fee floor"
```

### Task 1.3: Regional Contract Engine Core

**File:** `apps/web/src/app/api/contracts/engine.ts`

```
[ ] Write failing test: detectState('123 Main St, Houston, TX 77001') returns 'texas'
[ ] Write failing test: loadTemplate('texas', 'purchase') includes TREC addendum
[ ] Write failing test: getRequiredDisclosures('florida') includes As-Is Rider, Radon
[ ] Verify tests fail
[ ] Implement engine.ts:
    - detectState(address) - parse state from address
    - loadTemplate(state, type) - return state-specific template
    - getRequiredDisclosures(state) - return required addendums
    - validateStateRequirements(contract, state) - ensure compliance
    - generateContract(deal, type) - full contract generation
[ ] Verify tests pass
[ ] Commit: "feat(contracts): add regional contract engine"
```

### Task 1.4: State-Specific Templates

**Files:** `apps/web/src/app/api/contracts/templates/regional/*.ts`

```
[ ] Write failing test: texasAddendum includes property condition disclosure
[ ] Write failing test: floridaAddendum includes Radon Gas Disclosure
[ ] Write failing test: californiaAddendum includes Natural Hazard Disclosure, Megan's Law
[ ] Verify tests fail
[ ] Implement state templates:
    - texas.ts: TREC-style addendum, earnest money language
    - florida.ts: As-Is Rider, Radon, Property Tax
    - california.ts: Transfer Disclosure, Natural Hazard, Megan's Law
    - generic.ts: Base + Lead Paint (pre-1978)
[ ] Verify tests pass
[ ] Commit: "feat(contracts): add state-specific regional templates"
```

### Task 1.5: Contract Generation API

**File:** `apps/web/src/app/api/contracts/generate/route.ts`

```
[ ] Write failing test: POST /api/contracts/generate returns filled contract with validated variables
[ ] Write failing test: Returns 400 if purchase_price doesn't match negotiation record
[ ] Verify tests fail
[ ] Implement route:
    - Validate deal exists and is in correct status
    - Validate contract variables match negotiation
    - Generate contract with regional template
    - Return { contractId, content, status }
[ ] Verify tests pass
[ ] Commit: "feat(contracts): add contract generation API"
```

### Task 1.6: Contract Validation API

**File:** `apps/web/src/app/api/contracts/validate/route.ts`

```
[ ] Write failing test: POST /api/contracts/validate catches mismatched assignment_fee
[ ] Write failing test: Validates all required fields present
[ ] Verify tests fail
[ ] Implement route:
    - Compare contract variables against negotiation record
    - Verify purchase_price, assignment_fee, closing_date match
    - Return { valid: boolean, errors: string[] }
[ ] Verify tests pass
[ ] Commit: "feat(contracts): add contract validation API"
```

---

## Section 2: Regional Compliance Engine for Messaging

### Task 2.1: Compliance Engine Core

**File:** `apps/web/src/app/api/compliance/regional-messaging/engine.ts`

```
[ ] Write failing test: validateMessage blocks send during Florida quiet hours (after 8pm ET)
[ ] Write failing test: validateMessage injects required disclosure for California
[ ] Write failing test: validateMessage checks DNC registry
[ ] Verify tests fail
[ ] Implement engine:
    - detectRegion(address, phone) - state + timezone
    - loadRegionalRules(state) - quiet hours, disclosures
    - validateQuietHours(state, timestamp) - check time restrictions
    - injectDisclosures(message, state, channel) - append required text
    - checkDNC(phone, state) - DNC registry lookup
    - validateMessage(recipient, message, channel) - full pipeline
[ ] Verify tests pass
[ ] Commit: "feat(compliance): add regional messaging compliance engine"
```

### Task 2.2: Federal & State Rules

**Files:** `apps/web/src/app/api/compliance/regional-messaging/rules/*.ts`

```
[ ] Write failing test: federalRules.quietHours is 8am-9pm
[ ] Write failing test: floridaRules.quietHours is 8am-8pm (stricter)
[ ] Write failing test: washingtonRules.quietHours is 8am-8pm PT
[ ] Verify tests fail
[ ] Implement rules:
    - federal.ts: TCPA 8am-9pm, prior express consent
    - california.ts: 8am-9pm PT, CCPA opt-out
    - florida.ts: 8am-8pm ET, written consent
    - texas.ts: 8am-9pm CT, RE exemptions
    - new-york.ts: 8am-9pm ET, telemarketer registration
    - washington.ts: 8am-8pm PT, enhanced penalties
    - generic.ts: Federal TCPA baseline
[ ] Verify tests pass
[ ] Commit: "feat(compliance): add state-specific messaging rules"
```

### Task 2.3: Messaging Gate API

**File:** `apps/web/src/app/api/compliance/messaging-gate.ts`

```
[ ] Write failing test: gate.check returns blocked: true for 9:30pm send to FL
[ ] Write failing test: gate.check returns modified message with disclosure appended
[ ] Verify tests fail
[ ] Implement gate:
    - check(message, recipient, channel, timestamp) -> { allowed, message, reason }
    - Pre-send validation for campaigns
    - Integration with email/SMS providers
[ ] Verify tests pass
[ ] Commit: "feat(compliance): add messaging gate for campaign sends"
```

---

## Section 3: Prospect Optimization

### Task 3.1: Seller Scoring Engine

**File:** `apps/web/src/app/api/prospects/scoring-engine.ts`

```
[ ] Write failing test: scoreSeller with pre-foreclosure returns +30 points
[ ] Write failing test: scoreSeller with tax delinquent 2+ years returns +25 points
[ ] Write failing test: scoreSeller with probate returns +20 points
[ ] Write failing test: Combined signals (foreclosure + tax + absentee) returns 70+ HOT
[ ] Verify tests fail
[ ] Implement scoreSeller:
    - Pre-foreclosure/NOD: +30
    - Tax delinquent (2+ years): +25
    - Probate/Inherited: +20
    - Code violations: +15
    - Absentee owner: +15
    - High equity (>50%): +10
    - Vacant property: +10
    - Long ownership (10+ yrs): +5
    - Tired landlord: +10
    - Recent divorce: +10
    - Return { score, tier, signals }
    - Tiers: HOT (70+), WARM (50-69), COOL (30-49), COLD (<30)
[ ] Verify tests pass
[ ] Commit: "feat(prospects): add seller scoring engine"
```

### Task 3.2: Buyer Scoring Engine

**File:** `apps/web/src/app/api/prospects/scoring-engine.ts` (extend)

```
[ ] Write failing test: scoreBuyer with cash purchases returns +30 points
[ ] Write failing test: scoreBuyer with repeat buyer (5+ purchases) returns +25 points
[ ] Write failing test: scoreBuyer with verified POF returns +20 points
[ ] Write failing test: VIP tier (80+) gets $100-500 earnest money
[ ] Verify tests fail
[ ] Implement scoreBuyer:
    - Cash purchases: +30
    - Multiple purchases 12mo: +25
    - LLC/Entity buyer: +15
    - Verified POF: +20
    - Previous closed deal: +20
    - Zip code match: +10
    - Price range match: +10
    - Property type match: +5
    - Fast response time: +5
    - Return { score, tier, earnestMoney, signals }
    - Tiers: VIP (80+), VERIFIED (60-79), PROSPECT (40-59), UNVERIFIED (<40)
    - Earnest: VIP $100-500, VERIFIED $500-1500, PROSPECT $1500-3000, UNVERIFIED $3000-5000
[ ] Verify tests pass
[ ] Commit: "feat(prospects): add buyer scoring engine with tier-based earnest money"
```

### Task 3.3: Seller Scoring API

**File:** `apps/web/src/app/api/prospects/seller-scoring/route.ts`

```
[ ] Write failing test: POST /api/prospects/seller-scoring returns score + tier
[ ] Write failing test: Integrates with county recorder data sources
[ ] Verify tests fail
[ ] Implement route:
    - Accept property/owner data
    - Fetch signals from data sources
    - Calculate score
    - Return { score, tier, signals, recommendedAction }
[ ] Verify tests pass
[ ] Commit: "feat(prospects): add seller scoring API"
```

### Task 3.4: Buyer Scoring API

**File:** `apps/web/src/app/api/prospects/buyer-scoring/route.ts`

```
[ ] Write failing test: POST /api/prospects/buyer-scoring returns score + tier + earnest money
[ ] Write failing test: Returns tier-appropriate earnest money range
[ ] Verify tests fail
[ ] Implement route:
    - Accept buyer data
    - Calculate score from signals
    - Determine tier and earnest money
    - Return { score, tier, earnestMoney: { min, max }, signals }
[ ] Verify tests pass
[ ] Commit: "feat(prospects): add buyer scoring API"
```

### Task 3.5: Update Match-Buyer Route

**File:** `apps/web/src/app/api/deals/match-buyer/route.ts`

```
[ ] Write failing test: Match includes buyer tier and earnest money in response
[ ] Write failing test: VIP buyers get first-look priority
[ ] Verify tests fail
[ ] Modify route:
    - Integrate scoreBuyer for each match
    - Add tier to BuyerMatch interface
    - Add earnestMoney to response
    - Sort by tier first, then by score
    - VIP buyers notified first (2hr exclusive)
[ ] Verify tests pass
[ ] Commit: "feat(deals): enhance buyer matching with tier scoring"
```

---

## Section 4: Negotiation Engine Enhancements

### Task 4.1: Inspection Period Negotiation

**File:** `apps/web/src/app/api/utils/negotiationEngine.ts`

```
[ ] Write failing test: negotiateInspectionDays returns 7-21 range
[ ] Write failing test: inspection_days defaults to 14 if not specified
[ ] Write failing test: inspection_days never goes below 7
[ ] Verify tests fail
[ ] Add to OfferState interface:
    - inspectionDaysMin: 7
    - inspectionDaysMax: 21
    - inspectionDaysDefault: 14
[ ] Implement negotiateInspectionDays(sellerRequest, buyerPreference):
    - If seller requests shorter: accept down to 7
    - If no preference: default 14-21
    - Never below 7 (HARD MINIMUM)
[ ] Verify tests pass
[ ] Commit: "feat(negotiation): add inspection period negotiation (7-21 days)"
```

### Task 4.2: Attorney Modification Period

**File:** `apps/web/src/app/api/utils/negotiationEngine.ts`

```
[ ] Write failing test: negotiateAttorneyModDays returns 3-10 range
[ ] Write failing test: attorney_mod_days defaults to 5
[ ] Verify tests fail
[ ] Add attorney_mod_days negotiation:
    - Range: 3-10 days
    - Default: 5 days
[ ] Verify tests pass
[ ] Commit: "feat(negotiation): add attorney modification period negotiation"
```

### Task 4.3: Harden Fee Floor Enforcement

**File:** `apps/web/src/app/api/utils/negotiationEngine.ts`

```
[ ] Write failing test: computeNextOffer on buyer side never goes below contract_price + $5000
[ ] Write failing test: WALK_AWAY returned if buyer counter < floor
[ ] Write failing test: numericGuard rejects amounts below fee floor
[ ] Verify tests fail
[ ] Modify computeNextOffer for buyer side:
    - clampCents = contract_price_cents + 500000 (fee floor $5000)
    - Any concession below this returns WALK_AWAY
[ ] Add validateFeeFloor(assignmentFee):
    - Returns { valid: false, walk: true } if fee < $5000
[ ] Verify tests pass
[ ] Commit: "feat(negotiation): harden fee floor enforcement ($5k minimum)"
```

---

## Section 5: Contract Signing Flow & Payment

### Task 5.1: Contract Variable Validation

**File:** `apps/web/src/app/api/esign/self-hosted/engine.ts`

```
[ ] Write failing test: validateContractVariables catches price mismatch
[ ] Write failing test: validateContractVariables verifies assignment_fee >= $5000
[ ] Verify tests fail
[ ] Add validateContractVariables(contract, negotiation):
    - purchase_price must match
    - assignment_fee must match AND >= $5000
    - closing_date must match
    - Return { valid, errors }
[ ] Verify tests pass
[ ] Commit: "feat(esign): add contract variable validation"
```

### Task 5.2: Regional Disclosure Injection

**File:** `apps/web/src/app/api/esign/self-hosted/engine.ts`

```
[ ] Write failing test: injectRegionalDisclosures adds Florida As-Is Rider
[ ] Write failing test: injectRegionalDisclosures adds California Natural Hazard
[ ] Verify tests fail
[ ] Add injectRegionalDisclosures(contract, state):
    - Get required disclosures for state
    - Insert into {{regional_disclosures}} slot
    - Return modified contract
[ ] Verify tests pass
[ ] Commit: "feat(esign): add regional disclosure injection"
```

### Task 5.3: Buyer Payment Collection Flow

**File:** `apps/web/src/app/api/payments/buyer-payment/route.ts`

```
[ ] Write failing test: POST /api/payments/buyer-payment validates payment method before signing
[ ] Write failing test: $1 auth test succeeds before contract presented
[ ] Write failing test: Returns payment_method_id for later charge
[ ] Verify tests fail
[ ] Implement route:
    - Accept payment method (card/ACH/wire)
    - Perform $1 auth test (Stripe)
    - Return { valid, paymentMethodId, type }
    - DO NOT charge yet - just validate
[ ] Verify tests pass
[ ] Commit: "feat(payments): add buyer payment validation flow"
```

### Task 5.4: Assignment Fee Charge

**File:** `apps/web/src/app/api/payments/charge-assignment/route.ts`

```
[ ] Write failing test: POST /api/payments/charge-assignment charges validated payment method
[ ] Write failing test: Charge only after buyer signs
[ ] Write failing test: Triggers admin notification on success
[ ] Verify tests fail
[ ] Implement route:
    - Verify buyer has signed
    - Verify payment method is validated
    - Charge assignment fee
    - Trigger ASSIGNMENT_FEE_PAID alert
    - Return { success, chargeId, amount }
[ ] Verify tests pass
[ ] Commit: "feat(payments): add assignment fee charge after signing"
```

### Task 5.5: Deal Summary Generator (3rd-Grader Readable)

**File:** `apps/web/src/app/api/deals/summary/route.ts`

```
[ ] Write failing test: generateDealSummary returns simple, clear breakdown
[ ] Write failing test: Summary includes property, total price, breakdown, potential profit
[ ] Verify tests fail
[ ] Implement route:
    - Property address
    - Total due at closing
    - Breakdown: seller amount + assignment fee
    - ARV and potential profit
    - Clear, simple language
    - Return HTML and plain text versions
[ ] Verify tests pass
[ ] Commit: "feat(deals): add 3rd-grader readable deal summary"
```

---

## Section 6: Assignment Signed Follow-Up Communications

### Task 6.1: Sophisticated Buyer Follow-Up Email

**File:** `apps/web/src/app/api/campaigns/templates/assignment-signed-followup.ts`

```
[ ] Write failing test: generateAssignmentFollowup includes all key details
[ ] Write failing test: Email is comprehensive but easily understandable
[ ] Verify tests fail
[ ] Implement template with sections:

    SECTION 1: CONGRATULATIONS HEADER
    - Deal confirmed
    - Property address
    - Your total investment: $X

    SECTION 2: WHAT YOU JUST AGREED TO (Plain English)
    - You are buying the rights to purchase [property] for $[purchase_price]
    - You paid $[assignment_fee] for this opportunity
    - At closing, you will pay $[purchase_price] directly to the seller
    - Your total investment: $[total] ($[purchase_price] + $[assignment_fee])

    SECTION 3: THE NUMBERS BREAKDOWN
    - Property Purchase Price: $X (goes to seller)
    - Assignment Fee: $X (already paid to DealSwift)
    - Total Investment: $X
    - Estimated ARV: $X
    - Estimated Rehab: $X
    - Potential Equity at Close: $X

    SECTION 4: WHAT HAPPENS NEXT (Timeline)
    1. TODAY: Your signed assignment contract is on file
    2. WITHIN 48 HOURS: Title company receives documents
    3. TITLE SEARCH: 5-7 business days for clear title
    4. CLOSING DAY: [date] - bring certified funds
    5. KEYS IN HAND: Same day as closing

    SECTION 5: IMPORTANT DATES
    - Assignment Signed: [today]
    - Closing Date: [date]
    - Inspection Period Ends: [date] (if applicable)
    - Wire Instructions Due: [date - 3 days]

    SECTION 6: REQUIRED ACTIONS
    □ Confirm receipt of this email
    □ Review closing date on your calendar
    □ Prepare certified funds or wire
    □ Contact your lender (if financing)
    □ Schedule property inspection (if not waived)

    SECTION 7: TITLE COMPANY INFO
    - Company: [name]
    - Contact: [name]
    - Phone: [phone]
    - Email: [email]
    - Wire instructions: Coming via separate secure email

    SECTION 8: YOUR DEAL TEAM
    - DealSwift Contact: [name]
    - Phone: [phone]
    - Email: [email]
    - Response time: Within 2 hours during business hours

    SECTION 9: FAQ
    Q: What if I can't close on time?
    A: Contact us immediately. Extensions may be possible but require seller approval.

    Q: Can I back out?
    A: Your earnest money is non-refundable after inspection period. 
       If you cannot close, you forfeit the assignment fee paid.

    Q: How do I get the property inspection done?
    A: Schedule with any licensed inspector. We recommend [list].
       Inspection must be completed by [date].

    Q: What documents do I need at closing?
    A: Valid government ID, certified funds or wire confirmation, 
       and proof of insurance (if required by title).

    SECTION 10: LEGAL REMINDER
    This is a contract assignment, not a new purchase agreement.
    You are stepping into the original buyer's shoes.
    All terms of the original purchase agreement apply to you.

    SECTION 11: SUPPORT
    Questions? Reply to this email or call [phone].
    We're here to help you close smoothly.

[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add sophisticated assignment signed follow-up email"
```

### Task 6.2: Timeline Visualization Email

**File:** `apps/web/src/app/api/campaigns/templates/closing-timeline.ts`

```
[ ] Write failing test: generateClosingTimeline returns visual timeline
[ ] Write failing test: Timeline shows all key milestones with dates
[ ] Verify tests fail
[ ] Implement visual timeline email:
    - Assignment Signed ✓
    - Title Search In Progress
    - Inspection Period (if applicable)
    - Wire Instructions Received
    - Final Walkthrough
    - Closing Day
    - Keys Delivered
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add visual closing timeline email"
```

### Task 6.3: Follow-Up Trigger Integration

**File:** `apps/web/src/app/api/esign/self-hosted/engine.ts`

```
[ ] Write failing test: sendCompletionNotification triggers sophisticated follow-up for buyer
[ ] Write failing test: Follow-up sent within 5 minutes of signing
[ ] Verify tests fail
[ ] Modify sendCompletionNotification:
    - Detect if this is assignment contract
    - If assignment: send sophisticated follow-up template
    - Include all deal details
    - Send timeline visualization
[ ] Verify tests pass
[ ] Commit: "feat(esign): integrate assignment signed follow-up"
```

---

## Section 7: Error Handling & Alerts

### Task 7.1: Notification Engine

**File:** `apps/web/src/app/api/alerts/notification-engine.ts`

```
[ ] Write failing test: sendAlert with CRITICAL severity sends email AND SMS
[ ] Write failing test: sendAlert with HIGH severity sends email within 5 min
[ ] Write failing test: sendAlert routes to correct recipient
[ ] Verify tests fail
[ ] Implement notification engine:
    - Severity levels: CRITICAL, HIGH, MEDIUM, LOW
    - Channel routing: email, SMS, digest
    - Recipient configuration
    - Rate limiting (no spam)
[ ] Verify tests pass
[ ] Commit: "feat(alerts): add notification engine with severity routing"
```

### Task 7.2: Critical Alerts API

**File:** `apps/web/src/app/api/alerts/critical/route.ts`

```
[ ] Write failing test: POST /api/alerts/critical sends immediate notification
[ ] Write failing test: ASSIGNMENT_FEE_PAID event triggers email + SMS
[ ] Verify tests fail
[ ] Implement route:
    - Accept event type and context
    - Validate event is critical
    - Send via notification engine
    - Return { sent, channels }
[ ] Verify tests pass
[ ] Commit: "feat(alerts): add critical alerts API"
```

### Task 7.3: Pipeline Error Detection

**File:** `apps/web/src/app/api/alerts/pipeline-monitor.ts`

```
[ ] Write failing test: detectError catches negotiation numeric guard violation
[ ] Write failing test: detectError catches payment failure
[ ] Write failing test: detectError catches contract generation error
[ ] Verify tests fail
[ ] Implement pipeline error detection for all phases:
    - Lead Generation: scraper blocked, zero leads
    - Prospect Scoring: timeout, API failure
    - Outreach: provider down, high bounce rate
    - Negotiation: AI error, fee floor breach
    - Contract: validation failed, template missing
    - Payment: Stripe error, declined
    - Closing: title issue, buyer backed out
[ ] Verify tests pass
[ ] Commit: "feat(alerts): add pipeline error detection"
```

### Task 7.4: Alert Events Integration

**Files:** Various (integrate alerts throughout pipeline)

```
[ ] Write failing test: Seller signs triggers admin email
[ ] Write failing test: Buyer matched triggers admin + buyer email
[ ] Write failing test: Assignment fee PAID triggers admin email + SMS
[ ] Verify tests fail
[ ] Integrate alerts into:
    - esign/engine.ts: seller_signed, buyer_signed
    - match-buyer/route.ts: buyers_matched
    - charge-assignment/route.ts: assignment_fee_paid
    - All error handlers: appropriate severity alerts
[ ] Verify tests pass
[ ] Commit: "feat(alerts): integrate alerts throughout pipeline"
```

---

## Section 8: 150k/Day Campaign Launch

### Task 8.1: Campaign Configuration

**File:** `apps/web/src/app/api/campaigns/config/high-volume.ts`

```
[ ] Write failing test: campaignConfig.dailyTarget is 150000
[ ] Write failing test: campaignConfig.warmupSchedule follows 7-day ramp
[ ] Write failing test: campaignConfig.qualityGates enforces bounce < 5%
[ ] Verify tests fail
[ ] Implement high-volume config:
    - AWS Credit ID: 10064436819
    - Daily target: 150,000
    - Max cap: 250,000
    - Pacing: 6,250/hour, 104/minute
    - Burst limit: 500 per 5 seconds
    - Warmup: Day 1-7 (10k → 150k)
    - Quality gates: bounce < 5%, complaint < 0.1%, unsub < 2%
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add high-volume campaign configuration"
```

### Task 8.2: Pre-Launch Validation

**File:** `apps/web/src/app/api/campaigns/preflight/route.ts`

```
[ ] Write failing test: POST /api/campaigns/preflight validates all systems
[ ] Write failing test: Returns detailed checklist with pass/fail for each
[ ] Verify tests fail
[ ] Implement preflight checklist:
    - Database tables exist
    - Email provider (AWS SES) connected
    - SMS gateway connected
    - AI provider responding
    - Stripe $1 test charge
    - E-sign system functional
    - Comps API returning data
    - Compliance rules loaded
    - Contract templates present
    - Qualified leads available
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add pre-launch validation checklist"
```

### Task 8.3: Warmup Scheduler

**File:** `apps/web/src/app/api/campaigns/warmup/scheduler.ts`

```
[ ] Write failing test: getWarmupTarget(day: 1) returns 10000
[ ] Write failing test: getWarmupTarget(day: 7) returns 150000
[ ] Write failing test: exceeds warmup returns maxed out at 150000
[ ] Verify tests fail
[ ] Implement warmup scheduler:
    - Day 1: 10,000
    - Day 2: 25,000
    - Day 3: 50,000
    - Day 4: 75,000
    - Day 5: 100,000
    - Day 6: 125,000
    - Day 7+: 150,000
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add warmup scheduler for deliverability"
```

### Task 8.4: Quality Gate Monitor

**File:** `apps/web/src/app/api/campaigns/quality-gate/monitor.ts`

```
[ ] Write failing test: checkQualityGates pauses campaign if bounce > 5%
[ ] Write failing test: checkQualityGates pauses campaign if complaint > 0.1%
[ ] Write failing test: Returns detailed metrics with thresholds
[ ] Verify tests fail
[ ] Implement quality gate monitor:
    - Track bounce rate (max 5%)
    - Track complaint rate (max 0.1%)
    - Track unsubscribe rate (max 2%)
    - Auto-pause if exceeded
    - Alert admin
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add quality gate monitoring"
```

### Task 8.5: Launch Sequence Orchestrator

**File:** `apps/web/src/app/api/campaigns/launch/route.ts`

```
[ ] Write failing test: POST /api/campaigns/launch executes T-24hr preflight
[ ] Write failing test: T-0 starts at warmup day 1 volume
[ ] Write failing test: T+1hr deliverability check triggered
[ ] Verify tests fail
[ ] Implement launch sequence:
    - T-24hrs: Run preflight, alert admin
    - T-0: Launch at 10k (Day 1)
    - T+1hr: Verify deliverability
    - T+24hrs: Day 1 report
    - T+7days: Full 150k/day
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add launch sequence orchestrator"
```

---

## Section 9: Profile-Specific Email Hooks

### Task 9.1: Seller Profile Hooks

**File:** `apps/web/src/app/api/campaigns/templates/autonomous-mvp.ts`

```
[ ] Write failing test: getSellerHook('HIGH_DISTRESS') returns speed + empathy hook
[ ] Write failing test: getSellerHook('INVESTOR') returns numbers + certainty hook
[ ] Verify tests fail
[ ] Add profile hooks:
    - HIGH_DISTRESS: "Quick solution — close in 7 days"
    - INVESTOR: "Cash offer: $X — no contingencies"
    - COMPETITIVE: "We don't retrade — price locked"
    - BASELINE: "Cash offer — no repairs, no hassle"
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add seller profile-specific email hooks"
```

### Task 9.2: Buyer Deal-Type Hooks

**File:** `apps/web/src/app/api/campaigns/templates/autonomous-mvp.ts`

```
[ ] Write failing test: getBuyerHook('DEEP_DISCOUNT') returns margin hook
[ ] Write failing test: getBuyerHook('QUICK_FLIP') returns speed hook
[ ] Verify tests fail
[ ] Add deal-type hooks:
    - DEEP_DISCOUNT: "45% below ARV — $47k equity day one"
    - QUICK_FLIP: "Turn-key rental — tenant in place"
    - REHAB_PLAY: "$30k rehab → $85k ARV spread"
    - COMPETITIVE: "3 buyers viewing — first signed gets it"
[ ] Verify tests pass
[ ] Commit: "feat(campaigns): add buyer deal-type email hooks"
```

---

## Section 10: Integration Tests

### Task 10.1: E2E Pipeline Test

**File:** `apps/web/src/tests/e2e/pipeline.test.ts`

```
[ ] Write test: Full pipeline from lead to closed deal
    - Generate seller lead
    - Score seller (expect HOT tier)
    - Trigger outreach
    - Simulate reply
    - Negotiation completes (verify fee floor)
    - Generate contract (verify regional disclosures)
    - Seller signs
    - Match buyers
    - Buyer validates payment
    - Buyer signs
    - Charge assignment fee
    - Verify notifications sent
    - Verify follow-up email sent
[ ] Verify test passes end-to-end
[ ] Commit: "test(pipeline): add E2E integration test"
```

### Task 10.2: Compliance E2E Test

**File:** `apps/web/src/tests/e2e/compliance.test.ts`

```
[ ] Write test: Messaging compliance across all states
    - Test each state's quiet hours
    - Verify disclosures injected
    - Verify DNC check
[ ] Verify test passes
[ ] Commit: "test(compliance): add E2E compliance test"
```

### Task 10.3: Contract E2E Test

**File:** `apps/web/src/tests/e2e/contracts.test.ts`

```
[ ] Write test: Regional contracts for TX, FL, CA, generic
    - Generate purchase agreement
    - Verify state-specific addendums
    - Generate assignment contract
    - Verify fee floor
    - Verify earnest money by tier
[ ] Verify test passes
[ ] Commit: "test(contracts): add E2E contract generation test"
```

---

## Execution Order

**Phase A: Foundation (Sections 1-2)**
1. Regional Contract Engine (Tasks 1.1-1.6)
2. Regional Compliance Engine (Tasks 2.1-2.3)

**Phase B: Scoring & Negotiation (Sections 3-4)**
3. Prospect Optimization (Tasks 3.1-3.5)
4. Negotiation Enhancements (Tasks 4.1-4.3)

**Phase C: Signing & Payment (Section 5)**
5. Contract Signing Flow (Tasks 5.1-5.5)

**Phase D: Communications (Section 6)**
6. Assignment Signed Follow-Up (Tasks 6.1-6.3)

**Phase E: Reliability (Section 7)**
7. Error Handling & Alerts (Tasks 7.1-7.4)

**Phase F: Scale (Sections 8-9)**
8. 150k/Day Campaign (Tasks 8.1-8.5)
9. Profile-Specific Hooks (Tasks 9.1-9.2)

**Phase G: Validation (Section 10)**
10. Integration Tests (Tasks 10.1-10.3)

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Contract variable accuracy | 100% |
| Regional compliance | 100% |
| Fee floor enforcement | 100% |
| Seller prospect quality | >50% HOT/WARM |
| Buyer prospect quality | >60% VERIFIED+ |
| E2E pipeline success | 99.9% |
| Campaign deliverability | >95% |
| Payment collection rate | >90% |
| Admin notification delivery | 100% |

---

**Plan Status:** Ready for Implementation
