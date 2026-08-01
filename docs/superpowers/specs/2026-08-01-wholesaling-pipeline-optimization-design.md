# Wholesaling Pipeline Optimization Design

**Date:** 2026-08-01  
**Status:** Draft  
**Author:** Claude + Roman Shumate

---

## 1. Overview

Comprehensive optimization of the DealFlow AI wholesaling pipeline covering:

1. **Regional Contract Engine** - State-specific Purchase & Assignment contracts
2. **Regional Compliance Engine** - Messaging rules by state/market
3. **Prospect Optimization** - Scoring engines for buyers & sellers
4. **Negotiation Engine Enhancements** - Inspection period negotiation, fee floor enforcement
5. **Contract Signing Flow** - E-sign with payment collection before buyer signature
6. **Error Handling & Alerts** - Critical error notifications via email
7. **150k/day Campaign Launch** - Autonomous email campaign at scale

---

## 2. Contract Templates & Regional Engine

### 2.1 Purchase and Sale Agreement (Cameron Oliveira Style)

```
REAL ESTATE PURCHASE AND SALE AGREEMENT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PARTIES

SELLER: {{seller_name}}
        {{seller_address}}
        {{seller_phone}}
        {{seller_email}}

BUYER:  DealSwift Automation LLC and/or Assigns
        {{buyer_address}}
        {{buyer_phone}}
        {{buyer_email}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2. PROPERTY

Address: {{property_address}}
City: {{property_city}}, State: {{property_state}}, ZIP: {{property_zip}}
Zillow Property ID: {{zillow_property_id}}
County Parcel/APN: {{parcel_id}}
Legal Description: {{legal_description}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3. PURCHASE PRICE AND TERMS

Purchase Price: ${{purchase_price}}
Earnest Money Deposit: ${{earnest_money}} (due within 3 business days of execution)
Balance Due at Closing: ${{balance_due}}

Payment Method: Cash / Certified Funds / Wire Transfer

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4. CLOSING

Closing Date: {{closing_date}} (or sooner by mutual agreement)
Closing Location: Title company of Buyer's choice
Title Insurance: Seller shall provide marketable title

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

5. INSPECTION PERIOD

Buyer shall have {{inspection_days}} days from the Effective Date to inspect 
the Property and approve all matters relating to the Property in Buyer's 
sole discretion. Buyer may terminate this Agreement for any reason during 
the Inspection Period by providing written notice to Seller, in which case 
Earnest Money shall be refunded to Buyer.

Minimum inspection period: 7 days
Default if not negotiated: 14-21 days

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6. ATTORNEY MODIFICATION PERIOD

Either party may have this Agreement reviewed by an attorney within 
{{attorney_mod_days}} days of the Effective Date. If either party's attorney 
disapproves of this Agreement, that party may terminate by written notice.

Default: 5 days

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

7. AS-IS CONDITION

Buyer is purchasing the Property in its present "AS-IS" condition with all 
faults. Seller makes no warranties regarding the condition of the Property. 
Buyer has conducted or waived inspection and accepts the Property accordingly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

8. WHOLESALING DISCLOSURE

NOTICE: Buyer is a real estate investor, not a licensed real estate agent 
or broker. Buyer intends to assign this Agreement to a third party prior 
to closing and may profit from such assignment. Seller acknowledges and 
consents to the assignment of this Agreement.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

9. ASSIGNMENT

This Agreement may be freely assigned by Buyer to any third party without 
Seller's consent. Upon assignment, the original Buyer shall be released 
from all obligations hereunder.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

10. DEFAULT

If Buyer defaults, Seller's sole remedy shall be retention of Earnest Money 
as liquidated damages. If Seller defaults, Buyer may seek specific 
performance or return of Earnest Money plus actual damages.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

11. ADDITIONAL TERMS

{{additional_terms}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

12. REGIONAL DISCLOSURES

{{regional_disclosures}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

13. SIGNATURES

This Agreement is effective as of the date last signed below ("Effective Date").

SELLER:
Signature: _________________________  Date: {{seller_sign_date}}
Printed Name: {{seller_name}}

BUYER:
Signature: _________________________  Date: {{buyer_sign_date}}
Printed Name: DealSwift Automation LLC
By: Authorized Representative
```

### 2.2 Assignment of Contract

