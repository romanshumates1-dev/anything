# Phase 3: AI Negotiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development (RED-GREEN-REFACTOR cycle). Each task produces independently testable software.

**Goal:** Create AI-powered negotiation guidance that generates owner-facing recommendations (offers, scripts, psychology, risk assessments) while preserving the escalation invariant (AI never emits numbers to prospects).

**Architecture:** Extend existing valuation engine with narrative AI outputs. The `ai-negotiation.ts` orchestrator combines deterministic valuation with AI-generated strategy, while the API endpoint provides admin-only access.

**Tech Stack:** TypeScript, Vitest, Next.js API routes, existing `callAI()` abstraction, existing negotiation profile system.

## Global Constraints

- All outputs are OWNER GUIDANCE ONLY — never prospect-facing
- AI escalation rules remain intact (price/offer/contract → human review)
- Admin + beta-flag access required for negotiation endpoints
- All 479 existing tests must continue passing
- Oxlint must remain clean (0 errors)
- TypeScript must compile without errors

---

## Task 1: Create AI Negotiation Types

**Files:**
- Create: `apps/web/src/app/api/utils/ai-negotiation-types.ts`

**Step 1: Write the failing test**

```typescript
// apps/web/src/app/api/utils/__tests__/ai-negotiation-types.test.ts
import { describe, it, expect } from 'vitest';
import type { NegotiationGuidance } from '../ai-negotiation-types';

describe('NegotiationGuidance types', () => {
  it('includes all required owner-guidance fields', () => {
    const guidance: NegotiationGuidance = {
      recommendedInitialOffer: 75000,
      walkAwayPrice: 60000,
      counterOfferStrategy: [
        { step: 1, offer: 72000, tactic: 'start low, signal flexibility' },
      ],
      negotiationScript: 'Opening: ...',
      sellerPsychologySummary: 'Distressed seller, motivated by speed...',
      buyerExitStrategy: 'Cash buyer with 30% spread...',
      riskAssessment: {
        repairRisk: 'medium',
        marketRisk: 'low',
        timingRisk: 'medium',
        summary: 'Moderate repair costs...',
      },
      assignmentFeasibility: 'high',
      estimatedDaysToDisposition: 14,
      confidenceScore: 0.85,
      reasoningSummary: 'Based on ARV and comparable sales...',
    };
    expect(guidance.recommendedInitialOffer).toBeGreaterThan(0);
    expect(guidance.counterOfferStrategy.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn workspace web test src/app/api/utils/__tests__/ai-negotiation-types.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// apps/web/src/app/api/utils/ai-negotiation-types.ts
export interface CounterOfferStep {
  step: number;
  offer: number;
  tactic: string;
}

export interface RiskAssessment {
  repairRisk: 'low' | 'medium' | 'high';
  marketRisk: 'low' | 'medium' | 'high';
  timingRisk: 'low' | 'medium' | 'high';
  summary: string;
}

export interface NegotiationGuidance {
  recommendedInitialOffer: number;
  walkAwayPrice: number;
  counterOfferStrategy: CounterOfferStep[];
  negotiationScript: string;
  sellerPsychologySummary: string;
  buyerExitStrategy: string;
  riskAssessment: RiskAssessment;
  assignmentFeasibility: 'high' | 'medium' | 'low';
  estimatedDaysToDisposition: number;
  confidenceScore: number;
  reasoningSummary: string;
}
```

**Step 4: Run test to verify it passes**

Run: `yarn workspace web test src/app/api/utils/__tests__/ai-negotiation-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-16-phase3-ai-negotiation.md \
        apps/web/src/app/api/utils/ai-negotiation-types.ts \
        apps/web/src/app/api/utils/__tests__/ai-negotiation-types.test.ts
git commit -m "feat(phase3): add AI negotiation guidance types"
```

---

## Task 2: Create AI Negotiation Orchestrator Core

**Files:**
- Create: `apps/web/src/app/api/utils/ai-negotiation.ts`
- Test: `apps/web/src/app/api/utils/__tests__/ai-negotiation.test.ts`

**Interfaces:**
- Consumes: `NegotiationInputs`, `callAI()`, `logEvent()`
- Produces: `analyzeNegotiation()` returning `NegotiationGuidance`

**Step 1: Write the failing test**

