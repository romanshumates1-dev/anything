/**
 * AI Negotiation Prompt Builder
 * 
 * Generates a structured prompt for the AI negotiation engine that produces
 * realistic wholesale real estate offer ranges based on property and market data.
 */

export interface NegotiationInputs {
  arv?: number;                    // After Repair Value in dollars
  repairCosts?: number;            // Estimated repair costs in dollars
  condition?: string;              // Property condition (poor, fair, good, excellent)
  squareFootage?: number;          // Square footage
  bedrooms?: number;               // Number of bedrooms
  bathrooms?: number;              // Number of bathrooms
  yearBuilt?: number;              // Year built
  daysOnMarket?: number;           // Days on market
  motivation?: string;             // Seller motivation (distressed, inherited, relocating, etc.)
  sellerTimeline?: string;         // How quickly seller needs to close
  taxValue?: number;               // Tax assessed value
  zestimate?: number;              // Zillow Zestimate
  localComps?: Array<{price: number; address: string; soldDate: string}>; // Recent comparable sales
  state?: string;                  // US state
  county?: string;                 // County
  neighborhood?: string;           // Neighborhood name
  marketSpeed?: string;            // buyer/seller/balanced
  holdingCosts?: number;           // Monthly holding costs (taxes, insurance, utilities)
  closingCosts?: number;           // Estimated closing costs
}

export interface NegotiationResult {
  minimumOffer: number;
  recommendedOffer: number;
  maximumOffer: number;
  expectedAssignmentFee: number;
  expectedBuyerSpread: number;
  expectedCashBuyerInterest: 'high' | 'medium' | 'low';
  riskScore: number;              // 0-100, higher = more risk
  confidenceScore: number;        // 0-100
  estimatedDaysToAssign: number;
  reasoning: {
    why: string;
    how: string;
    marketAssumptions: string;
    exitStrategy: string;
  };
}

/**
 * Build the AI prompt for wholesale negotiation analysis.
 */
export function buildNegotiationPrompt(inputs: NegotiationInputs): string {
  const {
    arv, repairCosts, condition, squareFootage, bedrooms, bathrooms,
    yearBuilt, daysOnMarket, motivation, sellerTimeline,
    taxValue, zestimate, localComps, state, county, neighborhood,
    marketSpeed, holdingCosts, closingCosts,
  } = inputs;

  const compSummary = localComps && localComps.length > 0
    ? localComps.map(c => `$${c.price.toLocaleString()} (${c.address}, sold ${c.soldDate})`).join('; ')
    : 'No comps provided';

  return `You are an expert real estate wholesaling analyst with deep knowledge of US wholesale markets. Analyze the following property and provide a detailed negotiation strategy.

## Property Information
- After Repair Value (ARV): ${arv ? `$${arv.toLocaleString()}` : 'Not provided'}
- Estimated Repair Costs: ${repairCosts ? `$${repairCosts.toLocaleString()}` : 'Not provided'}
- Condition: ${condition || 'Not provided'}
- Square Footage: ${squareFootage || 'Not provided'}
- Bedrooms: ${bedrooms || 'Not provided'}
- Bathrooms: ${bathrooms || 'Not provided'}
- Year Built: ${yearBuilt || 'Not provided'}
- Days on Market: ${daysOnMarket || 'Not provided'}
- Seller Motivation: ${motivation || 'Not provided'}
- Seller Timeline: ${sellerTimeline || 'Not provided'}
- Tax Assessed Value: ${taxValue ? `$${taxValue.toLocaleString()}` : 'Not provided'}
- Zestimate: ${zestimate ? `$${zestimate.toLocaleString()}` : 'Not provided'}
- Location: ${neighborhood || ''}, ${county || ''}, ${state || ''}
- Market Speed: ${marketSpeed || 'Not provided'}
- Monthly Holding Costs: ${holdingCosts ? `$${holdingCosts.toLocaleString()}` : 'Not provided'}
- Estimated Closing Costs: ${closingCosts ? `$${closingCosts.toLocaleString()}` : 'Not provided'}

## Recent Comparable Sales
${compSummary}

## Analysis Requirements

Calculate the following with detailed reasoning:

1. **Minimum Offer** — The lowest offer that still leaves room for profit. Consider: 70% rule baseline, repair costs, holding costs, closing costs, and minimum viable assignment fee.

2. **Recommended Offer** — Your best estimate of a competitive offer that has high probability of acceptance while preserving healthy profit. This should be data-driven based on the inputs.

3. **Maximum Offer** — The highest you can offer while still expecting a profitable assignment. Beyond this, the deal becomes marginal or unprofitable.

4. **Expected Assignment Fee** — Realistic wholesale assignment fee for this market and deal size. Typical range: $3,000-$15,000 for standard deals, higher for premium properties or hot markets.

5. **Expected Buyer Spread** — The margin a cash buyer would expect (difference between your assignment price and their all-in cost vs ARV).

6. **Expected Cash Buyer Interest** — High, Medium, or Low based on the numbers.

7. **Risk Score** (0-100) — Higher means more risk. Factors: high repairs, long DOM, weak comps, slow market, title issues potential.

8. **Confidence Score** (0-100) — How confident you are in the analysis based on data completeness and quality.

9. **Estimated Days to Assign** — How long to find a cash buyer, based on market speed and deal attractiveness.

10. **Reasoning** — Explain:
    - WHY these numbers make sense for this deal
    - HOW you calculated them
    - MARKET ASSUMPTIONS you're making
    - EXIT STRATEGY (who would buy this, at what price, why)

## Output Format

Return ONLY a JSON object with this exact structure (no markdown, no code fences):

{
  "minimumOffer": number,
  "recommendedOffer": number,
  "maximumOffer": number,
  "expectedAssignmentFee": number,
  "expectedBuyerSpread": number,
  "expectedCashBuyerInterest": "high" | "medium" | "low",
  "riskScore": number,
  "confidenceScore": number,
  "estimatedDaysToAssign": number,
  "reasoning": {
    "why": "string",
    "how": "string", 
    "marketAssumptions": "string",
    "exitStrategy": "string"
  }
}

## Rules
- All dollar amounts in whole dollars (no cents)
- Be realistic: don't inflate assignment fees or assume unrealistic spreads
- If data is missing, state assumptions clearly and lower confidence score
- The 70% rule is a starting point, not a hard constraint — adjust for market conditions
- Consider that cash buyers typically want 15-25% margin after repairs
- Assignment fees should be competitive for the market (often $5,000-$10,000 on typical deals)`;
}