```
ASSIGNMENT OF REAL ESTATE PURCHASE CONTRACT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PARTIES

ASSIGNOR: DealSwift Automation LLC
          {{assignor_address}}
          {{assignor_phone}}
          {{assignor_email}}

ASSIGNEE: {{assignee_name}}
          {{assignee_entity}} (if applicable)
          {{assignee_address}}
          {{assignee_phone}}
          {{assignee_email}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2. ORIGINAL CONTRACT

This Assignment relates to the Real Estate Purchase and Sale Agreement 
("Original Contract") dated {{original_contract_date}} between:

Original Seller: {{seller_name}}
Original Buyer: DealSwift Automation LLC

Property Address: {{property_address}}
Zillow Property ID: {{zillow_property_id}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3. ASSIGNMENT

For good and valuable consideration, Assignor hereby assigns, transfers, 
and conveys all of Assignor's right, title, and interest in and to the 
Original Contract to Assignee.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4. ASSIGNMENT FEE

Assignment Fee: ${{assignment_fee}}
(Minimum: $5,000 - NON-NEGOTIABLE FLOOR)

Payment Due: Upon execution of this Assignment
Payment Method: {{payment_method}} (Wire / Card / ACH)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

5. TOTAL DUE AT CLOSING

Original Purchase Price: ${{purchase_price}}
Assignment Fee: ${{assignment_fee}}
TOTAL DUE AT CLOSING: ${{total_due_at_closing}}

All funds due to Seller at closing: ${{purchase_price}}
Assignment fee paid to Assignor: ${{assignment_fee}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6. EARNEST MONEY

Earnest Money Deposit Required: ${{earnest_money}}
(Range: $100-$5,000 based on buyer qualification tier)

Earnest Money is non-refundable after Assignee's inspection period 
expires or is waived.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

7. ASSIGNEE ACKNOWLEDGMENTS

Assignee acknowledges and agrees:

a) Assignee has received and reviewed the Original Contract;
b) Assignee assumes all obligations of Buyer under the Original Contract;
c) Assignee has inspected or waived the right to inspect the Property;
d) Assignee has verified their ability to close by the Closing Date;
e) Assignee understands this is an ASSIGNMENT, not a new contract;
f) Assignee has received the Wholesaling Disclosure.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

8. WHOLESALING DISCLOSURE

NOTICE: Assignor is a real estate investor engaging in the practice of 
"wholesaling." Assignor secured the Original Contract with Seller and is 
now assigning that contract to Assignee for a fee. Assignor will profit 
${{assignment_fee}} from this transaction. Assignee is under no obligation 
to proceed and should conduct independent due diligence.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

9. CLOSING INSTRUCTIONS

Closing Date: {{closing_date}}
Title Company: {{title_company}}
Title Company Contact: {{title_contact}}

Assignee shall wire funds to Title Company per separate wire instructions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

10. SIGNATURES

ASSIGNOR:
Signature: _________________________  Date: {{assignor_sign_date}}
DealSwift Automation LLC
By: Authorized Representative

ASSIGNEE:
Signature: _________________________  Date: {{assignee_sign_date}}
Printed Name: {{assignee_name}}
Entity (if applicable): {{assignee_entity}}
```

### 2.3 Regional Contract Engine

**State-Specific Addendums:**

| State | Required Addendums |
|-------|-------------------|
| Texas | TREC-style addendum, specific earnest money language, property condition |
| Florida | As-Is Rider, Radon Gas Disclosure, Property Tax Disclosure |
| California | Transfer Disclosure Statement, Natural Hazard Disclosure, Megan's Law |
| Ohio | Residential Property Disclosure Form, Lead-Based Paint Disclosure |
| Georgia | Brokerage Relationships Disclosure, Property Condition Disclosure |
| New York | Property Condition Disclosure (or $500 credit), Lead Paint |
| Illinois | Radon Disclosure, Lead Paint, Residential Real Property Disclosure |
| Pennsylvania | Seller's Property Disclosure Statement, Lead Paint |
| Generic | Base template for all other states + Lead Paint (pre-1978) |

**Implementation:**

```typescript
interface RegionalContractEngine {
  detectState(propertyAddress: string): string;
  loadTemplate(state: string, contractType: 'purchase' | 'assignment'): ContractTemplate;
  getRequiredDisclosures(state: string): Disclosure[];
  validateStateRequirements(contract: Contract, state: string): ValidationResult;
  generateContract(deal: Deal, contractType: string): GeneratedContract;
}
```

---

## 3. Regional Compliance Engine for Messaging

### 3.1 Architecture

```
Input: recipient_address, recipient_phone, message_type, content
                    ↓
1. DETECT REGION (state from address + timezone from phone area code)
                    ↓
2. LOAD REGIONAL RULES
   - Quiet hours
   - Required disclosures
   - Opt-out language
   - Frequency limits
                    ↓
3. VALIDATE & INJECT COMPLIANCE
   - Block if outside allowed hours
   - Append required disclosures
   - Check DNC registry
                    ↓
Output: approved_message OR blocked_reason
```

