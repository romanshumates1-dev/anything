# DealFlow Conversion Optimization - Quick Start

**Goal:** Maximize deals closed per lead (not lead volume)

---

## What You Have Now (Ready to Use)

### 1. **Daily Execution Queue** ✅ LIVE
**Endpoint:** `GET /api/optimization/daily-queue`

**What it does:**
- Surfaces your top 20 highest expected-value deals
- Sorted by EV (best opportunities first)
- Includes urgency scoring (high/medium/normal)
- Shows recommended offer ranges
- Tracks how long each deal has been waiting

**How to use it:**
```bash
curl http://localhost:4000/api/optimization/daily-queue \
  -H "Cookie: <your-session-cookie>"
```

**Response structure:**
```json
{
  "deals": [
    {
      "leadId": 123,
      "name": "John Smith",
      "phone": "+1555...",
      "address": "123 Main St",
      "distressSignals": ["pre_foreclosure", "vacant"],
      "arvDollars": 250000,
      "offerMaxDollars": 160000,
      "pClose": 0.68,
      "expectedValueDollars": 6800,
      "urgencyLevel": "high",
      "hoursWaiting": 4.2
    }
  ],
  "summary": {
    "totalExpectedValue": 87500,
    "averagePClose": 0.54,
    "highUrgencyCount": 7
  },
  "actionGuidance": {
    "immediateAction": [
      {
        "leadId": 123,
        "name": "John Smith",
        "action": "Call +1555... - offer $160,000",
        "reasoning": "High probability (68%) with strong valuation"
      }
    ],
    "thisWeekTarget": 10,
    "estimatedWeeklyDeals": 5
  }
}
```

---

## Your Daily Workflow (Start Here)

### Morning Routine (15-20 minutes)

1. **Pull the daily queue:**
   ```bash
   curl http://localhost:4000/api/optimization/daily-queue > today.json
   ```

2. **Focus on top 5 immediate actions:**
   - Look at `actionGuidance.immediateAction`
   - These are your highest-conviction opportunities
   - Expected to produce 2-3 deals this week

3. **For each high-urgency deal:**
   - Call the phone number
   - Present the offer range shown (`offerMaxDollars`)
   - Reference their specific situation (distress signals)