```typescript
// apps/web/src/app/api/utils/__tests__/ai-negotiation.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeNegotiation } from '../ai-negotiation';

vi.mock('../ai-provider', () => ({
  callAI: vi.fn(),
  AnthropicClientError: class extends Error {},
}));

vi.mock('../logger', () => ({
  logEvent: vi.fn(),
}));

import { callAI } from '../ai-provider';

describe('analyzeNegotiation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls AI with property data and returns guidance', async () => {
    (callAI as any).mockResolvedValue({
      text: JSON.stringify({
        recommendedInitialOffer: 75000,
        walkAwayPrice: 60000,
        counterOfferStrategy: [{ step: 1, offer: 72000, tactic: 'low opener' }],
        negotiationScript: 'Opening message...',
        sellerPsychologySummary: 'Motivated seller',
        buyerExitStrategy: 'Assign to cash buyer',
        riskAssessment: { repairRisk: 'low', marketRisk: 'low', timingRisk: 'medium', summary: 'Low risk' },
        assignmentFeasibility: 'high',
        estimatedDaysToDisposition: 14,
        confidenceScore: 0.85,
        reasoningSummary: 'Strong comps support price',
      }),
      contentBlocks: [],
      stopReason: 'end_turn',
      model: 'claude-sonnet-4',
      usage: { input_tokens: 100, output_tokens: 200 },
    });

    const result = await analyzeNegotiation({
      arv: 200000,
      repairCosts: 30000,
      condition: 'moderate',
    }, 'user-123');

    expect(result.recommendedInitialOffer).toBe(75000);
    expect(result.counterOfferStrategy).toHaveLength(1);
    expect(result.assignmentFeasibility).toBe('high');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn workspace web test src/app/api/utils/__tests__/ai-negotiation.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// apps/web/src/app/api/utils/ai-negotiation.ts
import { callAI, AnthropicClientError } from './ai-provider';
import { logEvent } from './logger';
import type { NegotiationGuidance } from './ai-negotiation-types';

export interface NegotiationInputs {
  arv?: number;
  repairCosts?: number;
  condition?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  yearBuilt?: number;
  daysOnMarket?: number;
  motivation?: string;
  sellerTimeline?: string;
  taxValue?: number;
  zestimate?: number;
  localComps?: Array<{ price: number; address: string; soldDate: string }>;
  state?: string;
  county?: string;
  neighborhood?: string;
  marketSpeed?: 'buyer' | 'seller' | 'balanced';
}

const NEGOTIATION_SYSTEM_PROMPT = `You are a real estate negotiation analyst. Produce precise, data-driven guidance for the property owner. Never include dollar amounts in prospect-facing material - this is owner strategy only.

Return JSON with: recommendedInitialOffer, walkAwayPrice, counterOfferStrategy (array of {step, offer, tactic}), negotiationScript, sellerPsychologySummary, buyerExitStrategy, riskAssessment ({repairRisk, marketRisk, timingRisk, summary}), assignmentFeasibility, estimatedDaysToDisposition, confidenceScore, reasoningSummary.

All fields required. No markdown.`;

export async function analyzeNegotiation(
  inputs: NegotiationInputs,
  userId: string
): Promise<NegotiationGuidance> {
  const prompt = buildNegotiationPrompt(inputs);

  try {
    const result = await callAI({
      messages: [{ role: 'user', content: prompt }],
      system: NEGOTIATION_SYSTEM_PROMPT,
      json: true,
    });

    const guidance = parseNegotiationGuidance(result.text);

    await logEvent('ai_negotiation', 'property', userId, {
      arv: inputs.arv,
      recommendedOffer: guidance.recommendedInitialOffer,
      confidence: guidance.confidenceScore,
    });

    return guidance;
  } catch (error: any) {
    await logEvent('ai_negotiation_error', 'property', userId, {
      error: error.message,
      arv: inputs.arv,
    });
    throw error;
  }
}

function buildNegotiationPrompt(inputs: NegotiationInputs): string {
  const {
    arv, repairCosts, condition, squareFootage, bedrooms, bathrooms,
    yearBuilt, daysOnMarket, motivation, sellerTimeline, taxValue,
    zestimate, localComps, state, county, neighborhood, marketSpeed,
  } = inputs;

  const compSummary = localComps && localComps.length > 0
    ? localComps.map(c => `$${c.price.toLocaleString()} (${c.address})`).join('; ')
    : 'No comps provided';

  return `Analyze this property for wholesale negotiation:

ARV: $${arv?.toLocaleString() ?? 'Not provided'}
Repair Costs: $${repairCosts?.toLocaleString() ?? 'Not provided'}
Condition: ${condition ?? 'Not provided'}
Location: ${neighborhood ?? ''}, ${county ?? ''}, ${state ?? ''}
Days on Market: ${daysOnMarket ?? 'Not provided'}
Seller Motivation: ${motivation ?? 'Not provided'}
Market Speed: ${marketSpeed ?? 'balanced'}