/**
 * Parse and validate the AI response into a NegotiationResult.
 */
export function parseNegotiationResponse(text: string): NegotiationResult {
  // Strip any markdown code fences
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI returned invalid JSON');
  }

  // Validate required fields
  const requiredNumbers = ['minimumOffer', 'recommendedOffer', 'maximumOffer', 'expectedAssignmentFee', 'expectedBuyerSpread', 'riskScore', 'confidenceScore', 'estimatedDaysToAssign'];
  for (const field of requiredNumbers) {
    if (typeof parsed[field] !== 'number' || !Number.isFinite(parsed[field])) {
      throw new Error(`Missing or invalid field: ${field}`);
    }
  }

  if (!parsed.reasoning || typeof parsed.reasoning !== 'object') {
    throw new Error('Missing reasoning object');
  }

  const interest = parsed.expectedCashBuyerInterest;
  if (!['high', 'medium', 'low'].includes(interest)) {
    parsed.expectedCashBuyerInterest = 'medium';
  }

  // Sanity checks
  const result: NegotiationResult = {
    minimumOffer: Math.max(0, Math.round(parsed.minimumOffer)),
    recommendedOffer: Math.max(0, Math.round(parsed.recommendedOffer)),
    maximumOffer: Math.max(0, Math.round(parsed.maximumOffer)),
    expectedAssignmentFee: Math.max(0, Math.round(parsed.expectedAssignmentFee)),
    expectedBuyerSpread: Math.max(0, Math.round(parsed.expectedBuyerSpread)),
    expectedCashBuyerInterest: parsed.expectedCashBuyerInterest,
    riskScore: Math.min(100, Math.max(0, Math.round(parsed.riskScore))),
    confidenceScore: Math.min(100, Math.max(0, Math.round(parsed.confidenceScore))),
    estimatedDaysToAssign: Math.max(1, Math.round(parsed.estimatedDaysToAssign)),
    reasoning: {
      why: String(parsed.reasoning.why || ''),
      how: String(parsed.reasoning.how || ''),
      marketAssumptions: String(parsed.reasoning.marketAssumptions || ''),
      exitStrategy: String(parsed.reasoning.exitStrategy || ''),
    },
  };

  // Business logic validation
  if (result.minimumOffer > result.recommendedOffer) {
    result.minimumOffer = Math.round(result.recommendedOffer * 0.85);
  }
  if (result.recommendedOffer > result.maximumOffer) {
    result.maximumOffer = Math.round(result.recommendedOffer * 1.1);
  }

  return result;
}