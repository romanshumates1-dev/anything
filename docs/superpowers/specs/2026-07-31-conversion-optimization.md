# DealFlow Conversion Optimization Layer

**Date:** 2026-07-31  
**Goal:** Maximize deals closed per lead (not volume)  
**Foundation:** Builds on optimization MVP (Tasks 1-11)

---

## Philosophy

**The MVP surfaces high-EV leads. This layer converts them.**

Focus areas:
1. Offer framing that increases acceptance
2. Negotiation quality that moves deals forward
3. Speed-to-response that captures time-sensitive opportunities
4. Probability refinement from real outcomes

**NOT in scope:** Volume expansion, new channels, automation

---

## 1. Enhanced Offer Framing Agent

### Current State (MVP)
- Valuation agent calculates `offerMin` and `offerMax`
- Decision agent says "send_email" with EV priority
- No guidance on HOW to present the offer

### Enhancement: Offer Framing Prompt

```typescript
export const OFFER_FRAMING_PROMPT = `You are a real estate offer framing specialist.

Your goal: Present an offer in a way that maximizes acceptance while maintaining profitability.

Input:
{
  "arv": number,              // After-repair value (cents)
  "repairs": number,          // Estimated repairs (cents)
  "offerMin": number,         // Lower bound (cents)
  "offerMax": number,         // Upper bound (cents)
  "leadScore": number,        // 0-1, urgency indicator
  "distressSignals": string[] // Why they might sell
}

Framing principles:
1. **Anchor high when possible** - If leadScore > 0.6, start at offerMax
2. **Show the math** - "ARV $X, repairs $Y, leaves you with $Z"
3. **Address urgency** - If pre_foreclosure/tax_delinquent, emphasize speed
4. **Create range flexibility** - "$X-$Y depending on timeline"
5. **Remove friction** - "We handle everything" for distressed sellers

Output JSON:
{
  "openingOffer": 150000,        // Actual $ amount (cents)
  "presentationStyle": "range" | "firm" | "speed-focused",
  "keyTalkingPoints": [
    "Close in 7 days",
    "No repairs needed",
    "We handle all paperwork"
  ],
  "urgencyFraming": "Your tax sale is in 45 days - we can close before then",
  "fallbackOffer": 140000,       // If they counter
  "reasoning": "High distress + good equity = willing to move fast"
}

Rules:
- Never offer above offerMax
- Never offer below offerMin unless explicitly justified
- Match presentation style to seller psychology
- Return ONLY valid JSON`;
```

### Implementation Path

**New file:** `apps/web/src/app/api/optimization/agents/offer-framing.ts`