Comps: ${compSummary}

Provide negotiation guidance for the owner.`;
}

function parseNegotiationGuidance(text: string): NegotiationGuidance {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  const strategy = Array.isArray(parsed.counterOfferStrategy)
    ? parsed.counterOfferStrategy.map((s: any, i: number) => ({
        step: s.step ?? i + 1,
        offer: Number(s.offer) || 0,
        tactic: String(s.tactic ?? ''),
      }))
    : [];

  return {
    recommendedInitialOffer: Number(parsed.recommendedInitialOffer) || 0,
    walkAwayPrice: Number(parsed.walkAwayPrice) || 0,
    counterOfferStrategy: strategy,
    negotiationScript: String(parsed.negotiationScript ?? ''),
    sellerPsychologySummary: String(parsed.sellerPsychologySummary ?? ''),
    buyerExitStrategy: String(parsed.buyerExitStrategy ?? ''),
    riskAssessment: {
      repairRisk: ['low', 'medium', 'high'].includes(parsed?.riskAssessment?.repairRisk)
        ? parsed.riskAssessment.repairRisk
        : 'medium',
      marketRisk: ['low', 'medium', 'high'].includes(parsed?.riskAssessment?.marketRisk)
        ? parsed.riskAssessment.marketRisk
        : 'medium',
      timingRisk: ['low', 'medium', 'high'].includes(parsed?.riskAssessment?.timingRisk)
        ? parsed.riskAssessment.timingRisk
        : 'medium',
      summary: String(parsed.riskAssessment?.summary ?? ''),
    },
    assignmentFeasibility: ['high', 'medium', 'low'].includes(parsed.assignmentFeasibility)
      ? parsed.assignmentFeasibility
      : 'medium',
    estimatedDaysToDisposition: Number(parsed.estimatedDaysToDisposition) || 14,
    confidenceScore: Math.min(1, Math.max(0, Number(parsed.confidenceScore) || 0.5)),
    reasoningSummary: String(parsed.reasoningSummary ?? ''),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn workspace web test src/app/api/utils/__tests__/ai-negotiation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/api/utils/ai-negotiation.ts \
        apps/web/src/app/api/utils/__tests__/ai-negotiation.test.ts \
        apps/web/src/app/api/utils/ai-negotiation-types.ts
git commit -m "feat(phase3): add AI negotiation orchestrator with guidance output"
```

---

## Task 3: Create API Endpoint

**Files:**
- Create: `apps/web/src/app/api/negotiation/analyze/route.ts`
- Test: `apps/web/src/app/api/negotiation/__tests__/analyze.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`, `isBetaFlagOn()`, `analyzeNegotiation()`
- Produces: POST `/api/negotiation/analyze` endpoint

**Step 1: Write the failing test**

```typescript
// apps/web/src/app/api/negotiation/__tests__/analyze.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from '../analyze/route';

vi.mock('@/app/api/utils/authz', () => ({
  requireAdmin: () => Promise.resolve({ ok: true }),
}));

vi.mock('@/app/api/utils/betaFlags', () => ({
  isBetaFlagOn: () => Promise.resolve(true),
}));

vi.mock('@/app/api/utils/ai-negotiation', () => ({
  analyzeNegotiation: () => Promise.resolve({
    recommendedInitialOffer: 75000,
    walkAwayPrice: 60000,
    counterOfferStrategy: [],
    negotiationScript: 'Test script',
    sellerPsychologySummary: 'Test psychology',
    buyerExitStrategy: 'Test exit strategy',
    riskAssessment: { repairRisk: 'low', marketRisk: 'low', timingRisk: 'low', summary: 'Test' },
    assignmentFeasibility: 'high',
    estimatedDaysToDisposition: 14,
    confidenceScore: 0.85,
    reasoningSummary: 'Test reasoning',
  }),
}));

describe('POST /api/negotiation/analyze', () => {
  it('returns 403 when beta flag is off', async () => {
    vi.resetModules();
    vi.mocked(require).mockResolvedValue({ isBetaFlagOn: () => Promise.resolve(false) });
    const response = await POST(new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ inputs: { arv: 200000 } }),
    }));
    expect(response.status).toBe(403);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `yarn workspace web test src/app/api/negotiation/__tests__/analyze.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// apps/web/src/app/api/negotiation/analyze/route.ts
