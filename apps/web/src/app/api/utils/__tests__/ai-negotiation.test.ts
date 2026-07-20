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

  it('produces guidance aligned with valuation engine for standard distressed profile', async () => {
    (callAI as any).mockResolvedValue({
      text: JSON.stringify({
        recommendedInitialOffer: 73000,
        walkAwayPrice: 59860,
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
      repairCosts: 57000,
      condition: 'moderate',
      squareFootage: 1500,
    }, 'user-123');

    expect(result.recommendedInitialOffer).toBe(73000);
    expect(result.walkAwayPrice).toBe(59860);
  });
});