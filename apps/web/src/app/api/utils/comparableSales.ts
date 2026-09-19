/**
 * Comparable Sales Pricing Engine
 *
 * Provides AI-driven pricing recommendations based on comparable property sales.
 * Used by the negotiation engine to suggest offer ranges and assignment fees.
 *
 * Data Flow:
 * 1. getComparableSales() - Fetches comps from lead data or external APIs
 * 2. calculateARV() - Weighted average based on similarity to subject property
 * 3. suggestOfferPrice() - Calculate max offer using 70% rule with adjustments
 * 4. suggestNegotiationBounds() - Returns min/max for AI negotiation
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import {
  computeValuation,
  computeDealEconomics,
  type NegotiationProfileParams,
  type ConditionTier,
} from './valuationEngine';
import { DEFAULT_FEE_FLOOR_CENTS } from './negotiationEngine';

// ============================================================================
// TYPES
// ============================================================================

export interface ComparableProperty {
  address: string;
  soldPrice: number; // dollars
  soldDate: Date;
  sqft: number;
  bedrooms: number;
  bathrooms: number;
  condition: string;
  distance: number; // miles from subject property
}

export interface PriceEstimate {
  estimatedARV: number; // dollars
  confidence: 'high' | 'medium' | 'low';
  comparablesUsed: number;
  pricePerSqft: number;
  suggestedOfferRange: { min: number; max: number }; // dollars
  suggestedAssignmentFee: number; // dollars
  methodology: string;
}

export interface SubjectProperty {
  address?: string;
  zip: string;
  sqft: number;
  bedrooms: number;
  bathrooms: number;
  condition: ConditionTier;
  lat?: number;
  lng?: number;
}

export interface CompFetchOptions {
  radiusMiles?: number;
  monthsBack?: number;
  maxComps?: number;
}

export interface NegotiationBounds {
  minOfferCents: number;
  maxOfferCents: number;
  targetOfferCents: number;
  arvCents: number;
  confidence: 'high' | 'medium' | 'low';
  assignmentFeeCents: number;
  methodology: string[];
}

// ============================================================================
// COMPARABLE SALES FETCHING
// ============================================================================

/**
 * Fetch comparable sales for a property.
 * Attempts external APIs first, falls back to internal database.
 */
export async function getComparableSales(
  property: SubjectProperty,
  options: CompFetchOptions = {}
): Promise<ComparableProperty[]> {
  const { radiusMiles = 0.5, monthsBack = 6, maxComps = 10 } = options;

  // Try external API (PropStream, ATTOM, Zillow)
  let comps = await fetchExternalComps(property, radiusMiles, monthsBack);

  // Fall back to internal database
  if (comps.length === 0) {
    comps = await fetchInternalComps(property, radiusMiles, monthsBack);
  }

  // Filter and rank by similarity
  const ranked = comps
    .map((comp) => ({
      ...comp,
      similarityScore: calculateSimilarityScore(property, comp),
    }))
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, maxComps);

  // Return without similarity score (internal metric)
  return ranked.map(({ similarityScore: _, ...comp }) => comp);
}

/**
 * Fetch comps from external APIs (PropStream, ATTOM, Zillow via RapidAPI).
 */
async function fetchExternalComps(
  property: SubjectProperty,
  radiusMiles: number,
  monthsBack: number
): Promise<ComparableProperty[]> {
  const comps: ComparableProperty[] = [];

  // PropStream API
  if (process.env.PROPSTREAM_API_KEY) {
    try {
      // PropStream integration would go here
      // const response = await fetch(`https://api.propstream.com/v1/comps?...`);
    } catch (err) {
      console.error('[COMPS] PropStream error:', err);
    }
  }

  // ATTOM API
  if (comps.length === 0 && process.env.ATTOM_API_KEY) {
    try {
      // ATTOM integration would go here
      // const response = await fetch(`https://api.gateway.attomdata.com/...`);
    } catch (err) {
      console.error('[COMPS] ATTOM error:', err);
    }
  }

  // Zillow via RapidAPI
  if (comps.length === 0 && process.env.RAPIDAPI_KEY) {
    try {
      // RapidAPI Zillow integration would go here
      // const response = await fetch(`https://zillow-com1.p.rapidapi.com/...`);
    } catch (err) {
      console.error('[COMPS] Zillow error:', err);
    }
  }

  return comps;
}

/**
 * Fetch comps from internal database (previous deals, imports).
 */