### 3.2 State-Specific Messaging Rules

| State | Quiet Hours | Special Rules |
|-------|-------------|---------------|
| Federal (TCPA) | 8am-9pm recipient local | Prior express consent required |
| California | 8am-9pm PT | CCPA opt-out, "Do Not Sell" language |
| Florida | 8am-8pm ET | Stricter 8pm cutoff, written consent |
| Texas | 8am-9pm CT | Real estate exemptions apply |
| New York | 8am-9pm ET | Telemarketer registration required |
| Washington | 8am-8pm PT | 8pm cutoff, enhanced penalties |
| Georgia | 8am-9pm ET | Standard TCPA |
| Ohio | 8am-9pm ET | Standard TCPA |
| Pennsylvania | 8am-9pm ET | Enhanced DNC enforcement |

### 3.3 Required Disclosures by Channel

**Email (all states):**
- CAN-SPAM compliant unsubscribe link
- Physical business address
- Clear sender identification

**SMS (all states):**
- "Reply STOP to unsubscribe"
- Business name identification
- Message frequency disclosure (first message)

**Real Estate Specific:**
- "We are real estate investors, not agents"
- "This is a solicitation to purchase your property"

---

## 4. Prospect Optimization

### 4.1 Seller Prospect Scoring (0-100 points)

| Signal | Points | Source |
|--------|--------|--------|
| Pre-foreclosure/NOD | +30 | County recorder scraper |
| Tax delinquent (2+ years) | +25 | Treasurer scraper |
| Probate/Inherited | +20 | Probate court scraper |
| Code violations | +15 | Code enforcement scraper |
| Absentee owner | +15 | Assessor (mailing ≠ property) |
| High equity (>50%) | +10 | Assessor value vs mortgage |
| Vacant property | +10 | USPS vacancy indicator |
| Long ownership (10+ yrs) | +5 | Deed records |
| Tired landlord signals | +10 | Multiple properties, evictions |
| Recent divorce filing | +10 | Court records |

**Seller Tiers:**

| Tier | Score | Action |
|------|-------|--------|
| HOT | 70+ | Immediate outreach, priority follow-up |
| WARM | 50-69 | Standard campaign cadence |
| COOL | 30-49 | Low-priority drip only |
| COLD | <30 | Do not contact |

### 4.2 Buyer Prospect Scoring (0-100 points)

| Signal | Points | Source |
|--------|--------|--------|
| Cash purchases (no mortgage) | +30 | Deed records |
| Multiple purchases in 12mo | +25 | Recorder (repeat buyer) |
| LLC/Entity buyer | +15 | Secretary of State + deed |
| Verified proof of funds | +20 | Manual verification |
| Previous closed deal with us | +20 | Internal CRM |
| Zip code match | +10 | Buying criteria |
| Price range match | +10 | Buying criteria |
| Property type match | +5 | Buying criteria |
| Response time <1hr on last deal | +5 | Internal metrics |

**Buyer Tiers:**

| Tier | Score | Priority | Earnest Money |
|------|-------|----------|---------------|
| VIP | 80+ | First look, 2hr exclusive | $100-$500 |
| VERIFIED | 60-79 | Standard deal blasts | $500-$1,500 |
| PROSPECT | 40-59 | Deals after 24hr if unsold | $1,500-$3,000 |
| UNVERIFIED | <40 | Require POF first | $3,000-$5,000 |

### 4.3 Comps-Based Pricing

```
1. Property identified
2. Fetch comps (PropStream/ATTOM/Zillow/internal)
   - Within 0.5 mile radius
   - Sold within 180 days (same year priority)
   - ±20% square footage
   - ±1 bedroom, ±1 bathroom
3. Calculate ARV (median of similar sold homes)
4. Apply 70% rule: MAO = (ARV × 0.70) - Repairs
5. Set negotiation bounds:
   - seller_opener = MAO × 0.85
   - seller_max = MAO
   - buyer_floor = contract_price + $5,000
   - buyer_opener = contract_price + $15,000
```

---

## 5. Negotiation Engine Enhancements

### 5.1 New Negotiable Variables

| Variable | Range | Default | Rule |
|----------|-------|---------|------|
| inspection_days | 7-21 | 14 | Seller can request shorter; never below 7 |
| attorney_mod_days | 3-10 | 5 | Standard 5, negotiable |
| closing_days | 7-45 | 21 | Faster = attractive to distressed |
| earnest_money | $500-$5,000 | $1,000 | Higher = more serious signal |