import { requireAdmin } from '@/app/api/utils/authz';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { analyzeNegotiation } from '@/app/api/utils/ai-negotiation';
import type { NegotiationInputs } from '@/app/api/utils/ai-negotiation';

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    inputs?: Partial<NegotiationInputs>;
  };
  if (!body.inputs) {
    return Response.json({ error: 'inputs is required' }, { status: 400 });
  }

  const inputs: NegotiationInputs = {
    arv: Number(body.inputs.arv),
    repairCosts: Number(body.inputs.repairCosts),
    condition: body.inputs.condition,
    squareFootage: Number(body.inputs.squareFootage),
    bedrooms: Number(body.inputs.bedrooms),
    bathrooms: Number(body.inputs.bathrooms),
    yearBuilt: Number(body.inputs.yearBuilt),
    daysOnMarket: Number(body.inputs.daysOnMarket),
    motivation: body.inputs.motivation,
    sellerTimeline: body.inputs.sellerTimeline,
    taxValue: Number(body.inputs.taxValue),
    zestimate: Number(body.inputs.zestimate),
    localComps: body.inputs.localComps ?? [],
    state: body.inputs.state,
    county: body.inputs.county,
    neighborhood: body.inputs.neighborhood,
    marketSpeed: body.inputs.marketSpeed,
  };

  const guidance = await analyzeNegotiation(inputs, admin.userId);
  return Response.json({ guidance });
}
```

**Step 4: Run test to verify it passes**

Run: `yarn workspace web test src/app/api/negotiation/__tests__/analyze.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/app/api/negotiation/analyze/route.ts \
        apps/web/src/app/api/negotiation/__tests__/analyze.test.ts
git commit -m "feat(phase3): add negotiation analyze API endpoint with admin gating"
```

---

## Task 4: Integration Test with Valuation Engine

**Files:**
- Modify/Test: `apps/web/src/app/api/utils/__tests__/ai-negotiation.test.ts`

**Step 1: Write the failing test**

```typescript
it('produces guidance aligned with valuation engine for standard distressed profile', async () => {
  (callAI as any).mockResolvedValue({
    text: JSON.stringify({
      recommendedInitialOffer: 73000, // Expected from valuationEngine.test.ts
      walkAwayPrice: 59860, // suggestMin
      counterOfferStrategy: [
        { step: 1, offer: 73000, tactic: 'open at recommend' },
        { step: 2, offer: 70000, tactic: 'meet in middle' },
        { step: 3, offer: 65000, tactic: 'walk away' },
      ],
      negotiationScript: 'Initial offer script...',
      sellerPsychologySummary: 'Distressed seller needing quick sale',
      buyerExitStrategy: 'Assign to cash buyer',
      riskAssessment: { repairRisk: 'medium', marketRisk: 'low', timingRisk: 'low', summary: 'Moderate repairs' },
      assignmentFeasibility: 'high',
      estimatedDaysToDisposition: 14,
      confidenceScore: 1.0,
      reasoningSummary: 'Based on ARV 200000 and repairs 57000',
    }),
    contentBlocks: [],
    stopReason: 'end_turn',
    model: 'claude-sonnet-4',
    usage: { input_tokens: 100, output_tokens: 200 },
  });

  const result = await analyzeNegotiation({
    arv: 200000,
    repairCosts: 57000, // 1500 sqft * 38 psf moderate
    condition: 'moderate',
    squareFootage: 1500,
    hasAvm: true,
    compsCount: 4,
  }, 'user-123');

  // Verify alignment with valuation engine:
  // suggestMax = 73000 (from valuationEngine.test.ts)
  // suggestMin = 59860
  expect(result.recommendedInitialOffer).toBe(73000);
  expect(result.walkAwayPrice).toBe(59860);
});
```

**Step 2: Run test to verify it fails**

Run: `yarn workspace web test src/app/api/utils/__tests__/ai-negotiation.test.ts -u`
Expected: FAIL - step not yet implemented or wrong value

**Step 3: Implementation already exists** - may need adjustment to accept extended inputs

**Step 4: Run full test suite**

Run: `yarn workspace web test`
Expected: All 481 tests pass (479 + 2 new)

**Step 5: Commit**

```bash
git add apps/web/src/app/api/utils/__tests__/ai-negotiation.test.ts
git commit -m "test(phase3): add valuation engine integration test for negotiation guidance"
```

---

## Task 5: Final Verification

**Step 1: Run oxlint**

Run: `yarn dlx oxlint@1.58.0 --no-ignore apps/web/src`
Expected: 0 errors

**Step 2: Run typecheck**

Run: `yarn workspace web typecheck`
Expected: exit 0

**Step 3: Run all tests**

Run: `yarn workspace web test`
Expected: 479 passed (plus new tests)

**Step 4: Commit**

```bash
git commit -m "chore(phase3): verify linting and typecheck for AI negotiation"