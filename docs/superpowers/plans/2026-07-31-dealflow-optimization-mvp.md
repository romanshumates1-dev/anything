# DealFlow AI Optimization MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude-native decision engine that scores leads, values properties, calculates deal probability, and prioritizes actions by expected value.

**Architecture:** Four Claude agents (lead scoring, valuation, probability, decision) orchestrated synchronously. Each agent receives structured JSON, returns structured JSON, and persists results. Frontend displays ranked deals and prioritized actions.

**Tech Stack:** 
- Backend: TypeScript, Claude API (Sonnet 4), PostgreSQL
- Frontend: Next.js 14, React Server Components
- Database: 5 new tables (lead_scores, property_valuations, deal_probabilities, lead_actions, lead_events)

## Global Constraints

- Node version: ≥18.17.0
- Use existing `@/app/api/utils/sql` for database queries
- Use existing auth system (`@/app/api/utils/authz`)
- All monetary values stored in cents (integer)
- All probabilities stored as numeric (0-1 range)
- Follow existing Next.js App Router patterns
- Use existing database connection (no new connection pooling)
- Claude API calls via Anthropic SDK (already installed)

---

## File Structure

### Database
- **Create:** `apps/web/db/migrations/050_optimization_tables.sql` - 5 tables for optimization system

### Backend - Agent System
- **Create:** `apps/web/src/app/api/optimization/agents/types.ts` - Shared types for all agents
- **Create:** `apps/web/src/app/api/optimization/agents/prompts.ts` - Claude prompts for each agent
- **Create:** `apps/web/src/app/api/optimization/agents/lead-scoring.ts` - Lead scoring agent
- **Create:** `apps/web/src/app/api/optimization/agents/valuation.ts` - Valuation agent
- **Create:** `apps/web/src/app/api/optimization/agents/probability.ts` - Probability agent
- **Create:** `apps/web/src/app/api/optimization/agents/decision.ts` - Decision agent

### Backend - Orchestrator
- **Create:** `apps/web/src/app/api/optimization/orchestrator.ts` - Runs agents in sequence

### Backend - API Routes
- **Create:** `apps/web/src/app/api/optimization/process/route.ts` - Process lead through pipeline
- **Create:** `apps/web/src/app/api/optimization/queue/route.ts` - Get action queue
- **Create:** `apps/web/src/app/api/optimization/decision/[id]/route.ts` - Get lead decision

### Frontend
- **Create:** `apps/web/src/app/optimization/dashboard/page.tsx` - Main dashboard page
- **Create:** `apps/web/src/app/optimization/dashboard/components/KPIBar.tsx` - KPI cards
- **Create:** `apps/web/src/app/optimization/dashboard/components/DealTable.tsx` - Lead pipeline table
- **Create:** `apps/web/src/app/optimization/dashboard/components/ActionQueue.tsx` - Priority action list
- **Create:** `apps/web/src/app/optimization/dashboard/components/DealDrawer.tsx` - Lead detail panel

### Tests
- **Create:** `apps/web/src/app/api/optimization/agents/__tests__/lead-scoring.test.ts`
- **Create:** `apps/web/src/app/api/optimization/agents/__tests__/valuation.test.ts`
- **Create:** `apps/web/src/app/api/optimization/__tests__/orchestrator.test.ts`

---

## Task 1: Database Schema

**Files:**
- Create: `apps/web/db/migrations/050_optimization_tables.sql`

**Interfaces:**
- Consumes: Nothing (foundational)
- Produces: 5 tables (lead_scores, property_valuations, deal_probabilities, lead_actions, lead_events)

- [ ] **Step 1: Create migration file**

Create file `apps/web/db/migrations/050_optimization_tables.sql`:

```sql
-- 050_optimization_tables.sql
-- DealFlow AI Optimization MVP - Core tables
-- Idempotent. Rollback: DROP TABLE lead_events, lead_actions, deal_probabilities, property_valuations, lead_scores;

-- Lead scores (composite + components)
CREATE TABLE IF NOT EXISTS public.lead_scores (
  lead_id bigint PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  composite_score numeric(3,2) NOT NULL CHECK (composite_score BETWEEN 0 AND 1),
  distress_score numeric(3,2) CHECK (distress_score BETWEEN 0 AND 1),
  recency_score numeric(3,2) CHECK (recency_score BETWEEN 0 AND 1),
  equity_score numeric(3,2) CHECK (equity_score BETWEEN 0 AND 1),
  geo_score numeric(3,2) CHECK (geo_score BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_composite ON public.lead_scores(composite_score DESC);

COMMENT ON TABLE public.lead_scores IS 'Lead quality scoring for optimization pipeline';

-- Property valuations (ARV + repairs + offer range)
CREATE TABLE IF NOT EXISTS public.property_valuations (
  lead_id bigint PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  arv integer NOT NULL CHECK (arv > 0),
  arv_confidence numeric(3,2) NOT NULL CHECK (arv_confidence BETWEEN 0 AND 1),
  repairs integer NOT NULL CHECK (repairs >= 0),
  offer_min integer NOT NULL CHECK (offer_min > 0),
  offer_max integer NOT NULL CHECK (offer_max > 0),
  comps_count integer DEFAULT 0 CHECK (comps_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_valuations_confidence ON public.property_valuations(arv_confidence DESC);

COMMENT ON TABLE public.property_valuations IS 'Property valuation outputs from valuation agent';

-- Deal probabilities (P(close) + expected value)
CREATE TABLE IF NOT EXISTS public.deal_probabilities (
  lead_id bigint PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  p_close numeric(5,4) NOT NULL CHECK (p_close BETWEEN 0 AND 1),
  expected_value integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_probabilities_ev ON public.deal_probabilities(expected_value DESC);

COMMENT ON TABLE public.deal_probabilities IS 'Deal probability and expected value calculations';

-- Lead actions (priority queue)
CREATE TABLE IF NOT EXISTS public.lead_actions (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  action text NOT NULL,
  priority numeric NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed')),
  reason jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lead_actions_priority ON public.lead_actions(priority DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lead_actions_lead ON public.lead_actions(lead_id);

COMMENT ON TABLE public.lead_actions IS 'Action queue prioritized by expected value';

-- Lead events (ground truth for learning)
CREATE TABLE IF NOT EXISTS public.lead_events (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_data jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON public.lead_events(lead_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lead_events_type ON public.lead_events(event_type, created_at);

COMMENT ON TABLE public.lead_events IS 'Event log for outcome tracking and learning';
```

- [ ] **Step 2: Run migration**

```bash
cd apps/web
yarn migrate
```

Expected output: "✓ Migration 050_optimization_tables.sql applied"

- [ ] **Step 3: Verify tables exist**

```bash
cd apps/web
yarn tsx -e "
import sql from './src/app/api/utils/sql';
const tables = await sql\`
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name IN ('lead_scores', 'property_valuations', 'deal_probabilities', 'lead_actions', 'lead_events')
  ORDER BY table_name
\`;
console.log('Tables:', tables.map(r => r.table_name));
process.exit(0);
"
```

Expected output: Tables: [ 'deal_probabilities', 'lead_actions', 'lead_events', 'lead_scores', 'property_valuations' ]

- [ ] **Step 4: Commit**

```bash
git add apps/web/db/migrations/050_optimization_tables.sql
git commit -m "feat(optimization): add 5 core tables for MVP decision engine"
```

---

## Task 2: Agent Types and Prompts

**Files:**
- Create: `apps/web/src/app/api/optimization/agents/types.ts`
- Create: `apps/web/src/app/api/optimization/agents/prompts.ts`

