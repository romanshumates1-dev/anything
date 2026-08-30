# DealFlow AI Pipeline Optimization - System Design

**Date:** 2026-07-31  
**Status:** Ready for Implementation  
**Goal:** Transform functional pipeline into high-precision, self-optimizing deal acquisition engine

---

## Executive Summary

This document specifies a comprehensive upgrade to the DealFlow AI wholesaling pipeline, transforming it from a **functional system** into a **probabilistic deal engine with adaptive learning**.

**Current State:**
- Phases 0-13 live and verified
- Minimal test data (20 contacts from verification)
- Manual decision-making at key stages
- ~0.09% email → closed deal conversion rate

**Target State:**
- Autonomous multi-agent decision system
- Self-optimizing through feedback loops
- 2.16% email → closed deal conversion rate (24x improvement)
- Proven capacity: 10-30 deals from one free email campaign

**Core Innovation:**
Shift from **lead-first** (reactive) to **action-first** (proactive resource allocation) architecture, where every decision optimizes expected value across constrained resources.

---

## 1. System Architecture

### 1.1 Four-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  META-OPTIMIZATION LAYER                                    │
│  • Bottleneck detector                                      │
│  • Resource allocator                                       │
│  • Feedback loops (outcomes → model updates)                │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  EXPERIMENTATION ENGINE                                     │
│  • Multi-armed bandit framework                             │
│  • A/B test infrastructure                                  │
│  • Statistical rigor (Wilson CI, power analysis)            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  INTELLIGENCE LAYER (Multi-Agent System)                    │
│  • Lead Scoring Agent                                       │
│  • Valuation Agent (ARV/comps engine)                       │
│  • Negotiation Agent                                        │
│  • Probability Agent                                        │
│  • Pipeline Optimizer Agent                                 │
│  • Feedback/Learning Agent                                  │
│  • Master Orchestrator                                      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  FOUNDATION LAYER                                           │
│  • Phase probability model (benchmarks)                     │
│  • Deterministic optimizations (queue theory, decay)        │
│  • Instrumentation (stage transitions, funnel tracking)     │
└─────────────────────────────────────────────────────────────┘
                            ↓
                   EXISTING PIPELINE
         (Phases 0-13: outreach, negotiation, deals)
```

### 1.2 Data Flow

```
Lead enters system
    ↓
Master Orchestrator triggered
    ↓
Parallel agent execution:
    - Lead Scoring Agent → composite score
    - Valuation Agent → ARV, repairs, offer range
    ↓
Sequential dependent agents:
    - Negotiation Agent → strategy based on valuation + score
    - Probability Agent → deal probability
    ↓
Orchestrator makes decision (pursue/conditional/reject/manual)
    ↓
Action queued in lead_actions table (priority = expected value)
    ↓
Action Executor pulls from queue and executes
    ↓
Outcome recorded → lead_events table
    ↓
Feedback Agent learns from outcome
    ↓
Models updated, cycle continues
```

---

## 2. Phase Probability Model

### 2.1 Pipeline Stages

```
STAGES:
1. ACQUIRED      → Lead enters system
2. DELIVERABLE   → Email passes validation
3. DELIVERED     → Email accepted by server
4. OPENED        → Recipient opens email
5. REPLIED       → Recipient replies
6. QUALIFIED     → Reply indicates serious interest
7. NEGOTIATING   → Range request sent, active conversation
8. SIGNED        → Contract signed by seller
9. ASSIGNED      → Contract assigned to cash buyer
10. CLOSED       → Assignment fee collected
```

### 2.2 Baseline Conversion Rates

| Transition | Benchmark | Notes |
|------------|-----------|-------|
| ACQUIRED → DELIVERABLE | 95% | Email validation filters |
| DELIVERABLE → DELIVERED | 98% | Bounce rate |
| DELIVERED → OPENED | 22% | Cold email baseline |
| OPENED → REPLIED | 3.5% | Reply rate |
| REPLIED → QUALIFIED | 35% | Serious vs curious |
| QUALIFIED → NEGOTIATING | 12% | Willing to discuss numbers |
| NEGOTIATING → SIGNED | 15% | Reach agreement |
| SIGNED → ASSIGNED | 70% | Find buyer in inspection window |
| ASSIGNED → CLOSED | 95% | Buyer closes |

**Net Probability (Baseline):**
```
P(CLOSED | ACQUIRED) = 0.95 × 0.98 × 0.22 × 0.035 × 0.35 × 0.12 × 0.15 × 0.70 × 0.95
                     = 0.000734
                     = 0.0734%
                     ≈ 1 in 1,362 leads
