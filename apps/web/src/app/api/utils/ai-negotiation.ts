import { callAI } from './ai-provider';
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
    arv, repairCosts, condition,
    daysOnMarket, motivation,
    localComps, state, county, neighborhood, marketSpeed,
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