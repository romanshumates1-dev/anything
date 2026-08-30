# DealFlow AI Pipeline Optimization - MVP Design

**Date:** 2026-07-31  
**Status:** Ready for Implementation  
**Goal:** Build minimal decision engine, collect real data, then optimize

---

## Why MVP-First

**The Problem with the Full Design:**
- 20+ database tables (over-engineered)
- 6 agents + complex orchestration (too heavy)
- ML models, experimentation, feedback loops (require data we don't have)
- Distributed workers, queues (premature optimization)

**MVP Philosophy:**
> Build the minimum system that makes decisions → collect real outcomes → THEN add intelligence

**What We're Building:**
A simple decision engine that:
1. Scores leads
2. Values properties
3. Calculates deal probability
4. Prioritizes actions

**What We're NOT Building (Yet):**
- Feature stores
- Multi-armed bandits
- ML models (use heuristics first)
- Distributed workers
- Feedback loops
- Experiment engine
- Complex meta-optimization

---

## 1. Minimal Database (5 Tables Only)

```sql
-- 1. Lead scores
CREATE TABLE lead_scores (
  lead_id bigint PRIMARY KEY REFERENCES leads(id),
  composite_score numeric(3,2) NOT NULL,
  distress_score numeric(3,2),
  recency_score numeric(3,2),
  equity_score numeric(3,2),
  geo_score numeric(3,2),
  created_at timestamptz DEFAULT now()
);

-- 2. Property valuations
CREATE TABLE property_valuations (
  lead_id bigint PRIMARY KEY REFERENCES leads(id),
  arv integer NOT NULL,  -- cents
  arv_confidence numeric(3,2) NOT NULL,
  repairs integer NOT NULL,  -- cents
  offer_min integer NOT NULL,  -- cents
  offer_max integer NOT NULL,  -- cents
  comps_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. Deal probabilities
CREATE TABLE deal_probabilities (
  lead_id bigint PRIMARY KEY REFERENCES leads(id),
  p_close numeric(5,4) NOT NULL,  -- 0-1
  expected_value integer NOT NULL,  -- cents
  created_at timestamptz DEFAULT now()
);

-- 4. Action queue (CORE DRIVER)
CREATE TABLE lead_actions (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  action text NOT NULL,  -- 'send_email', 'manual_review', 'call', 'reject'
  priority numeric NOT NULL,  -- expected value
  status text DEFAULT 'pending',  -- 'pending', 'executing', 'completed', 'failed'
  reason jsonb,
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz
);
CREATE INDEX idx_lead_actions_priority ON lead_actions(priority DESC) WHERE status = 'pending';
CREATE INDEX idx_lead_actions_lead ON lead_actions(lead_id);

-- 5. Lead events (ground truth for learning later)
CREATE TABLE lead_events (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  event_type text NOT NULL,  -- 'email_sent', 'opened', 'replied', 'qualified', 'signed', 'closed'
  event_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_lead_events_lead ON lead_events(lead_id, created_at);
CREATE INDEX idx_lead_events_type ON lead_events(event_type, created_at);
```

**Why only 5 tables?**
- These tables drive every decision
- Everything else can be added later based on real needs
- Keeps the system understandable and debuggable

---

## 2. Agent System (4 Agents)

### Agent Interface (Simplified)

```typescript
interface AgentInput {
  leadId: number;
}

interface AgentOutput {
  result: any;
  confidence: number;
}

interface Agent {
  execute(input: AgentInput): Promise<AgentOutput>;
}
```

### Agent 1: Lead Scoring

**Purpose:** Rank leads by conversion potential

**Claude Prompt:**
```
You are a lead quality scoring system for real estate wholesaling.

INPUTS:
- Lead metadata (distress signals, property data, source)
- Days since lead acquired

SCORING COMPONENTS:
1. Distress score (0-1):
   - pre_foreclosure: 0.4
   - tax_delinquent: 0.3
   - code_violation: 0.2
   - probate: 0.25
   - vacant: 0.2
   - absentee_owner: 0.15
   Sum and cap at 1.0

2. Recency score (0-1):
   - Exponential decay: 0.5^(days_since_acquired / 14)
   - 14-day half-life

3. Equity score (0-1):
   - If estimated_arv and estimated_debt available:
     equity_percent = (arv - debt) / arv
   - Otherwise: 0.5 (neutral)

4. Geo score (0-1):
   - Based on buyer coverage in that zip
   - If no data: 0.5

COMPOSITE SCORE:
weighted_sum = 
  0.4 × distress +
  0.3 × recency +
  0.2 × equity +
  0.1 × geo

OUTPUT FORMAT:
{
  "compositeScore": 0.82,
  "components": {
    "distress": 0.9,
    "recency": 0.85,
    "equity": 0.7,
    "geo": 0.8
  }
}
```

**Implementation:**
```typescript
class LeadScoringAgent {
  async execute(input: AgentInput): Promise<AgentOutput> {
    const lead = await fetchLead(input.leadId);
    
    const distressScore = this.calculateDistress(lead.metadata?.signals || []);
    const recencyScore = this.calculateRecency(lead.createdAt);
    const equityScore = this.calculateEquity(lead.metadata);
    const geoScore = await this.calculateGeo(lead.metadata?.zip);
    
    const compositeScore = 
      distressScore * 0.4 +
      recencyScore * 0.3 +
      equityScore * 0.2 +
      geoScore * 0.1;
    
    // Persist
    await sql`
      INSERT INTO lead_scores (lead_id, composite_score, distress_score, recency_score, equity_score, geo_score)
      VALUES (${input.leadId}, ${compositeScore}, ${distressScore}, ${recencyScore}, ${equityScore}, ${geoScore})
      ON CONFLICT (lead_id) DO UPDATE SET
        composite_score = EXCLUDED.composite_score,
        distress_score = EXCLUDED.distress_score,
        recency_score = EXCLUDED.recency_score,
        equity_score = EXCLUDED.equity_score,
        geo_score = EXCLUDED.geo_score,
        created_at = now()
    `;
    
    return {
      result: { compositeScore, components: { distressScore, recencyScore, equityScore, geoScore } },
      confidence: 0.8
    };
  }
  
  private calculateDistress(signals: string[]): number {
    const weights = {
      pre_foreclosure: 0.4,
      tax_delinquent: 0.3,
      code_violation: 0.2,
      probate: 0.25,
      vacant: 0.2,
      absentee_owner: 0.15
    };
    
    let score = 0;
    for (const signal of signals) {
      score += weights[signal] || 0;
    }
    return Math.min(score, 1.0);
  }
  
  private calculateRecency(createdAt: Date): number {
    const days = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, days / 14);
  }
  
  private calculateEquity(metadata: any): number {
    const arv = metadata?.estimated_arv;
    const debt = metadata?.estimated_debt || (arv * 0.7);
    if (!arv) return 0.5;
    return Math.max(0, Math.min(1, (arv - debt) / arv));
  }
  
  private async calculateGeo(zip: string): Promise<number> {
    if (!zip) return 0.5;
    const coverage = await sql`SELECT active_buyer_count FROM buyer_coverage WHERE zip_code = ${zip}`.then(r => r[0]);
    if (!coverage) return 0.3;
    return Math.min(1, coverage.active_buyer_count / 5);
  }
}
```

### Agent 2: Valuation

**Purpose:** Calculate ARV and offer range

**Claude Prompt:**
```
You are a real estate valuation expert for wholesaling.

INPUTS:
- Property specs (beds, baths, sqft, condition, location)
- Comparable sales within 1 mile, sold in last 90 days

PROCESS:
1. Filter comps:
   - Distance ≤ 1 mile
   - Sold ≤ 90 days ago
   - Sqft within 80-120% of subject
   - Beds/baths ±1

2. Score each comp (0-1):
   - Bed match: exact = 1.0, off by 1 = 0.7
   - Bath match: exact = 1.0, off by 1 = 0.8
   - Sqft match: 1 - (|subject - comp| / subject)
   - Similarity = (bed + bath + sqft) / 3

3. Weight comps:
   - Recency: 0.5^(days_old / 30)
   - Proximity: max(0, 1 - distance_miles)
   - Weight = similarity × recency × proximity

4. Calculate ARV:
   - Weighted avg price per sqft
   - ARV = avg_psf × subject_sqft

5. Estimate repairs:
   - Light: $10/sqft
   - Moderate: $20/sqft
   - Heavy: $35/sqft
   - Plus big ticket items (roof, HVAC)

6. Calculate offer:
   - Buyer max = ARV × 0.70
   - Offer max = buyer_max - repairs - $10k fee
   - Offer min = offer_max × 0.70

OUTPUT:
{
  "arv": 250000,
  "arvConfidence": 0.85,
  "repairs": 35000,
  "offerMin": 140000,
  "offerMax": 160000,
  "compsCount": 8
}
```

**Implementation:**
```typescript
class ValuationAgent {
  async execute(input: AgentInput): Promise<AgentOutput> {
    const lead = await fetchLead(input.leadId);
    const property = this.extractPropertyData(lead);
    
    // Find comps (placeholder - integrate with actual comp source)
    const comps = await this.findComps(property);
    
    if (comps.length === 0) {
      // No comps - escalate to manual
      return {
        result: { arv: null, confidence: 0 },
        confidence: 0
      };
    }
    
    // Score and weight comps
    const scoredComps = this.scoreComps(property, comps);
    const weightedComps = this.applyWeights(scoredComps);
    
    // Calculate ARV
    const arv = this.calculateARV(property, weightedComps);
    const arvConfidence = this.calculateConfidence(weightedComps);
    
    // Estimate repairs
    const repairs = this.estimateRepairs(property);
    
    // Calculate offer range
    const buyerMax = Math.round(arv * 0.70);
    const offerMax = Math.round(buyerMax - repairs - 10000);
    const offerMin = Math.round(offerMax * 0.70);
    
    // Persist
    await sql`
      INSERT INTO property_valuations (lead_id, arv, arv_confidence, repairs, offer_min, offer_max, comps_count)
      VALUES (${input.leadId}, ${arv}, ${arvConfidence}, ${repairs}, ${offerMin}, ${offerMax}, ${comps.length})
      ON CONFLICT (lead_id) DO UPDATE SET
        arv = EXCLUDED.arv,
        arv_confidence = EXCLUDED.arv_confidence,
        repairs = EXCLUDED.repairs,
        offer_min = EXCLUDED.offer_min,
        offer_max = EXCLUDED.offer_max,
        comps_count = EXCLUDED.comps_count,
        created_at = now()
    `;
    
    return {
      result: { arv, arvConfidence, repairs, offerMin, offerMax, compsCount: comps.length },
      confidence: arvConfidence
    };
  }
  
  private estimateRepairs(property: any): number {
    const condition = property.condition || 'moderate';
    const sqft = property.sqft || 1500;
    
    const repairPsf = {
      light: 10,
      moderate: 20,
      heavy: 35
    };
    
    return Math.round(sqft * repairPsf[condition]);
  }
  
  // ... other methods similar to full design but simplified
}
```

### Agent 3: Probability

**Purpose:** Calculate deal close probability and expected value

**Implementation:**
```typescript
class ProbabilityAgent {
  async execute(input: AgentInput): Promise<AgentOutput> {
    // Fetch outputs from other agents
    const score = await sql`SELECT composite_score FROM lead_scores WHERE lead_id = ${input.leadId}`.then(r => r[0]);
    const valuation = await sql`SELECT arv, arv_confidence FROM property_valuations WHERE lead_id = ${input.leadId}`.then(r => r[0]);
    
    if (!score || !valuation) {
      return { result: { pClose: 0, expectedValue: 0 }, confidence: 0 };
    }
    
    // Simple weighted average
    const pClose = 
      score.composite_score * 0.5 +
      valuation.arv_confidence * 0.5;
    
    // Expected value = probability × estimated fee
    const estimatedFee = 10000;  // $10k baseline
    const expectedValue = Math.round(pClose * estimatedFee);
    
    // Persist
    await sql`
      INSERT INTO deal_probabilities (lead_id, p_close, expected_value)
      VALUES (${input.leadId}, ${pClose}, ${expectedValue})
      ON CONFLICT (lead_id) DO UPDATE SET
        p_close = EXCLUDED.p_close,
        expected_value = EXCLUDED.expected_value,
        created_at = now()
    `;
    
    return {
      result: { pClose, expectedValue },
      confidence: pClose
    };
  }
}
```

### Agent 4: Decision

**Purpose:** Make pursue/conditional/reject decision

**Implementation:**
```typescript
class DecisionAgent {
  async execute(input: AgentInput): Promise<AgentOutput> {
    const prob = await sql`SELECT p_close, expected_value FROM deal_probabilities WHERE lead_id = ${input.leadId}`.then(r => r[0]);
    
    if (!prob) {
      return { result: { action: 'reject', priority: 0 }, confidence: 0 };
    }
    
    let action: string;
    let priority: number = prob.expected_value;
    
    if (prob.p_close > 0.7) {
      action = 'send_email';  // Pursue immediately
    } else if (prob.p_close > 0.4) {
      action = 'send_email';  // Conditional - lower priority
      priority = priority * 0.5;
    } else {
      action = 'reject';  // Skip
      priority = 0;
    }
    
    // Queue action if not reject
    if (action !== 'reject') {
      await sql`
        INSERT INTO lead_actions (lead_id, action, priority, reason)
        VALUES (
          ${input.leadId},
          ${action},
          ${priority},
          ${JSON.stringify({ pClose: prob.p_close, expectedValue: prob.expected_value })}
        )
      `;
    }
    
    return {
      result: { action, priority },
      confidence: prob.p_close
    };
  }
}
```

---

## 3. Orchestrator (Synchronous)

**No queues. No workers. Just sequential execution.**

```typescript
class SimpleOrchestrator {
  private agents = {
    leadScoring: new LeadScoringAgent(),
    valuation: new ValuationAgent(),
    probability: new ProbabilityAgent(),
    decision: new DecisionAgent()
  };
  
  async processLead(leadId: number): Promise<void> {
    console.log(`[Orchestrator] Processing lead ${leadId}`);
    
    try {
      // Step 1: Score lead
      const scoreResult = await this.agents.leadScoring.execute({ leadId });
      console.log(`[Orchestrator] Lead score: ${scoreResult.result.compositeScore}`);
      
      // Step 2: Value property
      const valuationResult = await this.agents.valuation.execute({ leadId });
      
      // Early exit if no valuation
      if (!valuationResult.result.arv) {
        console.log(`[Orchestrator] No valuation - skipping lead ${leadId}`);
        return;
      }
      console.log(`[Orchestrator] ARV: $${valuationResult.result.arv / 100}`);
      
      // Step 3: Calculate probability
      const probabilityResult = await this.agents.probability.execute({ leadId });
      console.log(`[Orchestrator] P(close): ${(probabilityResult.result.pClose * 100).toFixed(1)}%`);
      
      // Step 4: Make decision
      const decisionResult = await this.agents.decision.execute({ leadId });
      console.log(`[Orchestrator] Decision: ${decisionResult.result.action}`);
      
    } catch (error) {
      console.error(`[Orchestrator] Error processing lead ${leadId}:`, error);
      throw error;
    }
  }
  
  async processBatch(leadIds: number[]): Promise<void> {
    for (const leadId of leadIds) {
      await this.processLead(leadId);
    }
  }
}
```

**Usage:**
```typescript
const orchestrator = new SimpleOrchestrator();

// Process single lead
await orchestrator.processLead(123);

// Process batch
await orchestrator.processBatch([123, 124, 125]);
```

---

## 4. API Endpoints (Minimal)

```typescript
// Process lead through pipeline
POST /api/leads/:id/process
→ Triggers orchestrator.processLead(id)

// Get action queue (sorted by priority)
GET /api/actions/queue
→ Returns pending actions sorted by priority DESC

// Get lead decision
GET /api/leads/:id/decision
→ Returns score, valuation, probability, decision

// Record event (for learning later)
POST /api/leads/:id/events
Body: { eventType: 'opened' | 'replied' | 'signed' | 'closed' }
→ Inserts into lead_events
```

---

## 5. Frontend (Minimal Command Center)

### View 1: Lead Table

```
| Lead ID | Address | Score | ARV | P(Close) | EV | Action | Priority |
|---------|---------|-------|-----|----------|----|---------| ---------|
| 123 | 123 Main St | 0.82 | $250k | 68% | $6,800 | send_email | 6800 |
| 124 | 456 Oak Ave | 0.65 | $180k | 42% | $4,200 | send_email | 2100 |
```

### View 2: Action Queue

```
Next Actions (sorted by priority):

1. Lead #123 - Send Email (Priority: 6,800)
   Reason: High probability (68%), strong valuation confidence

2. Lead #124 - Send Email (Priority: 2,100)
   Reason: Conditional (42%), acceptable valuation

[Execute Top Action] button
```

### View 3: Lead Detail

```
Lead #123
Address: 123 Main St, Louisville KY 40202

SCORING:
- Composite: 0.82 (High)
- Distress: 0.9 (pre_foreclosure, vacant)
- Recency: 0.85 (acquired 3 days ago)
- Equity: 0.7 (30% equity)
- Geo: 0.8 (strong buyer coverage)

VALUATION:
- ARV: $250,000 (confidence: 85%)
- Repairs: $35,000
- Offer Range: $140k - $160k
- Comps: 8 properties

PROBABILITY:
- P(Close): 68%
- Expected Value: $6,800

DECISION:
- Action: Send Email
- Priority: 6,800
```

**Implementation:**
- Simple Next.js page with server components
- Fetch from database directly
- No charts yet (add after you have data)

---

## 6. Implementation Order

### Day 1-2: Database + Infrastructure

- [ ] Create 5 tables (lead_scores, property_valuations, deal_probabilities, lead_actions, lead_events)
- [ ] Verify existing leads table has necessary fields
- [ ] Write simple seeder script (20 test leads with realistic data)

### Day 2-3: Agent System

- [ ] Implement LeadScoringAgent
- [ ] Implement ValuationAgent (with mock comps for now)
- [ ] Implement ProbabilityAgent
- [ ] Implement DecisionAgent
- [ ] Test each agent independently

### Day 3-4: Orchestrator + APIs

- [ ] Implement SimpleOrchestrator
- [ ] Add POST /api/leads/:id/process
- [ ] Add GET /api/actions/queue
- [ ] Add GET /api/leads/:id/decision
- [ ] Add POST /api/leads/:id/events
- [ ] Test full pipeline with seeded leads

### Day 4-5: Frontend

- [ ] Lead table page
- [ ] Action queue page
- [ ] Lead detail page
- [ ] Hook up to API endpoints

### Day 5: Verification

- [ ] Process 20 test leads
- [ ] Verify all agents run successfully
- [ ] Verify action queue populates correctly
- [ ] Verify decisions make sense
- [ ] Document any issues found

---

## 7. Success Criteria

### MVP is complete when:

✅ 20 test leads processed successfully  
✅ All 4 agents produce outputs  
✅ Action queue populated and sorted correctly  
✅ Dashboard shows lead scores, valuations, decisions  
✅ No crashes or errors during batch processing  
✅ Code is readable and maintainable

### NOT required for MVP:

❌ ML models  
❌ Experimentation framework  
❌ Distributed workers  
❌ Feedback loops  
❌ Complex analytics  
❌ Real comps integration (mock is fine)

---

## 8. What Happens After MVP

**Phase 2: Data Collection (Weeks 1-4)**
- Run MVP on real leads
- Track actual outcomes (emails sent → replies → signed → closed)
- Populate lead_events table with ground truth
- Measure actual conversion rates per stage

**Phase 3: Learning (Week 5+)**
- Analyze what worked vs what didn't
- Identify actual bottlenecks (not theoretical ones)
- Build feedback loops based on real patterns
- Replace heuristics with learned models where beneficial

**Phase 4: Optimization (Week 8+)**
- Add experimentation framework (once you have volume)
- Add ML models (once you have training data)
- Add distributed workers (once you have scale problems)
- Add advanced features (only if data proves they're needed)

---

## 9. Why This Works

**The trap we avoided:**
Building complex systems that optimize for problems we don't have yet

**What this MVP does:**
1. Makes decisions (the core value)
2. Tracks outcomes (the learning substrate)
3. Stays simple (easy to iterate)
4. Proves the concept (validate assumptions)

**Key insight:**
> You can't optimize a system until you measure it  
> You can't measure it until it runs on real data  
> Build the runner first, then make it faster

---

## 10. Migration Path to Full System

When you're ready to scale, you can upgrade:

```
MVP Table → Full System Table
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
lead_scores → feature_vectors
            → lead_snapshots
            → action_performance

property_valuations → comp_similarity_cache
                    → valuation_history

deal_probabilities → phase_probabilities (with logits)

lead_actions → lead_actions (same, but add queue workers)

lead_events → lead_events (same)
            → agent_executions
            → experiment_outcomes
```

**The beauty:**
Every MVP table has a clear upgrade path, but you don't build it until data proves you need it.

---

## Conclusion

This MVP gives you:

✅ **Decision engine** that works today  
✅ **Data collection** for learning tomorrow  
✅ **Simple codebase** that's easy to iterate  
✅ **Clear upgrade path** when you need it

**Next Step:** Begin Day 1-2 implementation (database + infrastructure)