async function fetchInternalComps(
  property: SubjectProperty,
  radiusMiles: number,
  monthsBack: number
): Promise<ComparableProperty[]> {
  const { zip, sqft, bedrooms, bathrooms } = property;
  const sqftMin = Math.round(sqft * 0.8);
  const sqftMax = Math.round(sqft * 1.2);

  try {
    const rows = await sql`
      SELECT
        address,
        sold_price,
        sold_date,
        sqft,
        beds,
        baths,
        condition,
        0.3 as distance
      FROM property_comps
      WHERE zip = ${zip}
        AND sqft BETWEEN ${sqftMin} AND ${sqftMax}
        AND beds BETWEEN ${bedrooms - 1} AND ${bedrooms + 1}
        AND baths BETWEEN ${bathrooms - 1} AND ${bathrooms + 1}
        AND sold_date > NOW() - INTERVAL '${monthsBack} months'
      ORDER BY sold_date DESC
      LIMIT 20
    `.catch(() => []);

    return (rows as any[]).map((row) => ({
      address: row.address || 'Unknown',
      soldPrice: Number(row.sold_price) || 0,
      soldDate: new Date(row.sold_date),
      sqft: Number(row.sqft) || 0,
      bedrooms: Number(row.beds) || 0,
      bathrooms: Number(row.baths) || 0,
      condition: row.condition || 'unknown',
      distance: Number(row.distance) || 0.3,
    }));
  } catch {
    return [];
  }
}

/**
 * Calculate similarity score between subject property and a comparable.
 * Higher score = more similar property.
 */