```

**To achieve 10-30 deals:**
- 10 deals: 13,620 leads
- 20 deals: 27,240 leads
- 30 deals: 40,860 leads

### 2.3 Optimized Conversion Rates (Target)

| Phase | Before | After Optimization | Improvement |
|-------|--------|-------------------|-------------|
| B (Contacted → Engaged) | 2-5% | 8-15% | 3-5x |
| C (Engaged → Negotiating) | 30% | 50-65% | 1.7-2.2x |
| D (Negotiating → Signed) | 10-20% | 25-40% | 2-2.5x |
| E (Signed → Closed) | 60-80% | 85-95% | 1.2-1.4x |

**Net Probability (Optimized):**
```
0.95 × 0.12 × 0.60 × 0.35 × 0.90 = 0.0216 (2.16%)
```

**Result:**
- Emails per deal: ~46 (vs 1,100 baseline)
- 10 deals: ~460 emails (vs 11,000)
- 30 deals: ~1,380 emails (vs 33,000)

**24x improvement in efficiency**

---

## 3. Database Schema

### 3.1 Intelligence Layer Tables

```sql
-- Phase probabilities (the "brain")
CREATE TABLE phase_probabilities (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  -- Per-phase probabilities (stored as logits for stability)
  p_contacted_logit numeric(8,4),
  p_engaged_logit numeric(8,4),
  p_negotiating_logit numeric(8,4),
  p_signed_logit numeric(8,4),
  p_closed_logit numeric(8,4),
  
  -- Converted probabilities (for display)
  p_contacted numeric(5,4),
  p_engaged numeric(5,4),
  p_negotiating numeric(5,4),
  p_signed numeric(5,4),
  p_closed numeric(5,4),
  
  -- Expected value = P(close) × estimated_fee
  expected_value_cents integer,
  
  model_version text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_phase_probabilities_lead ON phase_probabilities(lead_id);
CREATE INDEX idx_phase_probabilities_ev ON phase_probabilities(expected_value_cents DESC NULLS LAST);

-- Lead quality scoring
CREATE TABLE lead_scores (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  distress_score numeric(3,2),      -- 0-1 (0.4 weight)
  recency_score numeric(3,2),       -- 0-1 (0.3 weight)
  equity_score numeric(3,2),        -- 0-1 (0.2 weight)
  geo_liquidity_score numeric(3,2), -- 0-1 (0.1 weight)
  composite_score numeric(3,2) NOT NULL,
  
  scoring_version text NOT NULL,
  scored_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);
CREATE INDEX idx_lead_scores_composite ON lead_scores(composite_score DESC);
CREATE INDEX idx_lead_scores_lead ON lead_scores(lead_id);

-- Property valuations
CREATE TABLE property_valuations (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  arv_estimated integer,  -- cents
  arv_confidence numeric(3,2),  -- 0-1
  comps_used jsonb,  -- [{address, price, similarity, recency_weight, distance_miles}, ...]
  repairs_estimated integer,  -- cents
  repairs_confidence numeric(3,2),  -- 0-1
  offer_min integer,  -- cents
  offer_max integer,  -- cents
  valuation_method text NOT NULL,  -- 'comp_based', 'avm', 'manual', 'hybrid'
  
  valued_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'
);
CREATE INDEX idx_property_valuations_lead ON property_valuations(lead_id);
CREATE INDEX idx_property_valuations_confidence ON property_valuations(arv_confidence DESC NULLS LAST);

-- Outreach attempts tracking
CREATE TABLE outreach_attempts (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  organization_id text NOT NULL,
  
  channel text NOT NULL,  -- 'email', 'sms', 'call', 'mail'
  variant_id text,  -- experiment variant
  
  sent_at timestamptz NOT NULL,
  responded boolean DEFAULT false,
  responded_at timestamptz,
  response_time_minutes integer,
  
  outcome text,  -- 'opened', 'replied', 'qualified', 'opt_out', 'bounce'
  
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_outreach_attempts_lead ON outreach_attempts(lead_id);
CREATE INDEX idx_outreach_attempts_channel ON outreach_attempts(channel, sent_at);
CREATE INDEX idx_outreach_attempts_variant ON outreach_attempts(variant_id) WHERE variant_id IS NOT NULL;

-- Negotiation tracking
CREATE TABLE negotiation_events (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  organization_id text NOT NULL,
  
  event_type text NOT NULL,  -- 'offer_sent', 'counter_received', 'accepted', 'rejected', 'stalled'
  offer_amount integer,  -- cents
  seller_response text,
  response_time_hours numeric(6,2),
  
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_negotiation_events_lead ON negotiation_events(lead_id, created_at);
CREATE INDEX idx_negotiation_events_type ON negotiation_events(event_type);

-- Buyer coverage
CREATE TABLE buyer_coverage (
  id bigserial PRIMARY KEY,
  zip_code text NOT NULL UNIQUE,
  
  buyer_count integer DEFAULT 0,
  active_buyer_count integer DEFAULT 0,  -- closed in last 90 days
  
  price_min_cents integer,
  price_max_cents integer,
  
  avg_close_days numeric(5,2),
  close_rate numeric(3,2),
  demand_velocity numeric(5,2),  -- deals per month
  
  last_updated timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_buyer_coverage_zip ON buyer_coverage(zip_code);
CREATE INDEX idx_buyer_coverage_active ON buyer_coverage(active_buyer_count DESC);

-- Buyer match scoring
CREATE TABLE buyer_match_scores (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  buyer_id bigint NOT NULL REFERENCES buyers(id),
  
  match_score numeric(3,2) NOT NULL,
  price_fit boolean NOT NULL,
  location_fit boolean NOT NULL,
  liquidity_score numeric(3,2),
  
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_buyer_match_scores_lead ON buyer_match_scores(lead_id, match_score DESC);
CREATE INDEX idx_buyer_match_scores_buyer ON buyer_match_scores(buyer_id);
```

### 3.2 Feature Store & Event Sourcing

```sql
-- Feature vectors (training/inference parity)
CREATE TABLE feature_vectors (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  features jsonb NOT NULL,  -- model-ready features
  feature_version text NOT NULL,
  
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_feature_vectors_lead ON feature_vectors(lead_id);
CREATE INDEX idx_feature_vectors_version ON feature_vectors(feature_version);

-- Unified event log
CREATE TABLE lead_events (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}',
  
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_events_lead ON lead_events(lead_id, occurred_at);
CREATE INDEX idx_lead_events_type ON lead_events(event_type, occurred_at);

CREATE TABLE buyer_events (
  id bigserial PRIMARY KEY,
  buyer_id bigint NOT NULL REFERENCES buyers(id),
  
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}',
  
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_buyer_events_buyer ON buyer_events(buyer_id, occurred_at);

-- Revenue realization feedback
CREATE TABLE deal_outcomes (
  lead_id bigint PRIMARY KEY REFERENCES leads(id),
  
  revenue_cents integer NOT NULL,
  margin_cents integer,
  days_to_close integer,
  closed_at timestamptz NOT NULL,
  
  campaign_id text,
  channel text,
  
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_outcomes_closed ON deal_outcomes(closed_at);
CREATE INDEX idx_deal_outcomes_revenue ON deal_outcomes(revenue_cents DESC);

-- Negotiation outcomes (learning layer)
CREATE TABLE negotiation_outcomes (
  id bigserial PRIMARY KEY,
  lead_id bigint REFERENCES leads(id),
  
  -- Context
  seller_profile text,
  lead_score numeric(3,2),
  arv_cents integer,
  
  -- Strategy
  strategy_type text,
  initial_offer_cents integer,
  
  -- Outcome
  accepted boolean,
  final_price_cents integer,
  days_to_close integer,
  
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_negotiation_profile ON negotiation_outcomes(seller_profile);
CREATE INDEX idx_negotiation_strategy ON negotiation_outcomes(strategy_type);
```

### 3.3 Experimentation Framework

```sql
-- Experiments
CREATE TABLE experiments (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,  -- 'subject_line', 'message_body', 'send_time'
  
  variants jsonb NOT NULL,  -- [{id: 'a', label: '...', weight: 0.25}, ...]
  status text NOT NULL DEFAULT 'active',
  
  allocation_strategy text DEFAULT 'thompson_sampling',
  min_sample_size integer DEFAULT 100,
  confidence_threshold numeric(3,2) DEFAULT 0.95,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  concluded_at timestamptz
);

CREATE TABLE experiment_exposures (
  id bigserial PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES experiments(id),
  variant_id text NOT NULL,
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  exposed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_experiment_exposures_exp ON experiment_exposures(experiment_id, lead_id);

CREATE TABLE experiment_outcomes (
  id bigserial PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES experiments(id),
  variant_id text NOT NULL,
  lead_id bigint REFERENCES leads(id),
  
  stage_reached text NOT NULL,
  converted boolean DEFAULT false,
  
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_experiment_outcomes_exp ON experiment_outcomes(experiment_id, variant_id);
```

### 3.4 Decision Queue

```sql
-- Lead actions (priority queue)
CREATE TABLE lead_actions (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  
  recommended_action text NOT NULL,  -- 'send_email', 'call', 'make_offer'
  priority_score numeric(8,4) NOT NULL,  -- Expected value - cost - time penalty
  
  reason jsonb NOT NULL,  -- {expected_value, cost, urgency, model_version}
  
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX idx_lead_actions_priority ON lead_actions(priority_score DESC) WHERE status = 'pending';
CREATE INDEX idx_lead_actions_lead ON lead_actions(lead_id, created_at);
```

### 3.5 Agent System

```sql
-- Agent execution tracking
CREATE TABLE agent_executions (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL,
  agent_name text NOT NULL,
  agent_version text NOT NULL,
  
  input jsonb NOT NULL,
  output jsonb,
  
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  execution_time_ms integer,
  
  status text NOT NULL DEFAULT 'pending',
  error text,
  
  lead_id bigint REFERENCES leads(id),
  parent_request_id text
);
CREATE INDEX idx_agent_executions_request ON agent_executions(request_id);
CREATE INDEX idx_agent_executions_lead ON agent_executions(lead_id);
CREATE INDEX idx_agent_executions_agent ON agent_executions(agent_name, started_at);

-- Agent outputs (denormalized)
CREATE TABLE agent_outputs (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id),
  agent_name text NOT NULL,
  
  output jsonb NOT NULL,
  confidence numeric(3,2),
  
  created_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(lead_id, agent_name)
);
CREATE INDEX idx_agent_outputs_lead ON agent_outputs(lead_id);

-- Action performance tracking
CREATE TABLE action_performance (
  id bigserial PRIMARY KEY,
  action_type text NOT NULL,
  context_hash text NOT NULL,
  
  success_rate numeric(5,4),
  avg_value_cents integer,
  sample_size integer,
  
  context_summary jsonb,
  last_updated timestamptz DEFAULT now(),
  
  UNIQUE(action_type, context_hash)
);
CREATE INDEX idx_action_performance_type ON action_performance(action_type);
```

---

## 4. Multi-Agent System

### 4.1 Agent Interface

```typescript
interface Agent {
  name: string;
  version: string;
  execute(input: AgentInput): Promise<AgentOutput>;
  isHealthy(): Promise<boolean>;
}

interface AgentInput {
  leadId: number;
  context: Record<string, any>;
  requestId: string;
}

interface AgentOutput {
  agentName: string;
  agentVersion: string;
  result: Record<string, any>;
  confidence: number;
  executionTimeMs: number;
  error?: string;
  requestId: string;
}
```

### 4.2 Agent Implementations

#### Lead Scoring Agent

**Purpose:** Prioritize leads by composite score (distress, recency, equity, geo-liquidity)

**Inputs:**
- Lead metadata (signals, property data, source)
- Timestamp (for recency decay)
- Buyer coverage data

**Outputs:**
```json
{
  "compositeScore": 0.82,
  "priorityTier": "high",
  "components": {
    "distressScore": 0.9,
    "recencyScore": 0.85,
    "equityScore": 0.7,
    "geoLiquidityScore": 0.8
  }
}
```

**Algorithm:**
```
distressScore = Σ signal_weights (pre_foreclosure=0.4, tax_delinquent=0.3, ...)
recencyScore = 0.5^(days_since_acquired / 14)  // 14-day half-life
equityScore = (ARV - debt) / ARV
geoLiquidityScore = (buyer_count + speed_score) / 2

compositeScore = 0.4×distress + 0.3×recency + 0.2×equity + 0.1×geo
```

#### Valuation Agent (CRITICAL)

**Purpose:** Calculate ARV, repairs, and offer range with statistical confidence

**Inputs:**
- Property specs (beds, baths, sqft, condition)
- Comparable sales (from lead finder or external API)
- Location data

**Outputs:**
```json
{
  "arv": 250000,
  "arvConfidence": 0.85,
  "repairs": 35000,
  "repairsConfidence": 0.70,
  "offerMin": 140000,
  "offerMax": 160000,
  "compsCount": 8
}
```

**Algorithm:**
```
1. Find comps:
   - Distance ≤ 1 mile
   - Sold ≤ 90 days ago
   - Sqft within 80-120% of subject
   - Beds/baths ±1

2. Score comps:
   similarityScore = (bedMatch + bathMatch + sqftMatch) / 3
   
3. Weight comps:
   recencyWeight = 0.5^(days_old / 30)
   proximityWeight = max(0, 1 - distance_miles)
   weight = similarity × recency × proximity
   
4. Calculate ARV:
   avgPricePerSqft = Σ(comp_price/sqft × weight) / Σ(weight)
   ARV = avgPricePerSqft × subject_sqft
   
5. Estimate repairs:
   baseRepairs = sqft × repair_psf[condition]
   bigTicket = roof + hvac + foundation_flags
   repairs = baseRepairs + bigTicket
   
6. Calculate offer:
   buyerMax = ARV × 0.70  // 70% rule
   offerMax = buyerMax - repairs - wholesaleFee
   offerMin = offerMax × 0.70  // opener
```

**Confidence:**
```
arvConfidence = (countScore + consistencyScore + weightScore) / 3

where:
  countScore = min(1, comps.length / 10)
  consistencyScore = 1 - coefficientOfVariation
  weightScore = min(1, totalWeight / comps.length)
```

#### Negotiation Agent

**Purpose:** Select strategy and generate offer based on seller profile

**Inputs:**
- Seller profile (from metadata, conversation history)
- Valuation output
- Lead score

**Outputs:**
```json
{
  "sellerProfile": "high_motivation",
  "strategyType": "fast_close",
  "offerPrice": 160000,
  "justification": "High motivation → prioritize speed over margin",
  "nextAction": "present_offer_immediately"
}
```

**Strategy Selection:**
```
IF seller_profile == 'high_motivation':
  strategy = 'fast_close'
  price = offerMax
  
ELSE IF seller_profile == 'medium_motivation':
  strategy = 'anchored_negotiation'
  price = offerMin × 0.9
  
ELSE:
  strategy = 'nurture'
  price = offerMin × 0.8
```

**Learning Layer:**
Query negotiation_outcomes table to find best-performing strategy for similar sellers:
```sql
SELECT strategy_type, 
       AVG(CASE WHEN accepted THEN 1 ELSE 0 END) as success_rate
FROM negotiation_outcomes
WHERE seller_profile = ?
  AND arv_cents BETWEEN ? AND ?
GROUP BY strategy_type
ORDER BY success_rate DESC
```

#### Probability Agent

**Purpose:** Calculate deal probability and expected value

**Inputs:**
- Lead score
- Valuation confidence
- Negotiation confidence

**Outputs:**
```json
{
  "dealProbability": 0.68,
  "expectedValue": 680000,
  "riskScore": 0.32
}
```

**Algorithm:**
```
dealProbability = 
  leadScore × 0.5 +
  arvConfidence × 0.3 +
  negotiationConfidence × 0.2

expectedValue = dealProbability × (arv - offerPrice - repairs)
```

#### Pipeline Optimizer Agent

**Purpose:** Identify bottlenecks and recommend optimizations

**Inputs:**
- Pipeline metrics (conversion rates per stage)
- Time delays per stage
- Drop-off counts

**Outputs:**
```json
{
  "bottlenecks": ["engaged_to_negotiating", "negotiating_to_signed"],
  "optimizations": [
    {
      "stage": "engaged_to_negotiating",
      "action": "Improve qualification script",
      "expectedImpact": "+15% conversion"
    }
  ],
  "efficiencyScore": 0.42
}
```

#### Feedback/Learning Agent

**Purpose:** Update models based on actual outcomes

**Runs:** Daily (cron job)

**Process:**
1. Fetch closed deals from last 7 days
2. Calculate valuation error: `|ARV_predicted - sale_price| / sale_price`
3. Calculate negotiation performance: `accepted_count / total_count`
4. Update model weights in feature_vectors
5. Refresh buyer_coverage table

---

### 4.3 Master Orchestrator

**Purpose:** Coordinate all agents and make final decision

```typescript
class MasterOrchestrator {
  async processLead(leadId: number): Promise<LeadDecision> {
    const requestId = generateUUID();
    
    // Phase 1: Parallel independent agents
    const [scoreResult, valuationResult] = await Promise.all([
      this.runAgent('lead-scoring', leadId, requestId),
      this.runAgent('valuation', leadId, requestId)
    ]);
    
    // Early exit if valuation fails
    if (!valuationResult.result.arv) {
      return this.escalateToManual(leadId, 'Valuation failed');
    }
    
    // Phase 2: Sequential dependent agents
    const negotiationResult = await this.runAgent('negotiation', leadId, requestId);
    const probabilityResult = await this.runAgent('probability', leadId, requestId);
    
    // Phase 3: Make decision
    const decision = this.makeDecision({
      leadId,
      score: scoreResult.result,
      valuation: valuationResult.result,
      negotiation: negotiationResult.result,
      probability: probabilityResult.result
    });
    
    // Phase 4: Queue action
    await this.queueNextAction(leadId, decision);
    
    return decision;
  }
  
  private makeDecision(data): LeadDecision {
    const { probability } = data;
    
    if (probability.dealProbability > 0.7) {
      return { action: 'pursue', confidence: probability.dealProbability };
    } else if (probability.dealProbability > 0.4) {
      return { action: 'conditional', confidence: probability.dealProbability };
    } else {
      return { action: 'reject', confidence: probability.dealProbability };
    }
  }
}
```

---

## 5. Optimization Strategies

### 5.1 Phase B: Contacted → Engaged (BIGGEST LEVERAGE)

**Current:** 2-5% reply rate  
**Target:** 8-15% reply rate  
**Impact:** 3-5x pipeline throughput

**Optimizations:**

1. **Subject Line Bandit System**
   - Test 5 variants continuously
   - Thompson Sampling for traffic allocation
   - Auto-scale winners
   
   Example variants:
   - "Quick question about your property"
   - "Saw something about [address]"
   - "Not sure if this reached you..."

2. **Message Formula**
   Pattern: Casual opener + soft uncertainty + low commitment CTA
   
   Example:
   ```
   Hey, not sure if you'd consider selling your property at [address],
   but figured I'd ask. If not, no worries.
   ```

3. **Timing Optimization**
   - Send windows: 8-10am, 6-8pm
   - Learn optimal send time per lead segment
   - Store in outreach_attempts table

4. **Follow-up Physics**
   Sequence: Day 0, Day 2, Day 5, Day 10
   Response probability ∝ log(touches)

### 5.2 Phase C: Engaged → Negotiating

**Current:** 30%  
**Target:** 50-65%  
**Impact:** 1.7-2.2x

**Optimizations:**

1. **AI Qualification Layer**
   Score replies by intent:
   ```
   IntentScore = keyword_weight + sentiment + urgency
   
   "just curious" → low (0.3)
   "need to sell fast" → high (0.9)
   ```

2. **Fast Routing**
   - High score → immediate follow-up (< 1 hour)
   - Low score → nurture sequence

3. **Conversation Script**
   Goal: Extract price anchor, condition, timeline

### 5.3 Phase D: Negotiating → Signed

**Current:** 10-20%  
**Target:** 25-40%  
**Impact:** 2-2.5x

**Optimizations:**

1. **ARV Engine** (already implemented in ValuationAgent)
   
2. **Offer Formula with Dynamic Adjustment**
   ```
   baseOffer = ARV × 0.70 - repairs - margin
   
   adjustment = f(motivation_score):
     high motivation → +5% (close faster)
     low motivation → -10% (anchor low)
   
   finalOffer = baseOffer × (1 + adjustment)
   ```

3. **Negotiation Strategy (Game Theory)**
   - First offer = anchor low (offerMin)
   - Concessions = slow + justified
   - Always leave room for movement

### 5.4 Phase E: Signed → Closed

**Current:** 60-80%  
**Target:** 85-95%  
**Impact:** 1.2-1.4x

**Optimizations:**

1. **Buyer Coverage Map**
   ```
   coverage_score = buyers_per_zip × price_overlap
   ```

2. **Pre-Match Before Contract**
   Don't sign unless:
   ```
   buyer_match_probability > 0.7
   ```

3. **Speed Rule**
   ```
   close_probability ∝ 1 / days_since_signed
   ```
   Target: Assign within 3 days of signing

---

## 6. Expected Value Optimization

### 6.1 Core Algorithm

```
For each lead:
  EV(action) = P(success | action, context) × Revenue - Cost(action) - TimeDecayPenalty

Priority Queue: Sort all (lead, action) pairs by EV descending
```

### 6.2 Action Policy (Context-Aware)

Replace naive probability multiplication with context-aware policy:

```typescript
function evaluateActionPolicy(context: ActionContext): number {
  let pSuccess = getBaseProbability(context.leadId);
  
  // Sequence effects (email after email = lower effectiveness)
  pSuccess *= getSequenceMultiplier(context.channelSequence);
  
  // Timing effects (optimal time = higher response)
  pSuccess *= getTimingMultiplier(context.timeSinceLastTouchHours);
  
  // Saturation effects (diminishing returns)
  pSuccess *= getSaturationMultiplier(context.totalTouchCount);
  
  // Circadian effects (time of day)
  pSuccess *= getCircadianMultiplier(context.timeOfDay);
  
  return pSuccess;
}
```

### 6.3 Multi-Horizon Optimization

```typescript
function evaluateActionWithHorizon(lead: Lead, action: Action) {
  const immediateEV = calculateImmediateEV(lead, action);
  const futureEV = calculateFutureEV(lead, action);
  
  return {
    immediateEV,
    futureEV,
    totalEV: immediateEV + futureEV
  };
}

// Example: Data enrichment has negative immediate EV, positive future EV
// Action: "Enrich property data" (costs $0.50)
// immediateEV = -$0.50
// futureEV = 0.2 × $500 = $100
// totalEV = $99.50 → TAKE THE ACTION
```

### 6.4 Capacity-Aware Allocation

```typescript
function allocateCapacity(
  actions: ActionEvaluation[],
  budget: { emailCount: number; callMinutes: number; costCents: number }
): ActionEvaluation[] {
  
  // Sort by ROI per resource
  actions.sort((a, b) => b.totalEV / b.cost - a.totalEV / a.cost);
  
  const selected = [];
  let remaining = { ...budget };
  
  for (const action of actions) {
    if (canAfford(action, remaining)) {
      selected.push(action);
      deduct(action, remaining);
    }
  }
  
  return selected;
}
```

---

## 7. Production Infrastructure

### 7.1 Queue System (BullMQ)

```typescript
import { Queue, Worker } from 'bullmq';

// Queues per agent type
const leadScoringQueue = new Queue('lead-scoring');
const valuationQueue = new Queue('valuation');
const negotiationQueue = new Queue('negotiation');

// Workers
const leadScoringWorker = new Worker('lead-scoring', async (job) => {
  const { leadId, requestId } = job.data;
  const agent = new LeadScoringAgent();
  return await agent.execute({ leadId, context: {}, requestId });
});

// Orchestrator enqueues jobs
class AsyncOrchestrator {
  async processLead(leadId: number) {
    const requestId = generateUUID();
    
    // Enqueue parallel agents
    await Promise.all([
      leadScoringQueue.add('score', { leadId, requestId }),
      valuationQueue.add('value', { leadId, requestId })
    ]);
    
    // Wait for results
    const results = await this.waitForResults(requestId, ['lead-scoring', 'valuation']);
    
    // Continue...
  }
}
```

### 7.2 Feature Store

Centralized feature computation for training/inference parity:

```sql
CREATE TABLE feature_store (
  feature_key text PRIMARY KEY,
  feature_value jsonb NOT NULL,
  feature_type text NOT NULL,  -- 'lead', 'property', 'market', 'buyer'
  entity_id text NOT NULL,
  
  computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  feature_version text NOT NULL
);
```

### 7.3 ML Model Upgrades

Replace heuristic agents with trained models:

```typescript
class MLValuationAgent extends ValuationAgent {
  private model: XGBoostModel;
  
  async execute(input: AgentInput): Promise<AgentOutput> {
    const features = await this.fetchFeatures(input.leadId);
    
    // Predict ARV using trained model
    const arvPrediction = await this.model.predict(features);
    
    return {
      agentName: 'valuation',
      agentVersion: 'v4.0-ml',
      result: {
        arv: arvPrediction.value,
        arvConfidence: arvPrediction.confidence,
        modelType: 'xgboost'
      },
      confidence: arvPrediction.confidence,
      executionTimeMs: Date.now() - startTime,
      requestId: input.requestId
    };
  }
}
```

---

## 8. Key Performance Metrics

### 8.1 System KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Valuation Accuracy | < 10% error | `|ARV - sale_price| / sale_price` |
| Deal Conversion Rate | 5-15% | `closed_deals / leads_acquired` |
| Expected Value Accuracy | ±15% | `predicted_EV - actual_profit` |
| Negotiation Efficiency | > 70% | `accepted / offers_made` |
| Pipeline Speed | < 14 days | `lead_acquired → contract_signed` |
| Close Rate | > 85% | `assigned → closed` |

### 8.2 Agent Performance Metrics

| Agent | Metric | Target |
|-------|--------|--------|
| Lead Scoring | Score-to-conversion correlation | > 0.6 |
| Valuation | ARV accuracy | > 90% |
| Negotiation | Strategy success rate | > 65% |
| Probability | Calibration error | < 10% |

### 8.3 Observability Dashboard

**Critical Views:**

1. **Real-time Funnel**
   - Conversion rates per stage
   - Wilson confidence intervals
   - Drop-off alerts

2. **Agent Health**
   - Execution times
   - Error rates
   - Output distribution

3. **Decision Distribution**
   - Pursue / Conditional / Reject breakdown
   - Average expected value
   - Priority score histogram

4. **Valuation Diagnostics**
   - ARV prediction vs actual
   - Comp quality distribution
   - Confidence score distribution

5. **Experimentation Dashboard**
   - Active experiments
   - Variant performance
   - Winner declaration timeline

---

## 9. Implementation Roadmap

### Sprint 1: Foundation (2-3 weeks)

**Goal:** Working baseline with mathematical proof of capacity

- [ ] Fix stage transition gaps (SIGNED/ASSIGNED wiring)
- [ ] Build phase probability calculator
- [ ] Implement deterministic optimizations (queue theory, decay scoring)
- [ ] Create funnel dashboard with Wilson CIs
- [ ] Prove algebraically: "X emails → 10-30 deals"

**Deliverable:** Baseline metrics established, clear bottleneck identification

### Sprint 2: Intelligence (2-3 weeks)

**Goal:** Agent system operational

- [ ] Implement all 6 agents (Lead Scoring, Valuation, Negotiation, Probability, Pipeline Optimizer, Feedback)
- [ ] Master Orchestrator with decision logic
- [ ] Agent execution logging
- [ ] Feature vector storage

**Deliverable:** Autonomous decision-making system

### Sprint 3: Experimentation (2 weeks)

**Goal:** Continuous improvement engine

- [ ] Multi-armed bandit framework
- [ ] A/B test infrastructure (traffic splitting, stats)
- [ ] First experiments: subject lines (5 variants)
- [ ] Weekly experiment review process

**Deliverable:** Self-optimizing outreach

### Sprint 4: Meta-Layer (1-2 weeks)

**Goal:** System optimizes itself

- [ ] Phase weakness detector
- [ ] Budget allocator (optimization prioritization)
- [ ] Feedback loops (outcomes → model updates)
- [ ] Performance dashboard

**Deliverable:** Compounding advantage engine

### Sprint 5: Scale & Verify (1 week)

**Goal:** Prove production readiness

- [ ] Multi-region testing
- [ ] Volume test (prove 10-30 deal capacity)
- [ ] Cost analysis (prove free pipeline economics)
- [ ] Documentation (optimization playbook)

**Deliverable:** Production-ready system

---

## 10. Success Criteria

### Phase 1 (Foundation)
✅ Mathematical model validates 10-30 deal capacity  
✅ Baseline conversion rates established  
✅ Funnel dashboard operational  
✅ Bottlenecks identified with data

### Phase 2 (Intelligence)
✅ All agents operational with >95% uptime  
✅ Lead scoring correlation > 0.6  
✅ Valuation accuracy > 90%  
✅ Decision latency < 5 seconds per lead

### Phase 3 (Experimentation)
✅ First experiment shows >20% lift in open rate  
✅ Thompson sampling allocates traffic correctly  
✅ Statistical significance tests working

### Phase 4 (Meta-Layer)
✅ System detects bottlenecks automatically  
✅ Feedback loops update models weekly  
✅ Performance dashboard shows real-time metrics

### Phase 5 (Scale)
✅ System processes 1,000+ leads/day  
✅ Conversion rate > 2%  
✅ Cost per deal < $50  
✅ 10-30 deals from single campaign (proven)

---

## 11. Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Agent execution failure | Retry logic, circuit breakers, fallback to defaults |
| Database performance | Indexes on hot paths, connection pooling, read replicas |
| Queue saturation | Rate limiting, priority queues, auto-scaling workers |
| Model drift | Weekly retraining, monitoring calibration error, A/B test new models |

### Business Risks

| Risk | Mitigation |
|------|------------|
| Insufficient lead volume | Multi-jurisdiction lead finder, multiple sources |
| Low conversion despite optimizations | Manual review of failed deals, strategy adjustment |
| Buyer network gaps | Pre-seed buyer coverage, referral partnerships |
| Compliance violations | Legal review of all messages, opt-out enforcement, DNC checks |

---

## 12. Appendix

### A. Technology Stack

- **Backend:** Node.js/TypeScript (existing)
- **Database:** PostgreSQL (existing)
- **Queue:** BullMQ + Redis
- **ML:** Python (scikit-learn, XGBoost)
- **Frontend:** Next.js (existing)
- **Monitoring:** Prometheus + Grafana
- **Logging:** Structured JSON logs

### B. API Endpoints

```
POST   /api/leads/process           # Trigger agent pipeline
GET    /api/leads/:id/decision      # Get decision for lead
GET    /api/leads/:id/agents        # Get agent outputs

GET    /api/actions/queue           # Priority queue
POST   /api/actions/:id/execute     # Execute action

GET    /api/experiments             # List experiments
POST   /api/experiments             # Create experiment
GET    /api/experiments/:id/results # Get results

GET    /api/metrics/pipeline        # Pipeline metrics
GET    /api/metrics/agents          # Agent performance
GET    /api/metrics/valuation       # Valuation diagnostics
```

### C. Configuration

```typescript
// config/agents.ts
export const AGENT_CONFIG = {
  leadScoring: {
    weights: {
      distress: 0.4,
      recency: 0.3,
      equity: 0.2,
      geoLiquidity: 0.1
    },
    recencyHalfLifeDays: 14
  },
  
  valuation: {
    compSearchRadius: 1.0,  // miles
    compMaxAge: 90,  // days
    arvMultiplier: 0.70,  // 70% rule
    wholesaleFee: 10000  // $10k
  },
  
  negotiation: {
    strategies: {
      highMotivation: { type: 'fast_close', priceMultiplier: 1.0 },
      mediumMotivation: { type: 'anchored', priceMultiplier: 0.9 },
      lowMotivation: { type: 'nurture', priceMultiplier: 0.8 }
    }
  }
};
```

---

## Conclusion

This design transforms the DealFlow AI pipeline from a functional system into a **high-precision, self-optimizing deal acquisition engine**. The multi-agent architecture, combined with expected value optimization and continuous learning, creates a system that:

1. **Compounds over time** (feedback loops improve models)
2. **Allocates resources optimally** (action-first, not lead-first)
3. **Adapts to market conditions** (experimentation engine)
4. **Proves capacity mathematically** (24x improvement pathway)

**Next Step:** Begin Sprint 1 (Foundation) implementation.
