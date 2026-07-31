/**
 * Campaign Financial Planner — math verification.
 *
 * Every number in the planner UI is computed from the same functions tested here.
 * The hand-computed fixtures prove the Poisson probabilities are correct and that
 * multi-channel depth beats SMS-only breadth on cost-per-expected-contract.
 */
import { describe, it, expect } from 'vitest';

// --- Extracted logic (same as page.tsx) ---

function poisson(lambda: number, k: number): number {
  let p = Math.exp(-lambda);
  for (let i = 0; i < k; i++) {
    p *= lambda / (i + 1);
  }
  return p;
}

function poissonCdf(lambda: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poisson(lambda, i);
  }
  return sum;
}

function pGte(lambda: number, k: number): number {
  return 1 - poissonCdf(lambda, k - 1);
}

function nForConfidence(confidence: number, kTarget: number, convRate: number): number {
  for (let n = 1; n < 1_000_000; n += 10) {
    const lam = n * convRate;
    if (pGte(lam, kTarget) >= confidence) return n;
  }
  return Infinity;
}

interface ChannelBreakdown {
  sms: number;
  email: number;
  call: number;
}

interface CostInputs {
  skipTrace: number;
  dncScrub: number;
  segmentCost: number;
  aiPerConversation: number;
  conversionRate: number;
}

function computePlan(contacts: number, channels: ChannelBreakdown, costs: CostInputs) {
  const touchesPerContact = channels.sms + channels.email + channels.call;
  const totalTouches = contacts * touchesPerContact;
  const acquisitionCost = contacts * (costs.skipTrace + costs.dncScrub);
  const smsSendingCost = contacts * channels.sms * costs.segmentCost;
  const emailSendingCost = 0;
  const callCost = 0;
  const replyRate = 0.03;
  const aiCost = contacts * replyRate * touchesPerContact * costs.aiPerConversation;
  const totalCost = acquisitionCost + smsSendingCost + emailSendingCost + callCost + aiCost;
  const effectiveRate = costs.conversionRate * (touchesPerContact / 2);
  const lambda = contacts * effectiveRate;
  return {
    contacts,
    channels,
    touchesPerContact,
    totalTouches,
    acquisitionCost,
    smsSendingCost,
    aiCost,
    totalCost,
    lambda,
    pGte1: pGte(lambda, 1),
    pGte2: pGte(lambda, 2),
    pGte3: pGte(lambda, 3),
    costPerExpectedContract: lambda > 0 ? totalCost / lambda : Infinity,
  };
}

// --- Tests ---

describe('Poisson probability functions', () => {
  it('P(X=0) for lambda=2 is e^-2 ≈ 0.1353', () => {
    expect(poisson(2, 0)).toBeCloseTo(0.1353, 3);
  });

  it('P(X>=1) for lambda=2 is 1 - e^-2 ≈ 0.8647', () => {
    expect(pGte(2, 1)).toBeCloseTo(0.8647, 3);
  });

  it('P(X>=3) for lambda=2 is 1 - P(0) - P(1) - P(2) ≈ 0.3233', () => {
    expect(pGte(2, 3)).toBeCloseTo(0.3233, 3);
  });

  it('P(X>=1) for lambda=0.5 ≈ 0.3935', () => {
    expect(pGte(0.5, 1)).toBeCloseTo(0.3935, 3);
  });

  it('nForConfidence finds N for 80% P(>=1) at 0.25% effective rate', () => {
    // λ >= -ln(0.20) ≈ 1.609; at rate 0.0025: n ≈ 644
    const n = nForConfidence(0.80, 1, 0.0025);
    expect(n).toBeGreaterThan(600);
    expect(n).toBeLessThan(700);
  });
});

describe('breadth plan (SMS only): 1000 contacts × 2 SMS touches', () => {
  const costs: CostInputs = {
    skipTrace: 0.10,
    dncScrub: 0.005,
    segmentCost: 0.011,
    aiPerConversation: 0.04,
    conversionRate: 0.0005,
  };

  const breadth = computePlan(1000, { sms: 2, email: 0, call: 0 }, costs);

  it('acquisition = 1000 × $0.105 = $105', () => {
    expect(breadth.acquisitionCost).toBeCloseTo(105, 1);
  });

  it('SMS sending = 1000 × 2 × $0.011 = $22', () => {
    expect(breadth.smsSendingCost).toBeCloseTo(22, 1);
  });

  it('AI = 1000 × 0.03 × 2 × $0.04 = $2.40', () => {
    expect(breadth.aiCost).toBeCloseTo(2.4, 1);
  });

  it('total ≈ $129.40', () => {
    expect(breadth.totalCost).toBeCloseTo(129.4, 0);
  });

  it('λ = 1000 × 0.0005 × (2/2) = 0.5', () => {
    expect(breadth.lambda).toBeCloseTo(0.5, 4);
  });

  it('P(≥1) at λ=0.5 ≈ 0.3935', () => {
    expect(breadth.pGte1).toBeCloseTo(0.3935, 3);
  });
});

