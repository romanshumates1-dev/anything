/**
 * Tests for Automated AI Negotiation Engine
 *
 * Verifies:
 * - Initial offer calculation with market data
 * - Counter-offer evaluation logic
 * - Strategy-based concession curves
 * - Escalation thresholds
 * - State machine transitions
 * - Config validation
 */
import { describe, it, expect } from 'vitest';
import {
  calculateInitialOffer,
  evaluateCounterOffer,
  generateCounterResponse,
  computePhaseTransition,
  shouldEscalate,
  validateNegotiationConfig,
  buildConfigFromValuation,
  STRATEGY_CONCESSION_CURVES,
  formatOffer,
  type NegotiationConfig,
  type NegotiationSessionState,
  type MarketData,
} from '../negotiationEngine';

// ── INITIAL OFFER CALCULATION ────────────────────────────────────────────────

describe('calculateInitialOffer', () => {
  // Use a config where calculated offers won't hit the min floor
  const baseConfig: NegotiationConfig = {
    minPriceCents: 5_000_000, // $50k - low enough to not trigger clamping
    maxPriceCents: 12_000_000, // $120k
    targetPriceCents: 10_000_000, // $100k
    strategy: 'balanced',
    autoApproveUnderCents: 10_000_000,
    escalateOverCents: 50_000_000,
    maxRounds: 4,
  };

  describe('seller side (we are BUYING)', () => {
    it('starts at strategy-based percentage of target', () => {
      const result = calculateInitialOffer('seller', baseConfig, {});
      // Balanced: 82% of $100k = $82k
      expect(result.offerCents).toBeLessThan(baseConfig.targetPriceCents);
      expect(result.offerCents).toBeGreaterThan(baseConfig.minPriceCents);
      expect(result.reasoning).toContainEqual(expect.stringMatching(/balanced.*82%/i));
    });

    it('aggressive strategy starts lower than balanced', () => {
      const aggressiveConfig = { ...baseConfig, strategy: 'aggressive' as const };
      const balancedResult = calculateInitialOffer('seller', baseConfig, {});
      const aggressiveResult = calculateInitialOffer('seller', aggressiveConfig, {});
      // Aggressive: 75% should be less than balanced 82%
      expect(aggressiveResult.offerCents).toBeLessThan(balancedResult.offerCents);
    });

    it('conservative strategy starts higher than balanced', () => {
      const conservativeConfig = { ...baseConfig, strategy: 'conservative' as const };
      const balancedResult = calculateInitialOffer('seller', baseConfig, {});
      const conservativeResult = calculateInitialOffer('seller', conservativeConfig, {});
      // Conservative: 88% should be more than balanced 82%
      expect(conservativeResult.offerCents).toBeGreaterThan(balancedResult.offerCents);
    });

    it('adjusts down for high motivation', () => {
      const marketData: MarketData = { motivationScore: 0.8 };
      const result = calculateInitialOffer('seller', baseConfig, marketData);
      const baseResult = calculateInitialOffer('seller', baseConfig, {});
      expect(result.offerCents).toBeLessThan(baseResult.offerCents);
      expect(result.reasoning).toContainEqual(expect.stringMatching(/high.*motivation/i));
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('adjusts down for long days on market', () => {
      const marketData: MarketData = { daysOnMarket: 120 };
      const result = calculateInitialOffer('seller', baseConfig, marketData);
      const baseResult = calculateInitialOffer('seller', baseConfig, {});
      expect(result.offerCents).toBeLessThan(baseResult.offerCents);
      expect(result.reasoning).toContainEqual(expect.stringMatching(/90\+ days/i));
    });

    it('adjusts down for heavy repairs', () => {
      const marketData: MarketData = { conditionTier: 'heavy' };
      const result = calculateInitialOffer('seller', baseConfig, marketData);
      const baseResult = calculateInitialOffer('seller', baseConfig, {});
      expect(result.offerCents).toBeLessThan(baseResult.offerCents);
    });

    it('never goes below minimum', () => {
      // Create config where calculated offer would go below min
      const lowTargetConfig = { ...baseConfig, minPriceCents: 8_000_000, targetPriceCents: 8_500_000 };
      const result = calculateInitialOffer('seller', lowTargetConfig, {});
      expect(result.offerCents).toBeGreaterThanOrEqual(lowTargetConfig.minPriceCents);
    });

    it('increases confidence with AVM and comps', () => {
      const marketData: MarketData = {
        avmCents: 9_000_000,
        compsCents: [8_800_000, 9_200_000, 8_500_000],
      };
      const result = calculateInitialOffer('seller', baseConfig, marketData);
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('buyer side (we are SELLING contract)', () => {
    it('starts at strategy-based premium above target', () => {
      const result = calculateInitialOffer('buyer', baseConfig, {});
      // Balanced: 115% of target
      expect(result.offerCents).toBeGreaterThan(baseConfig.targetPriceCents);
    });

    it('never exceeds maximum', () => {
      const result = calculateInitialOffer('buyer', baseConfig, {});
      expect(result.offerCents).toBeLessThanOrEqual(baseConfig.maxPriceCents);
    });
  });
});

// ── COUNTER-OFFER EVALUATION ─────────────────────────────────────────────────

describe('evaluateCounterOffer', () => {
  const config: NegotiationConfig = {
    minPriceCents: 7_000_000,
    maxPriceCents: 10_000_000,
    targetPriceCents: 8_500_000,
    strategy: 'balanced',
    autoApproveUnderCents: 10_000_000,
    escalateOverCents: 50_000_000,
    maxRounds: 4,
  };

  describe('seller side', () => {
    const state = {
      side: 'seller' as const,
      round: 1,
      clampCents: 9_500_000, // Our ceiling
    };

    it('accepts counter at or below ceiling', () => {
      const result = evaluateCounterOffer(8_000_000, 9_000_000, config, state);
      expect(result.outcome).toBe('accept');
      expect(result.autoApprove).toBe(true);
    });

    it('accepts counter exactly at ceiling', () => {
      const result = evaluateCounterOffer(8_000_000, 9_500_000, config, state);
      expect(result.outcome).toBe('accept');
    });

    it('counters when outside bounds but within tolerance', () => {
      const result = evaluateCounterOffer(8_000_000, 10_500_000, config, state);
      // 10.5M is ~10.5% above 9.5M ceiling - should counter
      expect(result.outcome).toBe('counter');
      expect(result.nextOfferCents).toBeDefined();
      expect(result.nextOfferCents!).toBeLessThanOrEqual(state.clampCents);
    });

    it('rejects when too far outside bounds', () => {
      const result = evaluateCounterOffer(8_000_000, 15_000_000, config, state);
      // 15M is ~58% above 9.5M ceiling - should reject
      expect(result.outcome).toBe('reject');
    });

    it('rejects when max rounds exhausted', () => {
      const exhaustedState = { ...state, round: 5 };
      const result = evaluateCounterOffer(8_000_000, 10_500_000, config, exhaustedState);
      expect(result.outcome).toBe('reject');
      expect(result.reason).toContain('Maximum rounds');
    });

    it('escalates high-value deals that exceed threshold', () => {
      // For seller side: dealValue = counterCents
      // The logic checks: if under autoApprove -> accept, if over escalate -> escalate, else accept
      // We need: autoApprove < counter < escalate (accept), or counter > escalate (escalate)
      // Set autoApprove=8M, escalate=8.5M, counter=9M -> 9M > 8.5M -> escalate
      const highValueConfig = {
        ...config,
        autoApproveUnderCents: 8_000_000, // $80k
        escalateOverCents: 8_500_000, // $85k
      };
      // Counter of 9M is within bounds (below 9.5M ceiling) but exceeds 8.5M escalation threshold
      const result = evaluateCounterOffer(8_000_000, 9_000_000, highValueConfig, state);
      expect(result.outcome).toBe('escalate');
      expect(result.autoApprove).toBe(false);
    });
  });

  describe('buyer side', () => {
    const state = {
      side: 'buyer' as const,
      round: 1,
      clampCents: 10_500_000, // Our floor (contract + fee)
    };

    it('accepts counter at or above floor', () => {
      const result = evaluateCounterOffer(12_000_000, 11_000_000, config, state);
      expect(result.outcome).toBe('accept');
    });

    it('counters when below floor but within tolerance', () => {
      const result = evaluateCounterOffer(12_000_000, 9_500_000, config, state);
      expect(result.outcome).toBe('counter');
      expect(result.nextOfferCents!).toBeGreaterThanOrEqual(state.clampCents);
    });
  });

  describe('concession curves', () => {
    it('strategy affects concession rate', () => {
      const aggressiveConfig = { ...config, strategy: 'aggressive' as const };
      const conservativeConfig = { ...config, strategy: 'conservative' as const };
      const state = { side: 'seller' as const, round: 1, clampCents: 9_500_000 };

      const aggressive = evaluateCounterOffer(7_000_000, 10_000_000, aggressiveConfig, state);
      const conservative = evaluateCounterOffer(7_000_000, 10_000_000, conservativeConfig, state);

      // Conservative should concede more
      expect(conservative.nextOfferCents!).toBeGreaterThan(aggressive.nextOfferCents!);
    });
  });
});

// ── COUNTER RESPONSE GENERATION ──────────────────────────────────────────────

describe('generateCounterResponse', () => {
  const baseState: NegotiationSessionState = {
    sessionId: 'test-session',
    leadId: 123,
    organizationId: 'org-1',
    side: 'seller',
    phase: 'AI_EVALUATING',
    round: 2,
    config: {
      minPriceCents: 7_000_000,
      maxPriceCents: 10_000_000,
      targetPriceCents: 8_500_000,
      strategy: 'balanced',
      autoApproveUnderCents: 10_000_000,
      escalateOverCents: 50_000_000,
      maxRounds: 4,
    },
    openerCents: 7_500_000,
    clampCents: 9_500_000,
    lastOfferCents: 8_000_000,
    lastCounterCents: 9_200_000,
    confidence: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('generates accept response with deal confirmation', () => {
    const evaluation = {
      outcome: 'accept' as const,
      reason: 'Within bounds',
      confidence: 0.95,
      autoApprove: true,
    };
    const response = generateCounterResponse(baseState, evaluation);
    expect(response.action).toBe('accept_deal');
    expect(response.messageTemplate).toContain('{OFFER}');
    expect(response.messageTemplate).toContain('purchase agreement');
  });

  it('generates counter response with offer slot', () => {
    const evaluation = {
      outcome: 'counter' as const,
      nextOfferCents: 8_500_000,
      reason: 'Countering',
      confidence: 0.8,
      autoApprove: true,
    };
    const response = generateCounterResponse(baseState, evaluation);
    expect(response.action).toBe('send_counter');
    expect(response.offerCents).toBe(8_500_000);
    expect(response.messageTemplate).toContain('{OFFER}');
  });

  it('generates escalation response for human review', () => {
    const evaluation = {
      outcome: 'escalate' as const,
      reason: 'High value deal',
      confidence: 0.9,
      autoApprove: false,
    };
    const response = generateCounterResponse(baseState, evaluation);
    expect(response.action).toBe('escalate_human');
    expect(response.messageTemplate).toContain('review');
  });

  it('generates walk-away response', () => {
    const evaluation = {
      outcome: 'reject' as const,
      reason: 'Outside bounds',
      confidence: 0.88,
      autoApprove: true,
    };
    const response = generateCounterResponse(baseState, evaluation);
    expect(response.action).toBe('walk_away');
    expect(response.messageTemplate).toContain('luck');
  });
});

// ── STATE MACHINE TRANSITIONS ────────────────────────────────────────────────

describe('computePhaseTransition', () => {
  it('INITIAL_OUTREACH + send_counter -> AWAITING_RESPONSE', () => {
    expect(computePhaseTransition('INITIAL_OUTREACH', 'send_counter')).toBe('AWAITING_RESPONSE');
  });

  it('COUNTER_RECEIVED + any action -> AI_EVALUATING', () => {
    expect(computePhaseTransition('COUNTER_RECEIVED', 'send_counter')).toBe('AI_EVALUATING');
    expect(computePhaseTransition('COUNTER_RECEIVED', 'accept_deal')).toBe('AI_EVALUATING');
  });

  it('AI_EVALUATING + accept_deal -> AUTO_ACCEPT', () => {
    expect(computePhaseTransition('AI_EVALUATING', 'accept_deal')).toBe('AUTO_ACCEPT');
  });

  it('AI_EVALUATING + escalate_human -> ESCALATE', () => {
    expect(computePhaseTransition('AI_EVALUATING', 'escalate_human')).toBe('ESCALATE');
  });

  it('AUTO_ACCEPT + accept_deal -> CONTRACT_GENERATION', () => {
    expect(computePhaseTransition('AUTO_ACCEPT', 'accept_deal')).toBe('CONTRACT_GENERATION');
  });
});

// ── ESCALATION LOGIC ─────────────────────────────────────────────────────────

describe('shouldEscalate', () => {
  const baseState: NegotiationSessionState = {
    sessionId: 'test',
    leadId: 1,
    organizationId: 'org',
    side: 'seller',
    phase: 'AI_EVALUATING',
    round: 1,
    config: {
      minPriceCents: 7_000_000,
      maxPriceCents: 10_000_000,
      targetPriceCents: 8_500_000,
      strategy: 'balanced',
      autoApproveUnderCents: 10_000_000,
      escalateOverCents: 20_000_000, // $200k
      maxRounds: 4,
    },
    openerCents: 7_500_000,
    clampCents: 9_500_000,
    confidence: 0.8,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('does not escalate confident negotiations within bounds', () => {
    const result = shouldEscalate(baseState);
    expect(result.escalate).toBe(false);
  });

  it('escalates low confidence negotiations', () => {
    const lowConfState = { ...baseState, confidence: 0.4 };
    const result = shouldEscalate(lowConfState);
    expect(result.escalate).toBe(true);
    expect(result.reason).toContain('confidence');
  });

  it('escalates when evaluation outcome is escalate', () => {
    const evaluation = {
      outcome: 'escalate' as const,
      reason: 'High value',
      confidence: 0.9,
      autoApprove: false,
    };
    const result = shouldEscalate(baseState, evaluation);
    expect(result.escalate).toBe(true);
  });

  it('escalates high-value deals', () => {
    const highValueState = {
      ...baseState,
      lastCounterCents: 25_000_000, // $250k
    };
    const result = shouldEscalate(highValueState);
    expect(result.escalate).toBe(true);
    expect(result.reason).toContain('threshold');
  });
});

// ── CONFIG VALIDATION ────────────────────────────────────────────────────────

describe('validateNegotiationConfig', () => {
  it('accepts valid config', () => {
    expect(validateNegotiationConfig({
      minPriceCents: 5_000_000,
      maxPriceCents: 10_000_000,
      targetPriceCents: 7_500_000,
      strategy: 'balanced',
      maxRounds: 4,
    })).toBeNull();
  });

  it('rejects negative minPriceCents', () => {
    expect(validateNegotiationConfig({ minPriceCents: -100 })).toContain('cannot be negative');
  });

  it('rejects min > max', () => {
    expect(validateNegotiationConfig({
      minPriceCents: 10_000_000,
      maxPriceCents: 5_000_000,
    })).toContain('cannot exceed');
  });

  it('rejects target outside min/max', () => {
    expect(validateNegotiationConfig({
      minPriceCents: 5_000_000,
      maxPriceCents: 10_000_000,
      targetPriceCents: 3_000_000,
    })).toContain('cannot be below');
  });

  it('rejects invalid maxRounds', () => {
    expect(validateNegotiationConfig({ maxRounds: 0 })).toContain('must be between');
    expect(validateNegotiationConfig({ maxRounds: 15 })).toContain('must be between');
  });

  it('rejects invalid strategy', () => {
    expect(validateNegotiationConfig({ strategy: 'invalid' as any })).toContain('must be');
  });

  it('rejects autoApprove > escalate', () => {
    expect(validateNegotiationConfig({
      autoApproveUnderCents: 20_000_000,
      escalateOverCents: 10_000_000,
    })).toContain('cannot exceed');
  });
});

// ── CONFIG BUILDING ──────────────────────────────────────────────────────────

describe('buildConfigFromValuation', () => {
  it('builds config from valuation results', () => {
    const valuation = { suggestMin: 75000, suggestMax: 95000 };
    const profile = { openerPctOfMax: 0.82, minFee: 5000, feeTargetMax: 15000 };

    const config = buildConfigFromValuation('seller', valuation, profile);

    expect(config.minPriceCents).toBe(7_500_000); // $75k in cents
    expect(config.maxPriceCents).toBe(9_500_000); // $95k in cents
    expect(config.targetPriceCents).toBe(8_500_000); // midpoint
    expect(config.feeFloorCents).toBe(500_000); // $5k in cents
  });

  it('throws on null valuation', () => {
    const valuation = { suggestMin: null, suggestMax: null };
    const profile = { openerPctOfMax: 0.82, minFee: 5000, feeTargetMax: 15000 };

    expect(() => buildConfigFromValuation('seller', valuation, profile)).toThrow('valid valuation');
  });

  it('accepts overrides', () => {
    const valuation = { suggestMin: 75000, suggestMax: 95000 };
    const profile = { openerPctOfMax: 0.82, minFee: 5000, feeTargetMax: 15000 };

    const config = buildConfigFromValuation('seller', valuation, profile, {
      strategy: 'aggressive',
      maxRounds: 6,
    });

    expect(config.strategy).toBe('aggressive');
    expect(config.maxRounds).toBe(6);
  });
});

// ── STRATEGY CURVES ──────────────────────────────────────────────────────────

describe('STRATEGY_CONCESSION_CURVES', () => {
  it('aggressive has smallest first concession', () => {
    expect(STRATEGY_CONCESSION_CURVES.aggressive[0]).toBeLessThan(STRATEGY_CONCESSION_CURVES.balanced[0]);
    expect(STRATEGY_CONCESSION_CURVES.balanced[0]).toBeLessThan(STRATEGY_CONCESSION_CURVES.conservative[0]);
  });

  it('all curves are decreasing', () => {
    for (const [strategy, curve] of Object.entries(STRATEGY_CONCESSION_CURVES)) {
      for (let i = 1; i < curve.length; i++) {
        expect(curve[i]).toBeLessThanOrEqual(curve[i - 1]);
      }
    }
  });

  it('conservative has more rounds', () => {
    expect(STRATEGY_CONCESSION_CURVES.conservative.length).toBeGreaterThanOrEqual(
      STRATEGY_CONCESSION_CURVES.aggressive.length
    );
  });
});
