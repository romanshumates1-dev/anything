/**
 * AI Negotiation Engine
 * 
 * Generates realistic wholesale real estate offer ranges using the configured
 * AI provider (Anthropic or Ollama). Produces data-driven offers that preserve
 * room for a profitable assignment fee.
 */

import { callAI } from '@/app/api/utils/ai-provider';
import { logEvent } from '@/app/api/utils/logger';
import { buildNegotiationPrompt, parseNegotiationResponse } from '@/app/api/utils/negotiation-prompt';
import type { NegotiationInputs, NegotiationResult } from '@/app/api/utils/negotiation-prompt';

/**
 * Analyze a property and generate negotiation recommendations.
 * 
 * @param inputs Property and market data
 * @param userId For audit logging
 * @returns NegotiationResult with offers, fees, and reasoning
 */
export async function analyzeNegotiation(
  inputs: NegotiationInputs,
  userId: string
): Promise<NegotiationResult> {
  const prompt = buildNegotiationPrompt(inputs);

  try {
    const result = await callAI({
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a precise real estate wholesaling analyst. Always respond with valid JSON only. No markdown, no explanations outside the JSON structure.',
      json: true,
    });

    const negotiation = parseNegotiationResponse(result.text);

    // Log for analytics
    await logEvent('negotiation_analysis', 'property', userId, {
      arv: inputs.arv,
      recommendedOffer: negotiation.recommendedOffer,
      expectedAssignmentFee: negotiation.expectedAssignmentFee,
      confidenceScore: negotiation.confidenceScore,
      riskScore: negotiation.riskScore,
    });

    return negotiation;
  } catch (error: any) {
    await logEvent('negotiation_analysis_error', 'property', userId, {
      error: error.message,
      arv: inputs.arv,
    });
    throw error;
  }
}

/**
 * Fallback calculation when AI is unavailable.
 * Uses the 70% rule with configurable adjustments.
 */
export function calculateFallbackOffers(inputs: NegotiationInputs): NegotiationResult {
  const {
    arv = 0,
    repairCosts = 0,
    holdingCosts = 0,
    closingCosts = 0,
    marketSpeed = 'balanced',
  } = inputs;

  // Base calculation using 70% rule
  const baseMultiplier = marketSpeed === 'buyer' ? 0.65 : marketSpeed === 'seller' ? 0.75 : 0.70;
  
  const allInCosts = repairCosts + closingCosts + (holdingCosts * 3); // Assume 3 months hold
  const maxAllowableOffer = (arv * baseMultiplier) - allInCosts;
  
  // Assignment fee targets
  const assignmentFee = Math.max(3000, Math.min(15000, arv * 0.03));
  
  const recommendedOffer = Math.max(0, Math.round(maxAllowableOffer - assignmentFee));
  const minimumOffer = Math.max(0, Math.round(recommendedOffer * 0.85));
  const maximumOffer = Math.round(recommendedOffer * 1.1);
  
  const buyerSpread = Math.round(arv * 0.20); // Cash buyer wants ~20% margin
  
  const riskScore = Math.min(100, Math.round(
    (repairCosts / Math.max(arv, 1) * 100) +
    (inputs.daysOnMarket ? inputs.daysOnMarket / 10 : 0) +
    (marketSpeed === 'buyer' ? 20 : 0)
  ));

  const confidenceScore = Math.max(20, 100 - (inputs.localComps ? 0 : 30) - (inputs.arv ? 0 : 40));

  return {
    minimumOffer,
    recommendedOffer,
    maximumOffer,
    expectedAssignmentFee: Math.round(assignmentFee),
    expectedBuyerSpread: buyerSpread,
    expectedCashBuyerInterest: recommendedOffer > 0 ? 'medium' : 'low',
    riskScore,
    confidenceScore,
    estimatedDaysToAssign: marketSpeed === 'seller' ? 7 : marketSpeed === 'buyer' ? 21 : 14,
    reasoning: {
      why: 'Fallback calculation using the 70% rule with market adjustments. AI provider was unavailable, so this uses conservative heuristics.',
      how: `Applied ${Math.round(baseMultiplier * 100)}% of ARV, subtracted repair costs ($${repairCosts.toLocaleString()}), holding costs, and closing costs. Targeted a ${Math.round(assignmentFee).toLocaleString()} assignment fee.`,
      marketAssumptions: `Market speed: ${marketSpeed}. Cash buyers typically want 15-25% margin after repairs. Holding costs assume 3-month average hold time.`,
      exitStrategy: 'Assign to cash buyer or buy-and-hold investor. In slower markets, consider creative financing or subject-to deals.',
    },
  };
}