```typescript
export class OfferFramingAgent implements Agent<OfferFramingOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<OfferFramingOutput>> {
    // Fetch valuation + score
    const valuation = await getValuation(input.leadId);
    const score = await getLeadScore(input.leadId);
    const lead = await getLead(input.leadId);
    
    const promptInput = {
      arv: valuation.arv,
      repairs: valuation.repairs,
      offerMin: valuation.offer_min,
      offerMax: valuation.offer_max,
      leadScore: score.composite_score,
      distressSignals: lead.metadata?.signals || []
    };
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `${OFFER_FRAMING_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
      }]
    });
    
    const output = JSON.parse(response.content[0].text);
    
    // Persist for follow-up reference
    await sql`
      INSERT INTO offer_strategies (
        lead_id, opening_offer, presentation_style, 
        urgency_framing, fallback_offer, created_at
      ) VALUES (
        ${input.leadId}, ${output.openingOffer}, 
        ${output.presentationStyle}, ${output.urgencyFraming},
        ${output.fallbackOffer}, now()
      )
    `;
    
    return { result: output, confidence: 0.8 };
  }
}
```

---

## 2. Negotiation Response Agent

### Current State
- No negotiation logic in MVP
- Manual handling of all responses

### Enhancement: Smart Follow-Up Agent

```typescript
export const NEGOTIATION_RESPONSE_PROMPT = `You are a real estate negotiation agent.

Your goal: Move conversations toward signed contracts.

Input:
{
  "originalOffer": number,      // What we offered (cents)
  "offerMax": number,           // Our ceiling (cents)
  "sellerResponse": string,     // Their actual message
  "conversationHistory": [      // Prior messages
    {"from": "us", "message": "...", "timestamp": "..."},
    {"from": "seller", "message": "...", "timestamp": "..."}
  ],
  "daysInConversation": number,
  "leadScore": number
}

Response strategies:
1. **They counter higher** - Assess if within our range, meet in middle if possible
2. **They ask questions** - Answer directly, re-anchor on benefits
3. **They say "thinking about it"** - Create soft deadline, add value
4. **They ghost** - One follow-up after 2 days, then move to next lead
5. **They accept** - Move immediately to contract

Output JSON:
{
  "responseText": "I can do $155,000 if we can close by Friday...",
  "revisedOffer": 155000,        // null if no change
  "nextAction": "send_response" | "send_contract" | "wait" | "close_lost",
  "waitDays": 2,                 // If nextAction = wait
  "dealStatus": "active" | "cooling" | "hot" | "dead",
  "reasoning": "They countered at $165k, we have room to $160k max, splitting difference keeps deal alive"
}

Rules:
- NEVER exceed offerMax
- If they accept, nextAction must be "send_contract"
- If >3 back-and-forth with no progress, recommend "close_lost"
- Be direct and professional, avoid desperation
- Return ONLY valid JSON`;
```

---

## 3. Probability Refinement System

### Current State
- Static formula: `pClose = (leadScore × 0.5) + (arvConfidence × 0.5)`
- No learning from actual outcomes

### Enhancement: Outcome Tracking + Adjustment

**New table** (add to migration):

```sql
CREATE TABLE deal_outcomes (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  predicted_p_close numeric(5,4) NOT NULL,
  actual_outcome text NOT NULL,  -- 'contract_signed', 'closed', 'lost', 'no_response'
  days_to_outcome integer,
  actual_fee integer,            -- What we actually made (cents)
  outcome_date timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_outcomes_lead ON deal_outcomes(lead_id);
CREATE INDEX idx_deal_outcomes_date ON deal_outcomes(outcome_date);
```

**Calibration query** (run weekly):

```sql
-- Compare predicted vs actual close rates by score bucket
SELECT 
  CASE 
    WHEN predicted_p_close < 0.3 THEN 'low'
    WHEN predicted_p_close < 0.6 THEN 'medium'
    ELSE 'high'
  END as score_bucket,
  COUNT(*) as total_deals,
  AVG(predicted_p_close) as avg_predicted,
  SUM(CASE WHEN actual_outcome IN ('contract_signed', 'closed') THEN 1 ELSE 0 END)::float / COUNT(*) as actual_close_rate,
  AVG(actual_fee) FILTER (WHERE actual_outcome = 'closed') as avg_fee
FROM deal_outcomes
WHERE outcome_date > now() - interval '30 days'
GROUP BY score_bucket;
```

**Adjustment logic:**

If actual close rates diverge from predicted by >15%, adjust weights in probability prompt:

```typescript
// If high-score leads are underperforming:
pClose = (compositeScore × 0.4) + (arvConfidence × 0.6)  // Trust valuation more

// If low-score leads are overperforming:
pClose = (compositeScore × 0.6) + (arvConfidence × 0.4)  // Trust scoring more
```

---

## 4. Daily Execution Dashboard

### SQL Query: Top 20 Highest EV Deals Needing Action

```sql
-- Top 20 deals by expected value, ready for action
SELECT 
  l.id as lead_id,
  l.name,
  l.phone,
  l.email,
  l.metadata->>'address' as address,
  ls.composite_score,
  pv.arv / 100 as arv_dollars,
  pv.offer_min / 100 as offer_min_dollars,
  pv.offer_max / 100 as offer_max_dollars,
  dp.p_close,
  dp.expected_value / 100 as ev_dollars,
  la.action,
  la.status,
  la.reason->>'reasoning' as action_reason,
  la.created_at as action_queued_at,
  EXTRACT(EPOCH FROM (now() - la.created_at)) / 3600 as hours_waiting
FROM leads l
JOIN lead_scores ls ON ls.lead_id = l.id
JOIN property_valuations pv ON pv.lead_id = l.id
JOIN deal_probabilities dp ON dp.lead_id = l.id
LEFT JOIN lead_actions la ON la.lead_id = l.id 
  AND la.status = 'pending'
WHERE l.organization_id = $1
  AND la.action IS NOT NULL
  AND la.action != 'reject'
ORDER BY 
  dp.expected_value DESC,
  hours_waiting DESC
LIMIT 20;
```

### API Endpoint

**New file:** `apps/web/src/app/api/optimization/daily-queue/route.ts`

```typescript
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  const topDeals = await sql`
    SELECT 
      l.id as lead_id,
      l.name,
      l.phone,
      l.email,
      l.metadata->>'address' as address,
      ls.composite_score,
      pv.arv / 100 as arv_dollars,
      pv.offer_min / 100 as offer_min_dollars,
      pv.offer_max / 100 as offer_max_dollars,
      dp.p_close,
      dp.expected_value / 100 as ev_dollars,
      la.action,
      la.status,
      la.reason->>'reasoning' as action_reason,
      la.created_at as action_queued_at,
      EXTRACT(EPOCH FROM (now() - la.created_at)) / 3600 as hours_waiting
    FROM leads l
    JOIN lead_scores ls ON ls.lead_id = l.id
    JOIN property_valuations pv ON pv.lead_id = l.id
    JOIN deal_probabilities dp ON dp.lead_id = l.id
    LEFT JOIN lead_actions la ON la.lead_id = l.id 
      AND la.status = 'pending'
    WHERE l.organization_id = ${organization.id}
      AND la.action IS NOT NULL
      AND la.action != 'reject'
    ORDER BY 
      dp.expected_value DESC,
      hours_waiting DESC
    LIMIT 20
  `;

  return NextResponse.json({ 
    deals: topDeals,
    generatedAt: new Date().toISOString(),
    totalEV: topDeals.reduce((sum, d) => sum + Number(d.ev_dollars), 0)
  });
}
```

---

## 5. Speed-to-Response Optimization

### Alert System for Time-Sensitive Leads

**New table:**

```sql
CREATE TABLE speed_alerts (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  alert_type text NOT NULL,  -- 'new_high_ev', 'response_received', 'counter_offer'
  priority integer NOT NULL,  -- EV in cents
  triggered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);