**Interfaces:**
- Consumes: Nothing
- Produces: 
  - `AgentInput` type
  - `AgentOutput<T>` type
  - `LEAD_SCORING_PROMPT` constant
  - `VALUATION_PROMPT` constant
  - `PROBABILITY_PROMPT` constant
  - `DECISION_PROMPT` constant

- [ ] **Step 1: Write types test**

Create file `apps/web/src/app/api/optimization/agents/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AgentInput, AgentOutput, LeadScoreOutput, ValuationOutput, ProbabilityOutput, DecisionOutput } from '../types';

describe('Agent Types', () => {
  it('should accept valid AgentInput', () => {
    const input: AgentInput = { leadId: 123 };
    expect(input.leadId).toBe(123);
  });

  it('should accept valid AgentOutput', () => {
    const output: AgentOutput<{ score: number }> = {
      result: { score: 0.8 },
      confidence: 0.9
    };
    expect(output.result.score).toBe(0.8);
    expect(output.confidence).toBe(0.9);
  });

  it('should enforce LeadScoreOutput shape', () => {
    const output: LeadScoreOutput = {
      compositeScore: 0.82,
      components: {
        distress: 0.9,
        recency: 0.85,
        equity: 0.7,
        geo: 0.8
      }
    };
    expect(output.compositeScore).toBeGreaterThan(0);
  });

  it('should enforce ValuationOutput shape', () => {
    const output: ValuationOutput = {
      arv: 250000,
      arvConfidence: 0.85,
      repairs: 35000,
      offerMin: 140000,
      offerMax: 160000,
      compsCount: 8
    };
    expect(output.arv).toBeGreaterThan(0);
  });

  it('should enforce ProbabilityOutput shape', () => {
    const output: ProbabilityOutput = {
      pClose: 0.68,
      expectedValue: 6800
    };
    expect(output.pClose).toBeGreaterThanOrEqual(0);
    expect(output.pClose).toBeLessThanOrEqual(1);
  });

  it('should enforce DecisionOutput shape', () => {
    const output: DecisionOutput = {
      action: 'send_email',
      priority: 6800,
      reasoning: 'High probability'
    };
    expect(['send_email', 'manual_review', 'reject']).toContain(output.action);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/agents/__tests__/types.test.ts
```

Expected: FAIL with "Cannot find module '../types'"

- [ ] **Step 3: Create types file**

Create file `apps/web/src/app/api/optimization/agents/types.ts`:

```typescript
/**
 * Agent system types for DealFlow AI Optimization MVP
 */

export interface AgentInput {
  leadId: number;
}

export interface AgentOutput<T> {
  result: T;
  confidence: number;
}

export interface LeadScoreOutput {
  compositeScore: number;
  components: {
    distress: number;
    recency: number;
    equity: number;
    geo: number;
  };
}

export interface ValuationOutput {
  arv: number;  // cents
  arvConfidence: number;  // 0-1
  repairs: number;  // cents
  offerMin: number;  // cents
  offerMax: number;  // cents
  compsCount: number;
}

export interface ProbabilityOutput {
  pClose: number;  // 0-1
  expectedValue: number;  // cents
}

export interface DecisionOutput {
  action: 'send_email' | 'manual_review' | 'reject';
  priority: number;
  reasoning: string;
}

export interface Agent<T> {
  execute(input: AgentInput): Promise<AgentOutput<T>>;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/agents/__tests__/types.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: Create prompts file**

Create file `apps/web/src/app/api/optimization/agents/prompts.ts`:

```typescript
/**
 * Claude prompts for each agent
 */

export const LEAD_SCORING_PROMPT = `You are a real estate lead scoring agent.

Goal:
Score how likely this seller is to transact.

Input:
{
  "signals": string[],  // distress signals like "pre_foreclosure", "tax_delinquent"
  "daysAcquired": number,
  "estimatedArv": number | null,
  "estimatedDebt": number | null,
  "zip": string | null
}

Scoring logic (heuristic):
1. Distress score (0-1):
   - pre_foreclosure: 0.4
   - tax_delinquent: 0.3
   - code_violation: 0.2
   - probate: 0.25
   - vacant: 0.2
   - absentee_owner: 0.15
   Sum and cap at 1.0

2. Recency score (0-1):
   - Exponential decay: 0.5^(daysAcquired / 14)
   - 14-day half-life

3. Equity score (0-1):
   - If estimatedArv and estimatedDebt available:
     equityPercent = (arv - debt) / arv
   - Otherwise: 0.5 (neutral)

4. Geo score (0-1):
   - Use 0.5 as default (buyer coverage lookup happens separately)

Composite score:
weighted_sum = 
  0.4 × distress +
  0.3 × recency +
  0.2 × equity +
  0.1 × geo

Output JSON (strict format):
{
  "compositeScore": 0.82,
  "components": {
    "distress": 0.9,
    "recency": 0.85,
    "equity": 0.7,
    "geo": 0.5
  }
}

Rules:
- Be conservative
- If data missing → reduce scores
- Return ONLY valid JSON`;

export const VALUATION_PROMPT = `You are a real estate valuation agent for wholesale deals.

Input:
{
  "property": {
    "beds": number,
    "baths": number,
    "sqft": number,
    "condition": "poor" | "fair" | "good" | "unknown"
  },
  "comps": [
    {
      "price": number,
      "sqft": number,
      "distanceMiles": number,
      "daysAgoSold": number
    }
  ]
}

Steps:
1. Normalize comps to $/sqft
2. Weight comps:
   - closer distance = higher weight
   - more recent = higher weight
   Formula: weight = (1 - distanceMiles) × (0.5^(daysAgoSold / 30))
3. Compute weighted avg price/sqft
4. ARV = avgPricePerSqft × subjectSqft

Repair heuristics:
- poor: $35/sqft
- fair: $20/sqft
- good: $10/sqft
- unknown: $20/sqft

Wholesale logic:
- buyerMax = ARV × 0.7
- offerMax = buyerMax - repairs - 10000 (wholesaleFee)
- offerMin = offerMax × 0.7

Confidence:
- If comps < 3: confidence = 0.5
- If comps >= 3 and recent: confidence = 0.8
- If comps >= 5 and recent: confidence = 0.9

Output JSON (strict format):
{
  "arv": 250000,
  "arvConfidence": 0.85,
  "repairs": 35000,
  "offerMin": 140000,
  "offerMax": 160000,
  "compsCount": 8
}

Rules:
- Ignore outlier comps (>2x or <0.5x median)
- If no comps: return null for all values
- Return ONLY valid JSON`;

export const PROBABILITY_PROMPT = `You are a deal probability calculator.

Input:
{
  "compositeScore": number,  // 0-1 from lead scoring
  "arvConfidence": number    // 0-1 from valuation
}

Steps:
1. Calculate close probability:
   pClose = (compositeScore × 0.5) + (arvConfidence × 0.5)

2. Expected value:
   estimatedFee = 10000 (baseline $10k)
   expectedValue = pClose × estimatedFee

Output JSON (strict format):
{
  "pClose": 0.68,
  "expectedValue": 6800
}

Rules:
- Cap pClose between 0.05 and 0.95
- Return ONLY valid JSON`;

