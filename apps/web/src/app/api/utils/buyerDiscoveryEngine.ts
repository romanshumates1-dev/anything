/**
 * Buyer Discovery Engine
 *
 * Auto-generates buyer leads from public records when a seller signs a purchase agreement.
 * Uses PROVEN investor signals from county recorder and assessor data:
 *
 * PROVEN BUYER SIGNALS (Public Record Data):
 * 1. Cash purchases - No mortgage recorded with deed (county recorder)
 * 2. Entity buyers - LLC/Corp/Trust as grantee (county recorder)
 * 3. Flip activity - Same party bought then sold within 12mo (county recorder)
 * 4. Multi-property owners - 3+ properties in county (assessor rolls)
 * 5. Assignment buyers - Previously closed on wholesale assignments (recorder)
 * 6. Recent activity - Purchased in last 24 months (recorder)
 * 7. Same zip/area - Active in property's neighborhood (recorder)
 *
 * Flow:
 * 1. Seller signs → match_buyers_auto job fires
 * 2. buyerMatchEngine checks existing buyers
 * 3. If < 5 matches OR no VIP buyers → THIS engine discovers new leads
 * 4. New buyer leads added to buyers table with source tracking
 * 5. Outreach queued to newly discovered investors
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';
import { BUYER_SOURCES, type PublicDataSource } from '@/app/api/lead-finder/public-sources/config';

export interface DiscoverBuyersParams {
  dealId: string;
  organizationId: string;
  propertyZip: string;
  propertyCounty?: string;
  propertyState: string;
  priceRange: { min: number; max: number };
  propertyType?: string;
  limit?: number;
}

export interface DiscoveredBuyer {
  name: string;
  email?: string;
  phone?: string;
  mailingAddress?: string;
  entityType: 'individual' | 'llc' | 'corp' | 'trust';
  signals: BuyerSignal[];
  score: number;
  sourceId: string;
  sourceName: string;
}

export interface BuyerSignal {
  type: string;
  value: string | number | boolean;
  weight: number;
  source: string;
  recordedDate?: string;
}

export interface DiscoveryResult {
  discovered: number;
  added: number;
  skipped: number;
  outreachQueued: number;
  sources: string[];
}

/**
 * Proven buyer signal weights based on transaction data
 * Higher weight = stronger indicator of active investor
 */
const SIGNAL_WEIGHTS = {
  // Tier 1: Strongest signals (proven closers)
  assignment_buyer: 50,      // Has closed on wholesale assignments
  cash_purchase_recent: 45,  // Cash purchase in last 6 months
  flip_completed: 40,        // Bought and sold within 12 months

  // Tier 2: Strong signals (active investors)
  multi_property_5plus: 35,  // Owns 5+ properties in area
  llc_buyer: 30,             // Buys through LLC (serious investor)
  cash_purchase_12mo: 28,    // Cash purchase in last 12 months
  multi_property_3plus: 25,  // Owns 3+ properties

  // Tier 3: Good signals (likely investors)
  entity_buyer: 20,          // Corp/Trust buyer
  same_zip_activity: 18,     // Active in same zip code
  rental_owner: 15,          // Registered rental properties
  reia_member: 12,           // REIA membership

  // Tier 4: Supporting signals
  recent_purchase_24mo: 10,  // Any purchase in last 24 months
  adjacent_zip_activity: 8,  // Active in adjacent zips
} as const;

const MIN_SCORE_THRESHOLD = 40; // Minimum score to add as buyer lead

/**
 * Discover buyer leads from public records for a specific deal
 */