4. **Track outcomes** (we'll automate this later):
   - Responded? → Log it
   - Accepted offer? → Mark for contract
   - Countered? → Note the counter for negotiation agent

---

## Offer Presentation Framework

When calling leads, use this structure:

### For Pre-Foreclosure/Tax Delinquent (High Urgency):
```
"Hi [Name], I'm calling about [Address]. I see you have a foreclosure/tax 
sale coming up. We can close in 7 days at [OfferMax] and handle everything. 
Based on the repairs needed and current market, this gets you out clean with 
cash in hand. Can you work with that timeline?"
```

### For Probate/Absentee (Medium Urgency):
```
"Hi [Name], I'm interested in [Address]. We buy houses as-is - no repairs, 
no showings, no hassle. Based on comparable sales and the work it needs, 
I can offer [OfferMax]. We close on your timeline. Would that work for you?"
```

### For Lower Distress (Normal):
```
"Hi [Name], I'm looking at [Address]. We specialize in quick closings for 
properties that need work. I can offer [OfferMin-OfferMax] depending on 
inspection. Can you tell me more about the property's condition?"
```

**Key principles:**
- Lead with THEIR timeline/situation (not yours)
- Show you understand their specific problem
- Present the offer range, not just one number
- Emphasize speed and no-hassle (your competitive advantage)

---

## Conversion Tracking (Manual for Now)

Create a simple spreadsheet or note when you contact leads:

| Lead ID | Name | Contact Date | Offer Made | Response | Next Step | Outcome |
|---------|------|--------------|------------|----------|-----------|---------|
| 123 | John Smith | 2026-07-31 | $160k | Interested | Send contract | Pending |
| 124 | Jane Doe | 2026-07-31 | $85k | Countered $95k | Negotiate | Active |
| 125 | Bob Johnson | 2026-07-31 | $200k | No answer | Follow-up 8/2 | Waiting |

**Why track this?**
- You'll see which distress signals convert best
- You'll see if your offer ranges are accurate
- We'll use this data to improve the probability model

---

## Week 1 Goals

**Objective:** Process top 20 deals, aim for 3-5 contracts

1. **Monday:** Pull daily queue, contact top 10
2. **Tuesday:** Follow up with Monday's no-answers, contact next 5
3. **Wednesday:** Follow up again, process any active negotiations
4. **Thursday:** Send contracts to any accepted offers
5. **Friday:** Review week's conversion rates, adjust for next week

**Expected outcomes:**
- 10-15 contacts made
- 5-8 conversations (response rate ~50%)
- 2-4 offers accepted (close rate ~35%)
- 1-3 contracts signed (signature rate ~60%)

**This matches your 3-10 deals/week target range.**

---

## Next Steps (After Week 1)

Once you have real conversion data:

### Phase 1: Add Outcome Tracking Table
```sql
CREATE TABLE deal_outcomes (
  lead_id bigint PRIMARY KEY,
  contacted_at timestamptz,
  responded boolean,
  offer_presented integer,
  counter_offer integer,
  outcome text, -- 'contract', 'lost', 'no_response'
  actual_fee integer,
  closed_at timestamptz
);
```

### Phase 2: Build Offer Framing Agent
- Generates personalized offer presentations
- Adapts message to distress type
- Suggests talking points per lead

### Phase 3: Build Negotiation Response Agent
- Handles counter-offers intelligently
- Knows when to walk away vs meet in middle
- Maintains profitability thresholds

### Phase 4: Probability Refinement
- Compare predicted P(close) to actual outcomes
- Adjust scoring weights based on what actually converts
- Improve EV accuracy week over week

---

## Key Metrics to Watch

### Week Over Week:
1. **Response rate:** % of contacts that respond
   - Target: 40-60%
   - If low: You're reaching out too late or wrong leads

2. **Offer acceptance:** % of responses that accept
   - Target: 25-40%
   - If low: Offers too low or presentation needs work

3. **Contract rate:** % of acceptances that sign
   - Target: 60-80%
   - If low: Speed issue or contract friction

4. **Time to response:** Hours from queue to first contact
   - Target: <6 hours for high urgency
   - If high: You're losing time-sensitive deals

---

## Common Conversion Killers (Avoid These)

1. **Waiting too long** - Pre-foreclosures have hard deadlines
2. **Offering too low** - System gives you ranges, use them
3. **Being too salesy** - You're solving their problem, not pitching
4. **Not following up** - 50% of deals need 2-3 touches
5. **Ignoring distress signals** - Address their urgency in your pitch

---

## System Design Reference

Full conversion optimization design: `docs/superpowers/specs/2026-07-31-conversion-optimization.md`

Includes:
- Offer framing agent design
- Negotiation response agent design
- Probability calibration logic
- Follow-up sequence strategy
- Speed-to-response alerts
- Detailed metrics tracking

**Build these as you prove the manual process works.**

---

## Support

The optimization MVP is fully documented:
- Setup: `docs/optimization-mvp-usage.md`
- Architecture: `docs/superpowers/specs/2026-07-31-dealflow-mvp-design.md`
- Implementation: `docs/superpowers/plans/2026-07-31-dealflow-optimization-mvp.md`

All code is at: `apps/web/src/app/api/optimization/`

Dashboard: `http://localhost:4000/optimization/dashboard`

---

## TL;DR - Do This Today

1. Hit the daily queue endpoint
2. Call the top 5 high-urgency leads
3. Present offers using the framework above
4. Track responses in a spreadsheet
5. Repeat tomorrow

**This system surfaces the best opportunities. Your job is to close them.**