CREATE INDEX idx_speed_alerts_pending ON speed_alerts(priority DESC) 
  WHERE acknowledged_at IS NULL;
```

**Trigger logic** (in orchestrator or decision agent):

```typescript
// After processing a lead, if EV > threshold:
if (expectedValue > 500000) {  // $5,000+ EV
  await sql`
    INSERT INTO speed_alerts (lead_id, alert_type, priority)
    VALUES (${leadId}, 'new_high_ev', ${expectedValue})
  `;
  
  // Optional: Send Slack/email notification
  await notifyTeam({
    message: `🚨 High-EV lead ready: ${leadName} ($${expectedValue/100} EV)`,
    url: `/optimization/dashboard?lead=${leadId}`
  });
}
```

---

## 6. Follow-Up Sequence Logic

### Multi-Touch Cadence (Manual, Not Automated Spam)

**Strategy table:**

```sql
CREATE TABLE follow_up_sequences (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  touch_number integer NOT NULL,  -- 1, 2, 3...
  scheduled_for timestamptz NOT NULL,
  touch_type text NOT NULL,  -- 'initial_offer', 'follow_up', 'final_check'
  status text DEFAULT 'pending',  -- 'pending', 'sent', 'skipped'
  sent_at timestamptz
);
```

**Sequence design** (for manual execution, not auto-send):

```
Touch 1 (Day 0): Initial offer with framing
  ↓