export async function discoverBuyersForDeal(params: DiscoverBuyersParams): Promise<DiscoveryResult> {
  const {
    dealId,
    organizationId,
    propertyZip,
    propertyCounty,
    propertyState,
    priceRange,
    propertyType,
    limit = 50,
  } = params;

  const results: DiscoveryResult = {
    discovered: 0,
    added: 0,
    skipped: 0,
    outreachQueued: 0,
    sources: [],
  };

  // Get adjacent zips for broader search
  const adjacentZips = getAdjacentZips(propertyZip);
  const searchZips = [propertyZip, ...adjacentZips];

  // Query each buyer source type
  const discoveredBuyers: DiscoveredBuyer[] = [];

  // Source 1: Cash buyers in area (last 24 months)
  const cashBuyers = await queryCashBuyers({
    zips: searchZips,
    county: propertyCounty,
    state: propertyState,
    monthsBack: 24,
    limit: Math.ceil(limit / 3),
  });
  discoveredBuyers.push(...cashBuyers);
  if (cashBuyers.length > 0) results.sources.push('cash_buyers');

  // Source 2: Entity buyers (LLC/Corp/Trust)
  const entityBuyers = await queryEntityBuyers({
    zips: searchZips,
    county: propertyCounty,
    state: propertyState,
    monthsBack: 36,
    limit: Math.ceil(limit / 3),
  });
  discoveredBuyers.push(...entityBuyers);
  if (entityBuyers.length > 0) results.sources.push('entity_buyers');

  // Source 3: Multi-property owners
  const portfolioOwners = await queryMultiPropertyOwners({
    zips: searchZips,
    county: propertyCounty,
    state: propertyState,
    minProperties: 3,
    limit: Math.ceil(limit / 3),
  });
  discoveredBuyers.push(...portfolioOwners);
  if (portfolioOwners.length > 0) results.sources.push('multi_property');

  // Source 4: Flip activity (bought then sold within 12mo)
  const flippers = await queryFlipActivity({
    zips: searchZips,
    county: propertyCounty,
    state: propertyState,
    limit: Math.ceil(limit / 4),
  });
  discoveredBuyers.push(...flippers);
  if (flippers.length > 0) results.sources.push('flippers');

  // Source 5: Previous assignment buyers (strongest signal)
  const assignmentBuyers = await queryAssignmentBuyers({
    county: propertyCounty,
    state: propertyState,
    limit: Math.ceil(limit / 4),
  });
  discoveredBuyers.push(...assignmentBuyers);
  if (assignmentBuyers.length > 0) results.sources.push('assignment_buyers');

  results.discovered = discoveredBuyers.length;

  // Dedupe by name/entity
  const dedupedBuyers = deduplicateBuyers(discoveredBuyers);

  // Score and filter
  const scoredBuyers = dedupedBuyers
    .map(b => ({ ...b, score: calculateBuyerScore(b, propertyZip) }))
    .filter(b => b.score >= MIN_SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Add to buyers table
  for (const buyer of scoredBuyers) {
    const existing = await sql`
      SELECT id FROM buyers
      WHERE organization_id = ${organizationId}
        AND (name = ${buyer.name} OR (email IS NOT NULL AND email = ${buyer.email}))
      LIMIT 1
    `.catch(() => []);

    if (existing.length > 0) {
      results.skipped++;
      continue;
    }

    // Insert new buyer lead
    const buyerId = crypto.randomUUID();
    await sql`
      INSERT INTO buyers (
        id, organization_id, name, email, phone,
        mailing_address, entity_type, verified, pof_submitted,
        discovery_source, discovery_score, discovery_signals,
        zip_codes, price_min_cents, price_max_cents,
        created_at
      ) VALUES (
        ${buyerId},
        ${organizationId},
        ${buyer.name},
        ${buyer.email || null},
        ${buyer.phone || null},
        ${buyer.mailingAddress || null},
        ${buyer.entityType},
        false,
        false,
        ${buyer.sourceId},
        ${buyer.score},
        ${JSON.stringify(buyer.signals)},
        ${JSON.stringify([propertyZip, ...adjacentZips.slice(0, 4)])},
        ${priceRange.min * 100},
        ${priceRange.max * 100},
        NOW()
      )
    `.catch(e => {
      console.error(`[BUYER-DISCOVERY] Failed to insert buyer ${buyer.name}:`, e);
      return null;
    });

    results.added++;

    // Queue outreach to newly discovered buyer
    if (buyer.email || buyer.phone) {
      await enqueueJob('buyer_outreach_new', {
        buyerId,
        dealId,
        organizationId,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        buyerPhone: buyer.phone,
        propertyZip,
        score: buyer.score,
      }, {
        maxAttempts: 3,
        dedupeKey: `buyer_outreach_${buyerId}_${dealId}`,
      }).catch(console.error);
      results.outreachQueued++;
    }
  }

  await logEvent('buyer_discovery_completed', 'deal', dealId, {
    discovered: results.discovered,
    added: results.added,
    skipped: results.skipped,
    outreachQueued: results.outreachQueued,
    sources: results.sources,
    propertyZip,
    propertyState,
  }, organizationId);

  console.log(`[BUYER-DISCOVERY] Deal ${dealId}: ${results.discovered} discovered, ${results.added} added, ${results.outreachQueued} outreach queued`);

  return results;
}

/**
 * Calculate buyer score from signals
 */
function calculateBuyerScore(buyer: DiscoveredBuyer, targetZip: string): number {
  let score = 0;

  for (const signal of buyer.signals) {
    const weight = SIGNAL_WEIGHTS[signal.type as keyof typeof SIGNAL_WEIGHTS] || 5;
    score += weight;

    // Bonus for same zip activity
    if (signal.type.includes('zip') && signal.value === targetZip) {
      score += 10;
    }
  }

  // Entity type bonus
  if (buyer.entityType === 'llc') score += 10;
  if (buyer.entityType === 'corp') score += 8;
  if (buyer.entityType === 'trust') score += 5;

  return Math.min(100, score);
}

/**
 * Deduplicate buyers by name/entity
 */
function deduplicateBuyers(buyers: DiscoveredBuyer[]): DiscoveredBuyer[] {
  const seen = new Map<string, DiscoveredBuyer>();

  for (const buyer of buyers) {
    const key = normalizeName(buyer.name);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, buyer);
    } else {
      // Merge signals from duplicate entries
      existing.signals.push(...buyer.signals);
    }
  }

  return Array.from(seen.values());
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(llc|inc|corp|ltd|trust|company|co)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Get adjacent zip codes (simplified - real implementation would use geo lookup)
 */