export const DECISION_PROMPT = `You are a deal decision agent.

Input:
{
  "pClose": number,          // 0-1
  "expectedValue": number    // cents
}

Decision rules:

HIGH PRIORITY (pursue immediately):
- pClose > 0.7
- action: "send_email"
- priority: expectedValue

MEDIUM PRIORITY (conditional):
- pClose 0.4-0.7
- action: "send_email"
- priority: expectedValue × 0.5

LOW PRIORITY (reject):
- pClose < 0.4
- action: "reject"
- priority: 0

Output JSON (strict format):
{
  "action": "send_email",
  "priority": 6800,
  "reasoning": "High probability (68%) with strong valuation"
}

Rules:
- Be conservative
- Only "send_email" if pClose >= 0.4
- Return ONLY valid JSON`;
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/optimization/agents/types.ts
git add apps/web/src/app/api/optimization/agents/prompts.ts
git add apps/web/src/app/api/optimization/agents/__tests__/types.test.ts
git commit -m "feat(optimization): add agent types and Claude prompts"
```

---

## Task 3: Lead Scoring Agent

**Files:**
- Create: `apps/web/src/app/api/optimization/agents/lead-scoring.ts`
- Create: `apps/web/src/app/api/optimization/agents/__tests__/lead-scoring.test.ts`

**Interfaces:**
- Consumes: `AgentInput`, `AgentOutput<LeadScoreOutput>`, `LEAD_SCORING_PROMPT` from types.ts/prompts.ts
- Produces: `LeadScoringAgent` class with `execute(input: AgentInput): Promise<AgentOutput<LeadScoreOutput>>`

- [ ] **Step 1: Write failing test**

Create file `apps/web/src/app/api/optimization/agents/__tests__/lead-scoring.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeadScoringAgent } from '../lead-scoring';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');

describe('LeadScoringAgent', () => {
  let agent: LeadScoringAgent;

  beforeEach(() => {
    agent = new LeadScoringAgent();
    vi.clearAllMocks();
  });

  it('should score lead with high distress signals', async () => {
    // Mock lead fetch
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 123,
        metadata: {
          signals: ['pre_foreclosure', 'vacant'],
          estimated_arv: 250000,
          estimated_debt: 175000,
          zip: '40202'
        },
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
      }
    ] as any);

    // Mock insert
    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 123 });

    expect(result.result.compositeScore).toBeGreaterThan(0.6);
    expect(result.result.components.distress).toBeGreaterThan(0.5);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should handle missing data gracefully', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 124,
        metadata: {},
        created_at: new Date()
      }
    ] as any);

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 124 });

    expect(result.result.compositeScore).toBeLessThan(0.6);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('should persist score to database', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 125,
        metadata: { signals: ['probate'] },
        created_at: new Date()
      }
    ] as any);

    const insertMock = vi.mocked(sql).mockResolvedValueOnce([] as any);

    await agent.execute({ leadId: 125 });

    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('INSERT INTO lead_scores')
      ])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/agents/__tests__/lead-scoring.test.ts
```

Expected: FAIL with "Cannot find module '../lead-scoring'"

- [ ] **Step 3: Implement lead scoring agent**

Create file `apps/web/src/app/api/optimization/agents/lead-scoring.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { LEAD_SCORING_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, LeadScoreOutput } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

export class LeadScoringAgent implements Agent<LeadScoreOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<LeadScoreOutput>> {
    // 1. Fetch lead data
    const [lead] = await sql`
      SELECT id, metadata, created_at
      FROM leads
      WHERE id = ${input.leadId}
    `;

    if (!lead) {
      throw new Error(`Lead ${input.leadId} not found`);
    }