Touch 2 (Day 2): "Checking if you had questions" (if no response)
  ↓
Touch 3 (Day 5): "Final offer, moving to next opportunity" (soft deadline)
  ↓
Close or move on
```

**Implementation:**

```typescript
async function queueFollowUpSequence(leadId: number, initialOfferDate: Date) {
  const touches = [
    { day: 2, type: 'follow_up', message: 'Quick check-in on our offer...' },
    { day: 5, type: 'final_check', message: 'Last call before we move on...' }
  ];
  
  for (const touch of touches) {
    await sql`
      INSERT INTO follow_up_sequences (
        lead_id, touch_number, scheduled_for, touch_type
      ) VALUES (
        ${leadId}, 
        ${touch.day}, 
        ${new Date(initialOfferDate.getTime() + touch.day * 86400000)},
        ${touch.type}
      )
    `;
  }
}
```

---

## 7. Conversion Metrics Dashboard

### Key Metrics to Track

```sql
-- Conversion funnel (last 30 days)
SELECT 
  COUNT(*) FILTER (WHERE la.action = 'send_email') as offers_sent,
  COUNT(*) FILTER (WHERE le.event_type = 'replied') as responses_received,
  COUNT(*) FILTER (WHERE le.event_type = 'qualified') as qualified_deals,
  COUNT(*) FILTER (WHERE le.event_type = 'signed') as contracts_signed,
  COUNT(*) FILTER (WHERE le.event_type = 'closed') as deals_closed,
  
  -- Conversion rates
  COUNT(*) FILTER (WHERE le.event_type = 'replied')::float / 
    NULLIF(COUNT(*) FILTER (WHERE la.action = 'send_email'), 0) as response_rate,
  
  COUNT(*) FILTER (WHERE le.event_type = 'signed')::float / 
    NULLIF(COUNT(*) FILTER (WHERE le.event_type = 'qualified'), 0) as close_rate,
  
  -- Average time metrics
  AVG(EXTRACT(EPOCH FROM (le.created_at - la.created_at)) / 3600) 
    FILTER (WHERE le.event_type = 'replied') as avg_hours_to_response
    
FROM lead_actions la
LEFT JOIN lead_events le ON le.lead_id = la.lead_id
WHERE la.created_at > now() - interval '30 days'
  AND la.organization_id = $1;
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1)
1. Add `deal_outcomes` table
2. Implement daily queue endpoint (`/api/optimization/daily-queue`)
3. Create manual outcome tracking (when deals close, log them)

### Phase 2: Enhanced Agents (Week 2)
4. Build `OfferFramingAgent`
5. Build `NegotiationResponseAgent`
6. Update orchestrator to use new agents

### Phase 3: Learning Loop (Week 3)
7. Implement weekly calibration query
8. Adjust probability weights based on actual close rates
9. Dashboard showing predicted vs actual

### Phase 4: Speed & Follow-Up (Week 4)
10. Speed alerts for high-EV leads
11. Follow-up sequence tracking
12. Conversion metrics dashboard

---

## Success Metrics

Track these weekly:

1. **Offer acceptance rate:** % of offers that get a positive response
2. **Response-to-contract rate:** % of responses that become contracts
3. **Time-to-response:** Hours from lead scored to first contact
4. **Calibration error:** Predicted P(close) vs actual close rate
5. **EV per contact:** Actual fees / contacts made

**Goal:** Increase each metric by 10-20% over 8 weeks through continuous optimization of agent prompts and strategies.

---

## Next Steps

1. Review this design
2. Prioritize which enhancements to build first
3. Start with daily queue endpoint (easiest win)
4. Add outcome tracking as deals close
5. Iterate agent prompts based on real conversations