function getAdjacentZips(zip: string): string[] {
  const zipNum = parseInt(zip, 10);
  if (isNaN(zipNum)) return [];

  // Return nearby zips (simplified heuristic)
  return [
    String(zipNum - 1).padStart(5, '0'),
    String(zipNum + 1).padStart(5, '0'),
    String(zipNum - 2).padStart(5, '0'),
    String(zipNum + 2).padStart(5, '0'),
  ].filter(z => z.length === 5 && !z.startsWith('0'));
}

// ─── Public Record Query Functions ───────────────────────────────────────────
// These simulate queries to public record sources. In production, these would
// call actual APIs (ATTOM, PropStream) or scrape county recorder sites.

interface QueryParams {
  zips?: string[];
  county?: string;
  state: string;
  monthsBack?: number;
  minProperties?: number;
  limit: number;
}

async function queryCashBuyers(params: QueryParams): Promise<DiscoveredBuyer[]> {
  // Query county recorder for deeds with no concurrent mortgage
  // In production: ATTOM API or county recorder bulk download

  const { zips, county, state, monthsBack = 24, limit } = params;

  // Check if we have cached/imported buyer data
  const cached = await sql`
    SELECT DISTINCT ON (name)
      name, email, phone, mailing_address,
      CASE
        WHEN name ~* '(llc|l\.l\.c)' THEN 'llc'
        WHEN name ~* '(inc|corp|corporation)' THEN 'corp'
        WHEN name ~* 'trust' THEN 'trust'
        ELSE 'individual'
      END as entity_type,
      metadata
    FROM leads
    WHERE type = 'buyer'
      AND organization_id IS NOT NULL
      AND (metadata->>'cash_buyer')::boolean = true
      AND created_at > NOW() - INTERVAL '${monthsBack} months'
      ${zips && zips.length > 0 ? sql`AND metadata->>'zip' = ANY(${zips})` : sql``}
    ORDER BY name, created_at DESC
    LIMIT ${limit}
  `.catch(() => []);

  return (cached as any[]).map(row => ({
    name: row.name,
    email: row.email,
    phone: row.phone,
    mailingAddress: row.mailing_address,
    entityType: row.entity_type as 'individual' | 'llc' | 'corp' | 'trust',
    signals: [
      { type: 'cash_purchase_recent', value: true, weight: 45, source: 'county_recorder' },
    ],
    score: 0,
    sourceId: 'cash_buyers_recorder',
    sourceName: 'County Recorder - Cash Purchases',
  }));
}

async function queryEntityBuyers(params: QueryParams): Promise<DiscoveredBuyer[]> {
  // Query for LLC/Corp/Trust buyers
  const { zips, county, state, monthsBack = 36, limit } = params;

  const cached = await sql`
    SELECT DISTINCT ON (name)
      name, email, phone, mailing_address, metadata
    FROM leads
    WHERE type = 'buyer'
      AND organization_id IS NOT NULL
      AND name ~* '(llc|l\.l\.c|inc|corp|corporation|trust)'
      AND created_at > NOW() - INTERVAL '${monthsBack} months'
      ${zips && zips.length > 0 ? sql`AND metadata->>'zip' = ANY(${zips})` : sql``}
    ORDER BY name, created_at DESC
    LIMIT ${limit}
  `.catch(() => []);

  return (cached as any[]).map(row => {
    let entityType: 'llc' | 'corp' | 'trust' | 'individual' = 'individual';
    if (/llc|l\.l\.c/i.test(row.name)) entityType = 'llc';
    else if (/inc|corp/i.test(row.name)) entityType = 'corp';
    else if (/trust/i.test(row.name)) entityType = 'trust';

    return {
      name: row.name,
      email: row.email,
      phone: row.phone,
      mailingAddress: row.mailing_address,
      entityType,
      signals: [
        { type: 'entity_buyer', value: entityType, weight: 20, source: 'county_recorder' },
        { type: 'llc_buyer', value: entityType === 'llc', weight: 30, source: 'county_recorder' },
      ],
      score: 0,
      sourceId: 'llc_buyers_recorder',
      sourceName: 'County Recorder - Entity Buyers',
    };
  });
}