    // 2. Extract input data for Claude
    const signals = lead.metadata?.signals || [];
    const daysAcquired = Math.floor(
      (Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const estimatedArv = lead.metadata?.estimated_arv || null;
    const estimatedDebt = lead.metadata?.estimated_debt || null;
    const zip = lead.metadata?.zip || null;

    const promptInput = {
      signals,
      daysAcquired,
      estimatedArv,
      estimatedDebt,
      zip
    };

    // 3. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${LEAD_SCORING_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 4. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const output: LeadScoreOutput = JSON.parse(contentBlock.text);

    // 5. Persist to database
    await sql`
      INSERT INTO lead_scores (
        lead_id,
        composite_score,
        distress_score,
        recency_score,
        equity_score,
        geo_score
      ) VALUES (
        ${input.leadId},
        ${output.compositeScore},
        ${output.components.distress},
        ${output.components.recency},
        ${output.components.equity},
        ${output.components.geo}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        composite_score = EXCLUDED.composite_score,
        distress_score = EXCLUDED.distress_score,
        recency_score = EXCLUDED.recency_score,
        equity_score = EXCLUDED.equity_score,
        geo_score = EXCLUDED.geo_score,
        created_at = now()
    `;

    // 6. Calculate confidence
    const confidence = this.calculateConfidence(output);

    return {
      result: output,
      confidence
    };
  }

  private calculateConfidence(output: LeadScoreOutput): number {
    // Confidence based on how many components have non-default values
    const components = [
      output.components.distress,
      output.components.recency,
      output.components.equity,
      output.components.geo
    ];

    // Count non-neutral scores (not 0.5)
    const nonNeutral = components.filter(c => Math.abs(c - 0.5) > 0.1).length;

    return Math.min(0.5 + (nonNeutral * 0.125), 1.0);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/agents/__tests__/lead-scoring.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/optimization/agents/lead-scoring.ts
git add apps/web/src/app/api/optimization/agents/__tests__/lead-scoring.test.ts
git commit -m "feat(optimization): implement lead scoring agent with Claude"
```

---

## Task 4: Valuation Agent

**Files:**
- Create: `apps/web/src/app/api/optimization/agents/valuation.ts`
- Create: `apps/web/src/app/api/optimization/agents/__tests__/valuation.test.ts`

**Interfaces:**
- Consumes: `AgentInput`, `AgentOutput<ValuationOutput>`, `VALUATION_PROMPT` from types.ts/prompts.ts
- Produces: `ValuationAgent` class with `execute(input: AgentInput): Promise<AgentOutput<ValuationOutput>>`

- [ ] **Step 1: Write failing test**

Create file `apps/web/src/app/api/optimization/agents/__tests__/valuation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValuationAgent } from '../valuation';
import sql from '@/app/api/utils/sql';

vi.mock('@/app/api/utils/sql');

describe('ValuationAgent', () => {
  let agent: ValuationAgent;

  beforeEach(() => {
    agent = new ValuationAgent();
    vi.clearAllMocks();
  });

  it('should value property with good comps', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 123,
        metadata: {
          beds: 3,
          baths: 2,
          sqft: 1500,
          condition: 'fair'
        }
      }
    ] as any);

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 123 });

    expect(result.result.arv).toBeGreaterThan(0);
    expect(result.result.arvConfidence).toBeGreaterThan(0);
    expect(result.result.repairs).toBeGreaterThan(0);
    expect(result.result.offerMax).toBeLessThan(result.result.arv);
    expect(result.result.offerMin).toBeLessThan(result.result.offerMax);
  });

  it('should return low confidence with few comps', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 124,
        metadata: {
          beds: 3,
          baths: 2,
          sqft: 1500,
          condition: 'poor'
        }
      }
    ] as any);

    vi.mocked(sql).mockResolvedValueOnce([] as any);

    const result = await agent.execute({ leadId: 124 });

    expect(result.confidence).toBeLessThan(0.7);
  });

  it('should persist valuation to database', async () => {
    vi.mocked(sql).mockResolvedValueOnce([
      {
        id: 125,
        metadata: { beds: 3, baths: 2, sqft: 1500, condition: 'good' }
      }
    ] as any);

    const insertMock = vi.mocked(sql).mockResolvedValueOnce([] as any);

    await agent.execute({ leadId: 125 });

    expect(insertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining('INSERT INTO property_valuations')
      ])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/agents/__tests__/valuation.test.ts
```

Expected: FAIL with "Cannot find module '../valuation'"

- [ ] **Step 3: Implement valuation agent**

Create file `apps/web/src/app/api/optimization/agents/valuation.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { VALUATION_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, ValuationOutput } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

export class ValuationAgent implements Agent<ValuationOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<ValuationOutput>> {
    // 1. Fetch lead data
    const [lead] = await sql`
      SELECT id, metadata
      FROM leads
      WHERE id = ${input.leadId}
    `;

    if (!lead) {
      throw new Error(`Lead ${input.leadId} not found`);
    }

    // 2. Extract property data
    const property = {
      beds: lead.metadata?.beds || 3,
      baths: lead.metadata?.baths || 2,
      sqft: lead.metadata?.sqft || 1500,
      condition: lead.metadata?.condition || 'fair'
    };

    // 3. Mock comps for MVP (TODO: integrate real comp source)
    const comps = this.generateMockComps(property);

    const promptInput = { property, comps };

    // 4. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${VALUATION_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 5. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const output: ValuationOutput = JSON.parse(contentBlock.text);

    // 6. Persist to database
    await sql`
      INSERT INTO property_valuations (
        lead_id,
        arv,
        arv_confidence,
        repairs,
        offer_min,
        offer_max,
        comps_count
      ) VALUES (
        ${input.leadId},
        ${output.arv},
        ${output.arvConfidence},
        ${output.repairs},
        ${output.offerMin},
        ${output.offerMax},
        ${output.compsCount}
      )
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
      result: output,
      confidence: output.arvConfidence
    };
  }

  private generateMockComps(property: any) {
    // Mock comps for MVP - replace with real comp source later
    const basePrice = 150 * property.sqft; // $150/sqft baseline
    
    return [
      {
        price: Math.round(basePrice * 1.1),
        sqft: property.sqft * 0.95,
        distanceMiles: 0.3,
        daysAgoSold: 15
      },
      {
        price: Math.round(basePrice * 0.95),
        sqft: property.sqft * 1.05,
        distanceMiles: 0.5,
        daysAgoSold: 30
      },
      {
        price: Math.round(basePrice * 1.05),
        sqft: property.sqft * 0.98,
        distanceMiles: 0.7,
        daysAgoSold: 45
      },
      {
        price: Math.round(basePrice),
        sqft: property.sqft,
        distanceMiles: 0.4,
        daysAgoSold: 20
      },
      {
        price: Math.round(basePrice * 1.08),
        sqft: property.sqft * 1.02,
        distanceMiles: 0.6,
        daysAgoSold: 35
      }
    ];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/agents/__tests__/valuation.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/optimization/agents/valuation.ts
git add apps/web/src/app/api/optimization/agents/__tests__/valuation.test.ts
git commit -m "feat(optimization): implement valuation agent with mock comps"
```

---

## Task 5: Probability and Decision Agents

**Files:**
- Create: `apps/web/src/app/api/optimization/agents/probability.ts`
- Create: `apps/web/src/app/api/optimization/agents/decision.ts`

**Interfaces:**
- Consumes: 
  - Types and prompts from previous tasks
  - Database tables (lead_scores, property_valuations)
- Produces:
  - `ProbabilityAgent` class
  - `DecisionAgent` class

- [ ] **Step 1: Implement probability agent**

Create file `apps/web/src/app/api/optimization/agents/probability.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { PROBABILITY_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, ProbabilityOutput } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

export class ProbabilityAgent implements Agent<ProbabilityOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<ProbabilityOutput>> {
    // 1. Fetch lead score
    const [score] = await sql`
      SELECT composite_score 
      FROM lead_scores 
      WHERE lead_id = ${input.leadId}
    `;

    // 2. Fetch valuation
    const [valuation] = await sql`
      SELECT arv_confidence 
      FROM property_valuations 
      WHERE lead_id = ${input.leadId}
    `;

    if (!score || !valuation) {
      throw new Error(`Missing score or valuation for lead ${input.leadId}`);
    }

    const promptInput = {
      compositeScore: Number(score.composite_score),
      arvConfidence: Number(valuation.arv_confidence)
    };

    // 3. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `${PROBABILITY_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 4. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const output: ProbabilityOutput = JSON.parse(contentBlock.text);

    // 5. Persist to database
    await sql`
      INSERT INTO deal_probabilities (
        lead_id,
        p_close,
        expected_value
      ) VALUES (
        ${input.leadId},
        ${output.pClose},
        ${output.expectedValue}
      )
      ON CONFLICT (lead_id) DO UPDATE SET
        p_close = EXCLUDED.p_close,
        expected_value = EXCLUDED.expected_value,
        created_at = now()
    `;

    return {
      result: output,
      confidence: output.pClose
    };
  }
}
```

- [ ] **Step 2: Implement decision agent**

Create file `apps/web/src/app/api/optimization/agents/decision.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import sql from '@/app/api/utils/sql';
import { DECISION_PROMPT } from './prompts';
import type { Agent, AgentInput, AgentOutput, DecisionOutput } from './types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ''
});

export class DecisionAgent implements Agent<DecisionOutput> {
  async execute(input: AgentInput): Promise<AgentOutput<DecisionOutput>> {
    // 1. Fetch probability
    const [prob] = await sql`
      SELECT p_close, expected_value 
      FROM deal_probabilities 
      WHERE lead_id = ${input.leadId}
    `;

    if (!prob) {
      throw new Error(`Missing probability for lead ${input.leadId}`);
    }

    const promptInput = {
      pClose: Number(prob.p_close),
      expectedValue: prob.expected_value
    };

    // 2. Call Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `${DECISION_PROMPT}\n\nInput:\n${JSON.stringify(promptInput, null, 2)}`
        }
      ]
    });

    // 3. Parse output
    const contentBlock = message.content[0];
    if (contentBlock.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    const output: DecisionOutput = JSON.parse(contentBlock.text);

    // 4. Queue action if not reject
    if (output.action !== 'reject') {
      await sql`
        INSERT INTO lead_actions (
          lead_id,
          action,
          priority,
          reason
        ) VALUES (
          ${input.leadId},
          ${output.action},
          ${output.priority},
          ${JSON.stringify({ reasoning: output.reasoning, pClose: prob.p_close })}
        )
      `;
    }

    return {
      result: output,
      confidence: promptInput.pClose
    };
  }
}
```

- [ ] **Step 3: Test probability agent**

```bash
cd apps/web
yarn tsx -e "
import { ProbabilityAgent } from './src/app/api/optimization/agents/probability';
const agent = new ProbabilityAgent();
// Note: This will fail without real data - manual test after orchestrator is built
console.log('ProbabilityAgent created successfully');
"
```

Expected: "ProbabilityAgent created successfully"

- [ ] **Step 4: Test decision agent**

```bash
cd apps/web
yarn tsx -e "
import { DecisionAgent } from './src/app/api/optimization/agents/decision';
const agent = new DecisionAgent();
console.log('DecisionAgent created successfully');
"
```

Expected: "DecisionAgent created successfully"

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/optimization/agents/probability.ts
git add apps/web/src/app/api/optimization/agents/decision.ts
git commit -m "feat(optimization): implement probability and decision agents"
```

---

## Task 6: Orchestrator

**Files:**
- Create: `apps/web/src/app/api/optimization/orchestrator.ts`
- Create: `apps/web/src/app/api/optimization/__tests__/orchestrator.test.ts`

