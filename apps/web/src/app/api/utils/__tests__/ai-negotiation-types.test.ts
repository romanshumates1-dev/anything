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