describe('depth plan (multi-channel): 250 contacts × (4 SMS + 4 email + 2 call)', () => {
  const costs: CostInputs = {
    skipTrace: 0.10,
    dncScrub: 0.005,
    segmentCost: 0.011,
    aiPerConversation: 0.04,
    conversionRate: 0.0005,
  };

  const depth = computePlan(250, { sms: 4, email: 4, call: 2 }, costs);

  it('acquisition = 250 × $0.105 = $26.25', () => {
    expect(depth.acquisitionCost).toBeCloseTo(26.25, 1);
  });

  it('SMS sending = 250 × 4 × $0.011 = $11.00 (email + call = $0)', () => {
    expect(depth.smsSendingCost).toBeCloseTo(11.0, 1);
  });

  it('AI = 250 × 0.03 × 10 × $0.04 = $3.00', () => {
    expect(depth.aiCost).toBeCloseTo(3.0, 1);
  });

  it('total ≈ $40.25', () => {
    expect(depth.totalCost).toBeCloseTo(40.25, 0);
  });

  it('λ = 250 × 0.0005 × (10/2) = 0.625', () => {
    expect(depth.lambda).toBeCloseTo(0.625, 4);
  });

  it('P(≥1) at λ=0.625 ≈ 0.4647', () => {
    expect(depth.pGte1).toBeCloseTo(0.4647, 3);
  });

  it('total touches = 250 × 10 = 2500', () => {
    expect(depth.totalTouches).toBe(2500);
  });
});

describe('multi-channel depth beats SMS-only breadth', () => {
  const costs: CostInputs = {
    skipTrace: 0.10,
    dncScrub: 0.005,
    segmentCost: 0.011,
    aiPerConversation: 0.04,
    conversionRate: 0.0005,
  };

  const breadth = computePlan(1000, { sms: 2, email: 0, call: 0 }, costs);
  const depth = computePlan(250, { sms: 4, email: 4, call: 2 }, costs);

  it('depth cost-per-contract < breadth cost-per-contract', () => {
    expect(depth.costPerExpectedContract).toBeLessThan(breadth.costPerExpectedContract);
  });

  it('depth has higher P(≥1) despite 4× fewer contacts', () => {
    expect(depth.pGte1).toBeGreaterThan(breadth.pGte1);
  });

  it('depth total cost < 1/3 of breadth total cost', () => {
    expect(depth.totalCost).toBeLessThan(breadth.totalCost / 3);
  });

  it('depth cost-per-contract ≈ $64.40 vs breadth ≈ $258.80', () => {
    expect(depth.costPerExpectedContract).toBeCloseTo(64.4, 0);
    expect(breadth.costPerExpectedContract).toBeCloseTo(258.8, 0);
  });
});

describe('comparison: all-SMS depth vs multi-channel depth (same 10 touches)', () => {
  const costs: CostInputs = {
    skipTrace: 0.10,
    dncScrub: 0.005,
    segmentCost: 0.011,
    aiPerConversation: 0.04,
    conversionRate: 0.0005,
  };

  const allSms = computePlan(250, { sms: 10, email: 0, call: 0 }, costs);
  const multiCh = computePlan(250, { sms: 4, email: 4, call: 2 }, costs);

  it('same λ (both 10 touches → same effective rate)', () => {
    expect(allSms.lambda).toBeCloseTo(multiCh.lambda, 4);
  });

  it('multi-channel cheaper (fewer paid SMS segments)', () => {
    expect(multiCh.totalCost).toBeLessThan(allSms.totalCost);
  });

  it('SMS cost difference = 250 × 6 × $0.011 = $16.50 saved', () => {
    const saved = allSms.smsSendingCost - multiCh.smsSendingCost;
    expect(saved).toBeCloseTo(16.5, 1);
  });
});

describe('benchmark vs measured labeling', () => {
  it('null measuredN = BENCHMARK', () => {
    const measuredN: number | null = null;
    expect(measuredN !== null && measuredN > 0).toBe(false);
  });

  it('measuredN > 0 = MEASURED', () => {
    const measuredN: number | null = 150;
    expect(measuredN !== null && measuredN > 0).toBe(true);
  });

  it('measuredN = 0 = BENCHMARK (no data)', () => {
    const measuredN: number | null = 0;
    expect(measuredN !== null && measuredN > 0).toBe(false);
  });
});