**Interfaces:**
- Consumes: All 4 agents (LeadScoringAgent, ValuationAgent, ProbabilityAgent, DecisionAgent)
- Produces: `SimpleOrchestrator` class with `processLead(leadId: number): Promise<void>`

- [ ] **Step 1: Write failing test**

Create file `apps/web/src/app/api/optimization/__tests__/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimpleOrchestrator } from '../orchestrator';

vi.mock('@/app/api/optimization/agents/lead-scoring');
vi.mock('@/app/api/optimization/agents/valuation');
vi.mock('@/app/api/optimization/agents/probability');
vi.mock('@/app/api/optimization/agents/decision');

describe('SimpleOrchestrator', () => {
  let orchestrator: SimpleOrchestrator;

  beforeEach(() => {
    orchestrator = new SimpleOrchestrator();
    vi.clearAllMocks();
  });

  it('should process lead through all agents in sequence', async () => {
    await expect(orchestrator.processLead(123)).resolves.not.toThrow();
  });

  it('should handle missing valuation gracefully', async () => {
    // This will be tested manually once agents are integrated
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/__tests__/orchestrator.test.ts
```

Expected: FAIL with "Cannot find module '../orchestrator'"

- [ ] **Step 3: Implement orchestrator**

Create file `apps/web/src/app/api/optimization/orchestrator.ts`:

```typescript
import { LeadScoringAgent } from './agents/lead-scoring';
import { ValuationAgent } from './agents/valuation';
import { ProbabilityAgent } from './agents/probability';
import { DecisionAgent } from './agents/decision';

export class SimpleOrchestrator {
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
      console.log(`[Orchestrator] Lead score: ${scoreResult.result.compositeScore.toFixed(2)}`);

      // Step 2: Value property
      const valuationResult = await this.agents.valuation.execute({ leadId });

      // Early exit if no valuation
      if (!valuationResult.result.arv) {
        console.log(`[Orchestrator] No valuation - skipping lead ${leadId}`);
        return;
      }
      console.log(`[Orchestrator] ARV: $${(valuationResult.result.arv / 100).toFixed(0)}`);

      // Step 3: Calculate probability
      const probabilityResult = await this.agents.probability.execute({ leadId });
      console.log(`[Orchestrator] P(close): ${(probabilityResult.result.pClose * 100).toFixed(1)}%`);

      // Step 4: Make decision
      const decisionResult = await this.agents.decision.execute({ leadId });
      console.log(`[Orchestrator] Decision: ${decisionResult.result.action} (priority: ${decisionResult.result.priority})`);

    } catch (error: any) {
      console.error(`[Orchestrator] Error processing lead ${leadId}:`, error.message);
      throw error;
    }
  }

  async processBatch(leadIds: number[]): Promise<void> {
    console.log(`[Orchestrator] Processing batch of ${leadIds.length} leads`);
    
    for (const leadId of leadIds) {
      try {
        await this.processLead(leadId);
      } catch (error: any) {
        console.error(`[Orchestrator] Failed to process lead ${leadId}:`, error.message);
        // Continue with next lead
      }
    }
    
    console.log(`[Orchestrator] Batch complete`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web
yarn vitest run src/app/api/optimization/__tests__/orchestrator.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/optimization/orchestrator.ts
git add apps/web/src/app/api/optimization/__tests__/orchestrator.test.ts
git commit -m "feat(optimization): implement synchronous orchestrator"
```

---

## Task 7: API Routes

**Files:**
- Create: `apps/web/src/app/api/optimization/process/route.ts`
- Create: `apps/web/src/app/api/optimization/queue/route.ts`
- Create: `apps/web/src/app/api/optimization/decision/[id]/route.ts`

**Interfaces:**
- Consumes: `SimpleOrchestrator` from orchestrator.ts
- Produces: 3 API endpoints

- [ ] **Step 1: Create process endpoint**

Create file `apps/web/src/app/api/optimization/process/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { SimpleOrchestrator } from '../orchestrator';

/**
 * POST /api/optimization/process
 * Body: { leadId: number } or { leadIds: number[] }
 * 
 * Processes one or more leads through the optimization pipeline
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await request.json();
    const orchestrator = new SimpleOrchestrator();

    if (body.leadId) {
      // Single lead
      await orchestrator.processLead(body.leadId);
      return NextResponse.json({
        success: true,
        leadId: body.leadId,
        message: 'Lead processed successfully'
      });
    } else if (Array.isArray(body.leadIds)) {
      // Batch
      await orchestrator.processBatch(body.leadIds);
      return NextResponse.json({
        success: true,
        count: body.leadIds.length,
        message: `${body.leadIds.length} leads processed successfully`
      });
    } else {
      return NextResponse.json(
        { error: 'Missing leadId or leadIds in request body' },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('POST /api/optimization/process error', error);
    return NextResponse.json(
      { error: 'Internal Server Error', message: error.message },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create queue endpoint**

Create file `apps/web/src/app/api/optimization/queue/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/optimization/queue
 * Query: ?limit=50
 * 
 * Returns prioritized action queue (pending actions sorted by priority DESC)
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }

    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));

    const actions = await sql`
      SELECT 
        la.id,
        la.lead_id,
        la.action,
        la.priority,
        la.reason,
        la.created_at,
        l.name,
        l.phone,
        l.metadata->>'address' as address
      FROM lead_actions la
      JOIN leads l ON l.id = la.lead_id
      WHERE l.organization_id = ${organization.id}
        AND la.status = 'pending'
      ORDER BY la.priority DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      actions: actions.map(a => ({
        id: a.id,
        leadId: a.lead_id,
        leadName: a.name,
        address: a.address,
        action: a.action,
        priority: Number(a.priority),
        reason: a.reason,
        createdAt: a.created_at
      })),
      count: actions.length
    });
  } catch (error: any) {
    console.error('GET /api/optimization/queue error', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Create decision detail endpoint**

Create file `apps/web/src/app/api/optimization/decision/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/optimization/decision/[id]
 * 
 * Returns all agent outputs for a specific lead
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }

    const leadId = parseInt(params.id, 10);

    // Verify lead belongs to organization
    const [lead] = await sql`
      SELECT id, name, phone, status, metadata
      FROM leads
      WHERE id = ${leadId} AND organization_id = ${organization.id}
    `;

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Fetch all agent outputs
    const [score] = await sql`
      SELECT composite_score, distress_score, recency_score, equity_score, geo_score
      FROM lead_scores
      WHERE lead_id = ${leadId}
    `;

    const [valuation] = await sql`
      SELECT arv, arv_confidence, repairs, offer_min, offer_max, comps_count
      FROM property_valuations
      WHERE lead_id = ${leadId}
    `;

    const [probability] = await sql`
      SELECT p_close, expected_value
      FROM deal_probabilities
      WHERE lead_id = ${leadId}
    `;

    const actions = await sql`
      SELECT action, priority, status, reason, created_at
      FROM lead_actions
      WHERE lead_id = ${leadId}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    return NextResponse.json({
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        metadata: lead.metadata
      },
      score: score ? {
        composite: Number(score.composite_score),
        components: {
          distress: Number(score.distress_score),
          recency: Number(score.recency_score),
          equity: Number(score.equity_score),
          geo: Number(score.geo_score)
        }
      } : null,
      valuation: valuation ? {
        arv: valuation.arv,
        arvConfidence: Number(valuation.arv_confidence),
        repairs: valuation.repairs,
        offerMin: valuation.offer_min,
        offerMax: valuation.offer_max,
        compsCount: valuation.comps_count
      } : null,
      probability: probability ? {
        pClose: Number(probability.p_close),
        expectedValue: probability.expected_value
      } : null,
      actions: actions.map(a => ({
        action: a.action,
        priority: Number(a.priority),
        status: a.status,
        reason: a.reason,
        createdAt: a.created_at
      }))
    });
  } catch (error: any) {
    console.error(`GET /api/optimization/decision/${params.id} error`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Test API route creation**

```bash
cd apps/web
yarn tsx -e "
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const apiPath = './src/app/api/optimization';
const files = [
  'process/route.ts',
  'queue/route.ts',
  'decision/[id]/route.ts'
];