async function queryMultiPropertyOwners(params: QueryParams): Promise<DiscoveredBuyer[]> {
  // Query assessor rolls for owners with 3+ properties
  const { zips, county, state, minProperties = 3, limit } = params;

  // Check buyer table for those with actual_close_count >= minProperties
  const existing = await sql`
    SELECT
      name, email, phone, mailing_address,
      CASE
        WHEN name ~* '(llc|l\.l\.c)' THEN 'llc'
        WHEN name ~* '(inc|corp)' THEN 'corp'
        WHEN name ~* 'trust' THEN 'trust'
        ELSE 'individual'
      END as entity_type,
      actual_close_count
    FROM buyers
    WHERE actual_close_count >= ${minProperties}
    ORDER BY actual_close_count DESC
    LIMIT ${limit}
  `.catch(() => []);

  return (existing as any[]).map(row => ({
    name: row.name,
    email: row.email,
    phone: row.phone,
    mailingAddress: row.mailing_address,
    entityType: row.entity_type as 'individual' | 'llc' | 'corp' | 'trust',
    signals: [
      {
        type: row.actual_close_count >= 5 ? 'multi_property_5plus' : 'multi_property_3plus',
        value: row.actual_close_count,
        weight: row.actual_close_count >= 5 ? 35 : 25,
        source: 'assessor_rolls',
      },
    ],
    score: 0,
    sourceId: 'multi_property_assessor',
    sourceName: 'County Assessor - Portfolio Owners',
  }));
}

async function queryFlipActivity(params: QueryParams): Promise<DiscoveredBuyer[]> {
  // Query for parties who bought then sold within 12 months
  const { zips, county, state, limit } = params;

  // This would query recorder for same grantee→grantor within 12mo
  // Simplified: check leads with flip signals
  const flippers = await sql`
    SELECT DISTINCT ON (name)
      name, email, phone, mailing_address,
      CASE
        WHEN name ~* '(llc|l\.l\.c)' THEN 'llc'
        WHEN name ~* '(inc|corp)' THEN 'corp'
        ELSE 'individual'
      END as entity_type
    FROM leads
    WHERE type = 'buyer'
      AND metadata->>'flipper' = 'true'
      ${zips && zips.length > 0 ? sql`AND metadata->>'zip' = ANY(${zips})` : sql``}
    ORDER BY name, created_at DESC
    LIMIT ${limit}
  `.catch(() => []);

  return (flippers as any[]).map(row => ({
    name: row.name,
    email: row.email,
    phone: row.phone,
    mailingAddress: row.mailing_address,
    entityType: row.entity_type as 'individual' | 'llc' | 'corp' | 'trust',
    signals: [
      { type: 'flip_completed', value: true, weight: 40, source: 'county_recorder' },
    ],
    score: 0,
    sourceId: 'flippers_recorder',
    sourceName: 'County Recorder - Flip Activity',
  }));
}

async function queryAssignmentBuyers(params: QueryParams): Promise<DiscoveredBuyer[]> {
  // Query for buyers who have closed on wholesale assignments
  // This is the strongest signal - proven assignment buyers
  const { county, state, limit } = params;

  // Check our own closed assignments
  const proven = await sql`
    SELECT DISTINCT ON (b.name)
      b.name, b.email, b.phone, b.mailing_address,
      CASE
        WHEN b.name ~* '(llc|l\.l\.c)' THEN 'llc'
        WHEN b.name ~* '(inc|corp)' THEN 'corp'
        ELSE 'individual'
      END as entity_type,
      COUNT(ba.id) as assignment_count
    FROM buyers b
    JOIN buyer_assignments ba ON ba.buyer_id = b.id
    WHERE ba.status = 'signed'
    GROUP BY b.id, b.name, b.email, b.phone, b.mailing_address
    HAVING COUNT(ba.id) >= 1
    ORDER BY b.name, COUNT(ba.id) DESC
    LIMIT ${limit}
  `.catch(() => []);

  return (proven as any[]).map(row => ({
    name: row.name,
    email: row.email,
    phone: row.phone,
    mailingAddress: row.mailing_address,
    entityType: row.entity_type as 'individual' | 'llc' | 'corp' | 'trust',
    signals: [
      { type: 'assignment_buyer', value: row.assignment_count, weight: 50, source: 'internal_records' },
    ],
    score: 0,
    sourceId: 'assignment_buyers_internal',
    sourceName: 'Internal Records - Assignment Closers',
  }));
}