### 5.2 Fee Floor Enforcement

```
Seller Side:
  - Opens LOW, concedes UP toward ceiling
  - Never exceeds seller_max_approved

Buyer Side:
  - Opens HIGH, concedes DOWN toward floor
  - Floor = contract_price + $5,000 (HARD MINIMUM)
  - System WALKS AWAY before going below $5k fee
```

### 5.3 Activation Email Hooks

**Seller Hooks by Profile:**

| Profile | Hook Strategy | Example Subject |
|---------|---------------|-----------------|
| HIGH_DISTRESS | Speed + empathy | "Quick solution — close in 7 days" |
| INVESTOR | Numbers + certainty | "Cash offer: $82,000 — no contingencies" |
| COMPETITIVE | Reliability | "We don't retrade — price locked" |
| BASELINE | Simplicity | "Cash offer — no repairs, no hassle" |

**Buyer Hooks by Deal Type:**

| Deal Type | Hook | Example Subject |
|-----------|------|-----------------|
| Deep Discount | Margin | "45% below ARV — $47k equity day one" |
| Quick Flip | Speed | "Turn-key rental — tenant in place" |
| Rehab Play | Upside | "$30k rehab → $85k ARV spread" |
| Competitive | Urgency | "3 buyers viewing — first signed gets it" |

---

## 6. Contract Signing Flow & Payment Collection

### 6.1 Seller Flow (Purchase Agreement)

```
1. Negotiation complete (price agreed)
2. Validate contract variables against negotiation
3. Generate contract (regional template)
4. Send e-sign request
5. Seller signs (capture IP, timestamp, user-agent)
6. Trigger buyer matching
7. Notify admin: "[SIGNED] Seller contract"
```

### 6.2 Buyer Flow (Assignment Agreement)

```
1. Buyer clicks "Reserve Deal"
2. Validate buyer qualification (score ≥ 40)
3. Present deal summary (3rd-grader readable)
4. Collect payment method BEFORE signing
   - Wire transfer info
   - OR Credit/Debit card (Stripe)
   - OR ACH bank account
5. Validate payment method ($1 auth)
6. Generate assignment contract
7. Buyer signs
8. Charge assignment fee
9. Confirm payment
10. NOTIFY ADMIN: "💰 Assignment Fee PAID"
```

### 6.3 Deal Summary Format (3rd-Grader Readable)

```
🏠 DEAL SUMMARY

Property: 123 Main St, Houston TX
You Pay at Closing: $87,000
  ├─ Goes to Seller: $82,000
  └─ Assignment Fee: $5,000

What You Get:
  ✓ Property worth ~$120,000 (ARV)
  ✓ Potential profit: $33,000
  ✓ Close in 14 days

[Continue to Payment Setup →]
```

### 6.4 Payment Methods

| Method | Timeline | Fee |
|--------|----------|-----|
| Credit/Debit (Stripe) | Immediate | 2.9% + $0.30 |
| ACH (Stripe/Plaid) | 3-5 days | 0.8% capped $5 |
| Wire Transfer | 24-48 hours | $0 |

### 6.5 Earnest Money by Buyer Tier

| Buyer Tier | Score | Earnest Money |
|------------|-------|---------------|
| VIP | 80+ | $100-$500 |
| VERIFIED | 60-79 | $500-$1,500 |
| PROSPECT | 40-59 | $1,500-$3,000 |
| UNVERIFIED | <40 | $3,000-$5,000 |

---

## 7. Error Handling & System Alerts

### 7.1 Error Severity Levels

| Severity | Response | Examples |
|----------|----------|----------|
| CRITICAL | Immediate email + SMS | Payment failed, contract error, e-sign down |
| HIGH | Email within 5 min | Negotiation error, compliance block |
| MEDIUM | Daily digest | API timeout, email bounce |
| LOW | Weekly report | Minor warnings, retry successes |

### 7.2 Pipeline Phase Error Detection

**Phase 1: Lead Generation**
- Scraper blocked
- Zero leads returned
- Data quality < 80%

**Phase 2: Prospect Scoring**
- Scoring timeout
- Comps API failure
- Zero qualified leads

**Phase 3: Outreach**
- Email/SMS provider down
- Compliance block rate > 20%
- Bounce rate > 10%

**Phase 4: Negotiation**
- AI provider error
- Numeric guard violation
- Fee floor breach attempt

**Phase 5: Contract**
- Variable validation failed
- Template missing for state
- E-sign generation error