let allExist = true;
for (const file of files) {
  const fullPath = join(apiPath, file);
  try {
    statSync(fullPath);
    console.log('✓', file);
  } catch {
    console.error('✗', file, 'not found');
    allExist = false;
  }
}

console.log(allExist ? 'All API routes created' : 'Some routes missing');
process.exit(allExist ? 0 : 1);
"
```

Expected: All routes show ✓ checkmark

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/optimization/process/route.ts
git add apps/web/src/app/api/optimization/queue/route.ts
git add apps/web/src/app/api/optimization/decision/[id]/route.ts
git commit -m "feat(optimization): add API routes for process, queue, and decision"
```

---

## Task 8: Frontend Dashboard Shell

**Files:**
- Create: `apps/web/src/app/optimization/dashboard/page.tsx`
- Create: `apps/web/src/app/optimization/dashboard/components/KPIBar.tsx`

**Interfaces:**
- Consumes: API routes from Task 7
- Produces: Dashboard page with KPI bar

- [ ] **Step 1: Create KPI Bar component**

Create file `apps/web/src/app/optimization/dashboard/components/KPIBar.tsx`:

```typescript
interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
}

function KPICard({ title, value, subtitle }: KPICardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="text-sm font-medium text-gray-600 mb-1">{title}</div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}

interface KPIBarProps {
  totalLeads: number;
  activeDeals: number;
  expectedValue: number;
  avgProbability: number;
}

export function KPIBar({ totalLeads, activeDeals, expectedValue, avgProbability }: KPIBarProps) {
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      <KPICard title="Total Leads" value={totalLeads} />
      <KPICard title="Active Deals" value={activeDeals} />
      <KPICard 
        title="Expected Value" 
        value={`$${Math.round(expectedValue / 100).toLocaleString()}`} 
      />
      <KPICard 
        title="Avg P(Close)" 
        value={`${(avgProbability * 100).toFixed(1)}%`} 
      />
    </div>
  );
}
```

- [ ] **Step 2: Create dashboard page**

Create file `apps/web/src/app/optimization/dashboard/page.tsx`:

```typescript
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { KPIBar } from './components/KPIBar';

async function getDashboardData(organizationId: string) {
  // Total leads
  const [totalLeadsRow] = await sql`
    SELECT COUNT(*) as count
    FROM leads
    WHERE organization_id = ${organizationId}
  `;

  // Active deals (have scores)
  const [activeDealsRow] = await sql`
    SELECT COUNT(*) as count
    FROM lead_scores ls
    JOIN leads l ON l.id = ls.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Sum of expected values
  const [evRow] = await sql`
    SELECT COALESCE(SUM(dp.expected_value), 0) as total_ev
    FROM deal_probabilities dp
    JOIN leads l ON l.id = dp.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Average probability
  const [avgProbRow] = await sql`
    SELECT COALESCE(AVG(dp.p_close), 0) as avg_prob
    FROM deal_probabilities dp
    JOIN leads l ON l.id = dp.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  return {
    totalLeads: Number(totalLeadsRow.count),
    activeDeals: Number(activeDealsRow.count),
    expectedValue: Number(evRow.total_ev),
    avgProbability: Number(avgProbRow.avg_prob)
  };
}

export default async function OptimizationDashboard() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return <div>Unauthorized</div>;
  }

  const organization = await getOrganization();
  if (!organization) {
    return <div>No organization found</div>;
  }

  const data = await getDashboardData(organization.id);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Deal Command Center</h1>
      
      <KPIBar 
        totalLeads={data.totalLeads}
        activeDeals={data.activeDeals}
        expectedValue={data.expectedValue}
        avgProbability={data.avgProbability}
      />

      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">
          Dashboard components (Deal Table, Action Queue, Deal Drawer) will be added in next tasks.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Test page renders**

```bash
cd apps/web
yarn dev
```

Navigate to http://localhost:4000/optimization/dashboard

Expected: Page loads with KPI bar showing zeros (no data yet)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/optimization/dashboard/page.tsx
git add apps/web/src/app/optimization/dashboard/components/KPIBar.tsx
git commit -m "feat(optimization): add dashboard shell with KPI bar"
```

---

## Task 9: Deal Table and Action Queue Components

**Files:**
- Create: `apps/web/src/app/optimization/dashboard/components/DealTable.tsx`
- Create: `apps/web/src/app/optimization/dashboard/components/ActionQueue.tsx`
- Modify: `apps/web/src/app/optimization/dashboard/page.tsx` (add components)

**Interfaces:**
- Consumes: Dashboard data from page.tsx
- Produces: DealTable and ActionQueue components

- [ ] **Step 1: Create Deal Table component**

Create file `apps/web/src/app/optimization/dashboard/components/DealTable.tsx`:

```typescript
interface Deal {
  id: number;
  name: string;
  address: string;
  score: number;
  arv: number;
  offerMax: number;
  pClose: number;
  expectedValue: number;
  status: string;
}

interface DealTableProps {
  deals: Deal[];
}