function calculateSimilarityScore(
  subject: SubjectProperty,
  comp: ComparableProperty
): number {
  let score = 1.0;

  // Square footage similarity (most important)
  const sqftDiff = Math.abs(comp.sqft - subject.sqft) / subject.sqft;
  if (sqftDiff <= 0.1) score += 0.2;
  else if (sqftDiff <= 0.2) score += 0.1;
  else if (sqftDiff > 0.3) score -= 0.2;

  // Bedroom match
  const bedDiff = Math.abs(comp.bedrooms - subject.bedrooms);
  if (bedDiff === 0) score += 0.15;
  else if (bedDiff > 1) score -= 0.15;

  // Bathroom match
  const bathDiff = Math.abs(comp.bathrooms - subject.bathrooms);
  if (bathDiff === 0) score += 0.1;
  else if (bathDiff > 1) score -= 0.1;

  // Distance penalty (closer is better)
  if (comp.distance <= 0.25) score += 0.15;
  else if (comp.distance <= 0.5) score += 0.1;
  else if (comp.distance > 1.0) score -= 0.1;

  // Recency bonus (more recent = more relevant)
  const daysSinceSale = Math.floor(
    (Date.now() - comp.soldDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSinceSale <= 30) score += 0.15;
  else if (daysSinceSale <= 60) score += 0.1;
  else if (daysSinceSale > 120) score -= 0.1;

  return Math.max(0, Math.min(2, score));
}

// ============================================================================
// ARV CALCULATION
// ============================================================================

/**
 * Calculate the After Repair Value (ARV) using weighted comparable average.
 * Weights are based on similarity to the subject property.
 */
export function calculateARV(
  property: SubjectProperty,
  comparables: ComparableProperty[]
): {
  arv: number;
  confidence: 'high' | 'medium' | 'low';
  pricePerSqft: number;
  methodology: string;
} {
  if (comparables.length === 0) {
    return {
      arv: 0,
      confidence: 'low',
      pricePerSqft: 0,
      methodology: 'No comparable sales available',
    };
  }

  // Calculate weighted price per sqft
  const weights = comparables.map((comp) =>
    calculateSimilarityScore(property, comp)
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  if (totalWeight === 0) {
    return {
      arv: 0,
      confidence: 'low',
      pricePerSqft: 0,
      methodology: 'Unable to weight comparables',
    };
  }

  // Weighted average price per sqft
  const weightedPricePerSqft = comparables.reduce((sum, comp, i) => {
    const pricePerSqft = comp.soldPrice / comp.sqft;
    return sum + pricePerSqft * (weights[i] / totalWeight);
  }, 0);

  const arv = Math.round(weightedPricePerSqft * property.sqft);

  // Determine confidence based on comp quality
  let confidence: 'high' | 'medium' | 'low';
  const avgWeight = totalWeight / comparables.length;
  if (comparables.length >= 5 && avgWeight >= 1.0) {
    confidence = 'high';
  } else if (comparables.length >= 3 && avgWeight >= 0.8) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    arv,
    confidence,
    pricePerSqft: Math.round(weightedPricePerSqft),
    methodology: `Weighted average of ${comparables.length} comparable sales within similar size/bed/bath range`,
  };
}

// ============================================================================
// OFFER PRICE CALCULATION
// ============================================================================

/**
 * Suggest an offer price based on ARV, condition, and seller motivation.
 * Uses the 70% rule as baseline with adjustments.
 */
export function suggestOfferPrice(
  arv: number,
  condition: ConditionTier,
  motivationScore: number = 0.5 // 0-1, higher = more motivated seller
): {
  minOffer: number;
  maxOffer: number;
  targetOffer: number;
  repairs: number;
  methodology: string;
} {
  // Estimate repairs based on condition tier
  const repairMultipliers: Record<ConditionTier, number> = {
    light: 0.05, // 5% of ARV
    moderate: 0.12, // 12% of ARV
    heavy: 0.22, // 22% of ARV
  };

  const repairs = Math.round(arv * repairMultipliers[condition]);

  // 70% rule: MAO = ARV * 0.70 - Repairs
  const baseMAO = arv * 0.7 - repairs;

  // Adjust for motivation (motivated sellers = can offer less)
  const motivationAdjustment = 1 - motivationScore * 0.1; // Up to 10% less for highly motivated

  const maxOffer = Math.round(baseMAO * motivationAdjustment);
  const minOffer = Math.round(maxOffer * 0.85); // Start 15% below max
  const targetOffer = Math.round(maxOffer * 0.92); // Target 8% below max

  return {
    minOffer: Math.max(0, minOffer),
    maxOffer: Math.max(0, maxOffer),
    targetOffer: Math.max(0, targetOffer),
    repairs,
    methodology: `70% rule: (ARV $${arv.toLocaleString()} x 0.70) - repairs $${repairs.toLocaleString()} = MAO $${Math.round(baseMAO).toLocaleString()}, adjusted for ${condition} condition and ${Math.round(motivationScore * 100)}% motivation`,
  };
}

// ============================================================================
// NEGOTIATION BOUNDS
// ============================================================================

/**
 * Calculate suggested negotiation bounds for a property.
 * This is the main entry point for AI-driven pricing in negotiations.
 */
export async function suggestNegotiationBounds(
  leadId: number,
  organizationId: string,
  profile?: NegotiationProfileParams
): Promise<NegotiationBounds | null> {
  // Fetch lead data
  const [lead] = await sql`
    SELECT metadata FROM leads WHERE id = ${leadId}
  `.catch(() => []);

  if (!lead?.metadata) {
    return null;
  }

  const metadata = lead.metadata as Record<string, any>;

  // Extract property details from metadata
  const property: SubjectProperty = {
    address: metadata.address,
    zip: metadata.zip || '',
    sqft: Number(metadata.sqft) || 1500, // Default if missing
    bedrooms: Number(metadata.beds) || Number(metadata.bedrooms) || 3,
    bathrooms: Number(metadata.baths) || Number(metadata.bathrooms) || 2,
    condition: (metadata.condition as ConditionTier) || 'moderate',
    lat: metadata.lat,
    lng: metadata.lng,
  };

  if (!property.zip) {
    // Try to extract zip from address
    const zipMatch = property.address?.match(/\b\d{5}(?:-\d{4})?\b/);
    if (zipMatch) {
      property.zip = zipMatch[0];
    } else {
      return null; // Cannot proceed without location data
    }
  }

  const methodology: string[] = [];

  // Get comparable sales
  const comps = await getComparableSales(property, {
    radiusMiles: 0.5,
    monthsBack: 6,
    maxComps: 10,
  });

  methodology.push(`Found ${comps.length} comparable sales`);

  // Calculate ARV
  const arvResult = calculateARV(property, comps);
  methodology.push(arvResult.methodology);

  if (arvResult.arv === 0) {
    // Fall back to AVM or manual entry if available
    if (metadata.avm) {
      arvResult.arv = Number(metadata.avm);
      methodology.push(`Using AVM estimate: $${arvResult.arv.toLocaleString()}`);
    } else {
      return null; // Cannot suggest bounds without ARV
    }
  }

  // Get motivation score if available
  const motivationScore =
    metadata.motivation_score || metadata.motivationScore || 0.5;

  // Calculate offer range
  const offerResult = suggestOfferPrice(
    arvResult.arv,
    property.condition,
    motivationScore
  );
  methodology.push(offerResult.methodology);

  // Calculate assignment fee (based on 70% rule spread)
  const assignmentFee = Math.max(
    DEFAULT_FEE_FLOOR_CENTS / 100, // Minimum $5,000
    Math.round((arvResult.arv * 0.7 - offerResult.maxOffer) * 0.5) // Half the spread
  );

  // Log the estimation
  await logEvent(
    'ai_pricing_suggested',
    'lead',
    String(leadId),
    {
      arv: arvResult.arv,
      confidence: arvResult.confidence,
      minOffer: offerResult.minOffer,
      maxOffer: offerResult.maxOffer,
      comparablesUsed: comps.length,
      assignmentFee,
    },
    organizationId
  );

  return {
    minOfferCents: offerResult.minOffer * 100,
    maxOfferCents: offerResult.maxOffer * 100,
    targetOfferCents: offerResult.targetOffer * 100,
    arvCents: arvResult.arv * 100,
    confidence: arvResult.confidence,
    assignmentFeeCents: assignmentFee * 100,
    methodology,
  };
}

// ============================================================================
// FULL PRICE ESTIMATE
// ============================================================================

/**
 * Get a complete price estimate for a property.
 * Combines all pricing functions into a single response.
 */
export async function getPriceEstimate(
  property: SubjectProperty,
  motivationScore: number = 0.5
): Promise<PriceEstimate> {
  // Get comparable sales
  const comps = await getComparableSales(property);

  // Calculate ARV
  const arvResult = calculateARV(property, comps);

  // Calculate offer range
  const offerResult = suggestOfferPrice(
    arvResult.arv,
    property.condition,
    motivationScore
  );

  // Calculate suggested assignment fee
  const spread = arvResult.arv * 0.7 - offerResult.maxOffer;
  const suggestedAssignmentFee = Math.max(5000, Math.round(spread * 0.5));

  return {
    estimatedARV: arvResult.arv,
    confidence: arvResult.confidence,
    comparablesUsed: comps.length,
    pricePerSqft: arvResult.pricePerSqft,
    suggestedOfferRange: {
      min: offerResult.minOffer,
      max: offerResult.maxOffer,
    },
    suggestedAssignmentFee,
    methodology: `${arvResult.methodology}. ${offerResult.methodology}`,
  };
}

// ============================================================================
// INTEGRATION WITH VALUATION ENGINE
// ============================================================================

/**
 * Enhance the valuation engine with comparable sales data.
 * Returns bounds compatible with the negotiation engine.
 */
export async function getEnhancedValuation(
  leadId: number,
  organizationId: string,
  profile: NegotiationProfileParams
): Promise<{
  bounds: NegotiationBounds | null;
  valuation: ReturnType<typeof computeValuation> | null;
  dealEconomics: ReturnType<typeof computeDealEconomics> | null;
}> {
  // Get AI-suggested bounds
  const bounds = await suggestNegotiationBounds(leadId, organizationId, profile);

  if (!bounds) {
    return { bounds: null, valuation: null, dealEconomics: null };
  }

  // Compute formal valuation using the ARV from comps
  const [lead] = await sql`
    SELECT metadata FROM leads WHERE id = ${leadId}
  `.catch(() => []);

  const metadata = lead?.metadata as Record<string, any> || {};
  const sqft = Number(metadata.sqft) || 1500;
  const condition: ConditionTier = metadata.condition || 'moderate';

  const valuation = computeValuation(
    {
      arv: bounds.arvCents / 100,
      sqft,
      conditionTier: condition,
      bigTicketFlags: metadata.bigTicketFlags || [],
      hasAvm: !!metadata.avm,
      compsCount: bounds.methodology.length > 0 ? 5 : 0,
    },
    profile
  );

  // Compute deal economics if we have a suggested offer
  const dealEconomics = computeDealEconomics(
    {
      arv: bounds.arvCents / 100,
      repairs: valuation.formulaTrace
        .find((t) => t.startsWith('Repairs:'))
        ?.match(/= \$([0-9,]+)/)?.[1]
        ?.replace(/,/g, '') || 0
        ? Number(
            valuation.formulaTrace
              .find((t) => t.startsWith('Repairs:'))
              ?.match(/= \$([0-9,]+)/)?.[1]
              ?.replace(/,/g, '')
          )
        : 0,
    },
    profile
  );

  return { bounds, valuation, dealEconomics };
}