**Phase 6: Payment**
- Stripe API error
- Payment declined
- Wire not received

**Phase 7: Closing**
- Title issue
- Buyer backed out
- Closing delayed

### 7.3 Notification Events

| Event | Recipient | Channel |
|-------|-----------|---------|
| Seller signs | Admin | Email |
| Buyer matched | Admin + Buyer | Email |
| Buyer adds payment | Admin | Email |
| Buyer signs | Admin | Email |
| **Assignment fee PAID** | **Admin** | **Email + SMS** |
| Payment failed | Admin + Buyer | Email |
| Deal closed | All parties | Email |

---

## 8. 150k/Day Campaign Launch

### 8.1 Pre-Launch Checklist

| Check | Verification |
|-------|--------------|
| Database | All tables exist |
| Email Provider | Test email works |
| SMS Gateway | Test SMS works |
| AI Provider | Test response |
| Stripe | $1 test charge |
| E-Sign | Test contract |
| Comps | Data returning |
| Compliance | All states loaded |
| Contracts | All templates present |
| Leads | Qualified leads available |

### 8.2 Campaign Configuration

```
Daily Target: 150,000 emails
Pacing: 6,250/hour, 104/minute
Burst Limit: 500 per 5 seconds

Warmup Schedule:
  Day 1: 10,000
  Day 2: 25,000
  Day 3: 50,000
  Day 4: 75,000
  Day 5: 100,000
  Day 6: 125,000
  Day 7: 150,000 (full volume)

Quality Gates (pause if exceeded):
  Max bounce rate: 5%
  Max complaint rate: 0.1%
  Max unsubscribe rate: 2%

Provider: AWS SES
Cost: ~$450/month for 4.5M emails
```

### 8.3 Launch Sequence

```
T-24hrs: Pre-flight checks
T-0: Launch at 10k (Day 1)
T+1hr: Verify deliverability
T+24hrs: Day 1 report
T+7days: Full 150k/day volume
```

---

## 9. Implementation Files

### New Files to Create:

```
apps/web/src/app/api/contracts/
├── templates/
│   ├── purchase-agreement.ts
│   ├── assignment-contract.ts
│   └── regional/
│       ├── texas.ts
│       ├── florida.ts
│       ├── california.ts
│       └── generic.ts
├── generate/route.ts
├── validate/route.ts
└── engine.ts

apps/web/src/app/api/compliance/
├── regional-messaging/
│   ├── engine.ts
│   ├── rules/
│   │   ├── federal.ts
│   │   ├── california.ts
│   │   ├── florida.ts
│   │   └── [state].ts
│   └── route.ts
└── messaging-gate.ts

apps/web/src/app/api/prospects/
├── seller-scoring/route.ts
├── buyer-scoring/route.ts
└── scoring-engine.ts

apps/web/src/app/api/alerts/
├── critical/route.ts
├── digest/route.ts
└── notification-engine.ts
```

### Files to Modify:

```
apps/web/src/app/api/utils/negotiationEngine.ts
  - Add inspection_days, attorney_mod_days negotiation
  - Harden fee floor enforcement

apps/web/src/app/api/deals/match-buyer/route.ts
  - Add buyer tier scoring
  - Add earnest money calculation

apps/web/src/app/api/campaigns/templates/autonomous-mvp.ts
  - Add profile-specific hooks
  - Add deal-type buyer hooks

apps/web/src/app/api/esign/self-hosted/engine.ts
  - Add contract variable validation
  - Add regional disclosure injection

apps/web/src/app/api/payments/stripe/route.ts
  - Add earnest money collection flow
  - Add wire transfer option
```

---

## 10. Success Criteria

| Metric | Target |
|--------|--------|
| Contract variable accuracy | 100% (no mismatches) |
| Regional compliance | 100% (correct disclosures) |
| Fee floor enforcement | 100% (never below $5k) |
| Seller prospect quality | >50% HOT/WARM tier |
| Buyer prospect quality | >60% VERIFIED+ tier |
| E2E pipeline success | 99.9% (no ghost errors) |
| Campaign deliverability | >95% inbox placement |
| Payment collection rate | >90% of signed assignments |
| Admin notification delivery | 100% for critical events |

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| State law changes | Quarterly compliance review |
| Email deliverability issues | Warmup schedule, dedicated IPs |
| Payment fraud | Pre-authorization, verification |
| Contract disputes | Attorney-reviewed templates, audit trails |
| AI hallucination in negotiation | Numeric guards, fee floor enforcement |

---

**Document Status:** Ready for Review