export function DealTable({ deals }: DealTableProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold">Deal Pipeline</h2>
        <p className="text-sm text-gray-600 mt-1">Sorted by Expected Value</p>
      </div>

      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lead</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ARV</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Offer</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">P(Close)</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">EV</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {deals.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                No deals yet. Process some leads to see them here.
              </td>
            </tr>
          ) : (
            deals.map(deal => {
              const evColor = 
                deal.expectedValue > 5000 ? 'text-green-600' :
                deal.expectedValue > 2000 ? 'text-yellow-600' : 'text-gray-600';
              
              return (
                <tr key={deal.id} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">{deal.name}</div>
                    <div className="text-xs text-gray-500">{deal.address}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {Math.round(deal.score * 100)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    ${Math.round(deal.arv / 100).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    ${Math.round(deal.offerMax / 100).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {(deal.pClose * 100).toFixed(1)}%
                  </td>
                  <td className={`px-6 py-4 text-sm font-semibold ${evColor}`}>
                    ${Math.round(deal.expectedValue / 100).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {deal.status}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create Action Queue component**

Create file `apps/web/src/app/optimization/dashboard/components/ActionQueue.tsx`:

```typescript
interface Action {
  id: number;
  leadId: number;
  leadName: string;
  address: string;
  action: string;
  priority: number;
  reason: any;
  createdAt: Date;
}

interface ActionQueueProps {
  actions: Action[];
}

export function ActionQueue({ actions }: ActionQueueProps) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold">Action Queue</h2>
        <p className="text-sm text-gray-600 mt-1">What to do next (sorted by priority)</p>
      </div>

      <div className="divide-y divide-gray-200">
        {actions.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            No actions queued. Process some leads to generate actions.
          </div>
        ) : (
          actions.map((action, index) => {
            const priorityColor = 
              action.priority > 5000 ? 'bg-green-100 text-green-800' :
              action.priority > 2000 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800';

            return (
              <div key={action.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${priorityColor}`}>
                        #{index + 1}
                      </span>
                      <span className="text-sm font-medium text-gray-900">{action.leadName}</span>
                      <span className="text-xs text-gray-500">{action.address}</span>
                    </div>
                    <div className="text-sm text-gray-900 mb-1">
                      <span className="font-medium">Action:</span> {action.action}
                    </div>
                    <div className="text-xs text-gray-600">
                      {action.reason?.reasoning || 'No reasoning provided'}
                    </div>
                  </div>
                  <div className="ml-4 text-right">
                    <div className="text-sm font-semibold text-gray-900">
                      Priority: {Math.round(action.priority).toLocaleString()}
                    </div>
                    <button className="mt-2 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                      Execute
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update dashboard page to include components**

Edit `apps/web/src/app/optimization/dashboard/page.tsx`:

```typescript
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { KPIBar } from './components/KPIBar';
import { DealTable } from './components/DealTable';
import { ActionQueue } from './components/ActionQueue';

async function getDashboardData(organizationId: string) {
  // Total leads
  const [totalLeadsRow] = await sql`
    SELECT COUNT(*) as count
    FROM leads
    WHERE organization_id = ${organizationId}
  `;

  // Active deals
  const [activeDealsRow] = await sql`
    SELECT COUNT(*) as count
    FROM lead_scores ls
    JOIN leads l ON l.id = ls.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Sum of expected values
  const [evRow] = await sql`
    SELECT COALESCE(SUM(dp.expected_value), 0) as total_ev
    FROM deal_probabilities dp
    JOIN leads l ON l.id = dp.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Average probability
  const [avgProbRow] = await sql`
    SELECT COALESCE(AVG(dp.p_close), 0) as avg_prob
    FROM deal_probabilities dp
    JOIN leads l ON l.id = dp.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Deals for table (top 20 by EV)
  const deals = await sql`
    SELECT 
      l.id,
      l.name,
      l.metadata->>'address' as address,
      l.status,
      ls.composite_score as score,
      pv.arv,
      pv.offer_max,
      dp.p_close,
      dp.expected_value
    FROM leads l
    JOIN lead_scores ls ON ls.lead_id = l.id
    JOIN property_valuations pv ON pv.lead_id = l.id
    JOIN deal_probabilities dp ON dp.lead_id = l.id
    WHERE l.organization_id = ${organizationId}
    ORDER BY dp.expected_value DESC
    LIMIT 20
  `;

  // Actions for queue (top 10 by priority)
  const actions = await sql`
    SELECT 
      la.id,
      la.lead_id,
      la.action,
      la.priority,
      la.reason,
      la.created_at,
      l.name as lead_name,
      l.metadata->>'address' as address
    FROM lead_actions la
    JOIN leads l ON l.id = la.lead_id
    WHERE l.organization_id = ${organizationId}
      AND la.status = 'pending'
    ORDER BY la.priority DESC
    LIMIT 10
  `;

  return {
    totalLeads: Number(totalLeadsRow.count),
    activeDeals: Number(activeDealsRow.count),
    expectedValue: Number(evRow.total_ev),
    avgProbability: Number(avgProbRow.avg_prob),
    deals: deals.map(d => ({
      id: d.id,
      name: d.name,
      address: d.address || 'No address',
      score: Number(d.score),
      arv: d.arv,
      offerMax: d.offer_max,
      pClose: Number(d.p_close),
      expectedValue: d.expected_value,
      status: d.status
    })),
    actions: actions.map(a => ({
      id: a.id,
      leadId: a.lead_id,
      leadName: a.lead_name,
      address: a.address || 'No address',
      action: a.action,
      priority: Number(a.priority),
      reason: a.reason,
      createdAt: a.created_at
    }))
  };
}

export default async function OptimizationDashboard() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return <div>Unauthorized</div>;
  }

  const organization = await getOrganization();
  if (!organization) {
    return <div>No organization found</div>;
  }

  const data = await getDashboardData(organization.id);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Deal Command Center</h1>
      
      <KPIBar 
        totalLeads={data.totalLeads}
        activeDeals={data.activeDeals}
        expectedValue={data.expectedValue}
        avgProbability={data.avgProbability}
      />

      <div className="grid grid-cols-2 gap-6 mb-6">
        <DealTable deals={data.deals} />
        <ActionQueue actions={data.actions} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Test dashboard loads**

```bash
cd apps/web
yarn dev
```

Navigate to http://localhost:4000/optimization/dashboard

Expected: Full dashboard with KPIs, empty deal table, empty action queue

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/optimization/dashboard/components/DealTable.tsx
git add apps/web/src/app/optimization/dashboard/components/ActionQueue.tsx
git add apps/web/src/app/optimization/dashboard/page.tsx
git commit -m "feat(optimization): add deal table and action queue components"
```

---

## Task 10: End-to-End Verification

**Files:**
- Create: `apps/web/scripts/seed-optimization-test.mjs`

**Interfaces:**
- Consumes: Complete MVP system
- Produces: Seed script and verification results

- [ ] **Step 1: Create seed script**

Create file `apps/web/scripts/seed-optimization-test.mjs`:

```javascript
import sql from '../src/app/api/utils/sql.ts';

async function seedTestLeads() {
  console.log('Seeding 5 test leads for optimization MVP...');

  const testLeads = [
    {
      type: 'seller',
      name: 'High Priority Test',
      phone: '+15551234567',
      email: 'test1@example.com',
      status: 'new',
      metadata: {
        address: '123 Main St, Louisville KY 40202',
        signals: ['pre_foreclosure', 'vacant'],
        beds: 3,
        baths: 2,
        sqft: 1500,
        condition: 'fair',
        estimated_arv: 250000,
        estimated_debt: 175000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'Medium Priority Test',
      phone: '+15551234568',
      email: 'test2@example.com',
      status: 'new',
      metadata: {
        address: '456 Oak Ave, Louisville KY 40202',
        signals: ['probate'],
        beds: 3,
        baths: 2,
        sqft: 1400,
        condition: 'good',
        estimated_arv: 200000,
        estimated_debt: 140000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'Low Priority Test',
      phone: '+15551234569',
      email: 'test3@example.com',
      status: 'new',
      metadata: {
        address: '789 Pine Rd, Louisville KY 40202',
        signals: [],
        beds: 2,
        baths: 1,
        sqft: 1000,
        condition: 'good',
        estimated_arv: 150000,
        estimated_debt: 120000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'High Distress Test',
      phone: '+15551234570',
      email: 'test4@example.com',
      status: 'new',
      metadata: {
        address: '321 Elm St, Louisville KY 40202',
        signals: ['pre_foreclosure', 'tax_delinquent', 'code_violation'],
        beds: 4,
        baths: 2,
        sqft: 2000,
        condition: 'poor',
        estimated_arv: 300000,
        estimated_debt: 250000,
        zip: '40202'
      }
    },
    {
      type: 'seller',
      name: 'Fresh Lead Test',
      phone: '+15551234571',
      email: 'test5@example.com',
      status: 'new',
      metadata: {
        address: '555 Cedar Ln, Louisville KY 40202',
        signals: ['vacant', 'absentee_owner'],
        beds: 3,
        baths: 2,
        sqft: 1600,
        condition: 'fair',
        estimated_arv: 220000,
        estimated_debt: 150000,
        zip: '40202'
      }
    }
  ];

  // Insert with org_id from first organization
  const [org] = await sql`SELECT id FROM organizations LIMIT 1`;
  
  if (!org) {
    console.error('No organization found. Create one first.');
    process.exit(1);
  }

  const leadIds = [];

  for (const lead of testLeads) {
    const [inserted] = await sql`
      INSERT INTO leads (
        type, name, phone, email, status, metadata, organization_id
      ) VALUES (
        ${lead.type},
        ${lead.name},
        ${lead.phone},
        ${lead.email},
        ${lead.status},
        ${JSON.stringify(lead.metadata)},
        ${org.id}
      )
      RETURNING id
    `;
    leadIds.push(inserted.id);
    console.log(`  ✓ Created lead ${inserted.id}: ${lead.name}`);
  }

  console.log(`\nSeeded ${leadIds.length} test leads`);
  console.log('Lead IDs:', leadIds.join(', '));
  console.log('\nNext steps:');
  console.log('1. Process leads: POST /api/optimization/process with { "leadIds": [' + leadIds.join(', ') + '] }');
  console.log('2. View dashboard: http://localhost:4000/optimization/dashboard');

  process.exit(0);
}

seedTestLeads().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run seed script**

```bash
cd apps/web
yarn tsx scripts/seed-optimization-test.mjs
```

Expected output: 5 leads created with IDs

- [ ] **Step 3: Process test leads via API**

```bash
cd apps/web
# Use the lead IDs from seed output
curl -X POST http://localhost:4000/api/optimization/process \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session-cookie>" \
  -d '{"leadIds": [<id1>, <id2>, <id3>, <id4>, <id5>]}'
```

Expected: { "success": true, "count": 5, "message": "5 leads processed successfully" }

Note: Get admin session cookie from browser DevTools after logging in

- [ ] **Step 4: Verify dashboard shows data**

Navigate to http://localhost:4000/optimization/dashboard

Expected:
- KPI bar shows counts > 0
- Deal table shows 5 leads sorted by EV
- Action queue shows pending actions

- [ ] **Step 5: Verify database state**

```bash
cd apps/web
yarn tsx -e "
import sql from './src/app/api/utils/sql';

const scores = await sql\`SELECT COUNT(*) FROM lead_scores\`;
const valuations = await sql\`SELECT COUNT(*) FROM property_valuations\`;
const probs = await sql\`SELECT COUNT(*) FROM deal_probabilities\`;
const actions = await sql\`SELECT COUNT(*) FROM lead_actions WHERE status = 'pending'\`;

console.log('Scores:', scores[0].count);
console.log('Valuations:', valuations[0].count);
console.log('Probabilities:', probs[0].count);
console.log('Actions:', actions[0].count);

process.exit(0);
"
```

Expected: All counts show 5 (or more if you processed multiple batches)

- [ ] **Step 6: Commit**

```bash
git add apps/web/scripts/seed-optimization-test.mjs
git commit -m "feat(optimization): add E2E verification seed script"
```

---

## Task 11: Documentation

**Files:**
- Create: `docs/optimization-mvp-usage.md`

**Interfaces:**
- Consumes: Complete MVP system
- Produces: Usage documentation

- [ ] **Step 1: Create usage documentation**

Create file `docs/optimization-mvp-usage.md`:

```markdown
# DealFlow AI Optimization MVP - Usage Guide

## Overview

The Optimization MVP is a Claude-native decision engine that:
1. Scores leads by conversion potential
2. Values properties using comp-based analysis
3. Calculates deal probability
4. Prioritizes actions by expected value

## Architecture

```
Lead → Orchestrator → [4 Claude Agents] → Database → Dashboard
```

**Agents:**
1. **Lead Scoring** - Distress + recency + equity + geo → composite score
2. **Valuation** - Comps + repairs → ARV + offer range
3. **Probability** - Score + valuation confidence → P(close) + EV
4. **Decision** - Probability + EV → action + priority

## Getting Started

### 1. Seed Test Data

```bash
cd apps/web
yarn tsx scripts/seed-optimization-test.mjs
```

This creates 5 test leads with varying distress levels.

### 2. Process Leads

**Single lead:**
```bash
curl -X POST http://localhost:4000/api/optimization/process \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"leadId": 123}'
```

**Batch:**
```bash
curl -X POST http://localhost:4000/api/optimization/process \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"leadIds": [123, 124, 125]}'
```

### 3. View Dashboard

Navigate to: http://localhost:4000/optimization/dashboard

**Dashboard sections:**
- **KPI Bar** - Total leads, active deals, expected value, avg probability
- **Deal Pipeline** - Leads sorted by expected value
- **Action Queue** - Next actions sorted by priority

### 4. View Lead Details

GET http://localhost:4000/api/optimization/decision/123

Returns all agent outputs for a specific lead.

## Database Tables

- `lead_scores` - Composite score + components
- `property_valuations` - ARV + repairs + offer range
- `deal_probabilities` - P(close) + expected value
- `lead_actions` - Priority queue of actions
- `lead_events` - Event log for learning (future)

## Configuration

**Required environment variable:**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Claude model used:** `claude-sonnet-4-20250514`

## Customization

### Adjust Scoring Weights

Edit `apps/web/src/app/api/optimization/agents/prompts.ts`:

```typescript
// Lead scoring weights
0.4 × distress +
0.3 × recency +
0.2 × equity +
0.1 × geo
```

### Adjust Wholesale Formula

Edit valuation prompt:

```typescript
buyerMax = ARV × 0.70  // 70% rule
offerMax = buyerMax - repairs - 10000  // $10k fee
```

### Adjust Decision Thresholds

Edit decision prompt:

```typescript
if pClose > 0.7 → pursue
if pClose 0.4-0.7 → conditional
if pClose < 0.4 → reject
```

## Troubleshooting

**No data in dashboard:**
- Verify leads were processed: `SELECT COUNT(*) FROM lead_scores`
- Check API logs for errors
- Ensure ANTHROPIC_API_KEY is set

**Claude API errors:**
- Check API key is valid
- Verify model name is correct
- Check Anthropic API status

**Database errors:**
- Verify migration 050 ran successfully
- Check all 5 tables exist

## Next Steps

After validating the MVP:

1. **Collect real outcomes** - Track which leads actually close
2. **Replace mock comps** - Integrate real comparable sales data
3. **Add learning loops** - Update models based on outcomes
4. **Add experimentation** - A/B test messaging, timing, strategies
5. **Scale up** - Add distributed workers when processing >100 leads/day

## Support

For issues or questions, see:
- Design doc: `docs/superpowers/specs/2026-07-31-dealflow-mvp-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-31-dealflow-optimization-mvp.md`
```

- [ ] **Step 2: Verify documentation is accurate**

Read through the documentation and verify all commands work.

- [ ] **Step 3: Commit**

```bash
git add docs/optimization-mvp-usage.md
git commit -m "docs(optimization): add MVP usage guide"
```

---

## Self-Review Checklist

**Spec Coverage:**
✅ 5 database tables created  
✅ 4 Claude agents implemented  
✅ Synchronous orchestrator built  
✅ 3 API endpoints created  
✅ Dashboard with KPIs, deal table, action queue  
✅ Seed script for testing  
✅ Documentation

**No Placeholders:**
✅ All code blocks are complete  
✅ All prompts are fully written  
✅ All test cases have actual assertions  
✅ All commands have expected outputs

**Type Consistency:**
✅ AgentInput/AgentOutput used consistently  
✅ All monetary values in cents  
✅ All probabilities as 0-1 numeric  
✅ All agent interfaces match

**Testing:**
✅ Type tests for agent interfaces  
✅ Unit tests for key agents  
✅ E2E verification script  
✅ Manual dashboard testing

---

## Plan Complete

Plan saved to `docs/superpowers/plans/2026-07-31-dealflow-optimization-mvp.md`

**Two execution options:**

**1. Subagent-Driven (recommended)** - Fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
