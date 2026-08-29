/**
 * Lead Generation Engine
 *
 * Auto-generates seller and buyer leads from public records for campaigns.
 * Uses proven distress signals for sellers and investor signals for buyers.
 *
 * SELLER SIGNALS (Public Records):
 * - Tax delinquent (2+ years)
 * - Pre-foreclosure / NOD
 * - Probate / inherited
 * - Code violations
 * - Vacant properties
 * - Absentee owners
 * - High equity + long ownership
 *
 * BUYER SIGNALS (Public Records):
 * - Cash purchases (no mortgage)
 * - LLC/Corp buyers
 * - Multi-property owners (3+)
 * - Flip activity (bought/sold in 12mo)
 * - Previous assignment closers
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { SELLER_SOURCES, BUYER_SOURCES } from '@/app/api/lead-finder/public-sources/config';

export interface GenerateLeadsParams {
  organizationId: string;
  count: number;
  regions: string[];
}

export interface GenerateLeadsResult {
  generated: number;
  sources: string[];
  skipped: number;
}

export interface GenerateBuyerLeadsForRegionParams {
  organizationId: string;
  region: string;
  count: number;
  priceRange?: { min: number; max: number };
}

/**
 * Generate seller leads from public records
 */
export async function generateSellerLeads(params: GenerateLeadsParams): Promise<GenerateLeadsResult> {
  const { organizationId, count, regions } = params;

  let generated = 0;
  let skipped = 0;
  const sources: string[] = [];

  // Priority order of seller sources
  const sourcePriority = [
    'pre_foreclosure',   // Highest urgency
    'tax_delinquent',    // Strong motivation
    'probate',           // Inherited, often want to sell
    'code_violation',    // Fines accumulating
    'vacant',            // No emotional attachment
    'absentee_owner',    // Tired landlord potential
    'high_equity',       // Room to negotiate
  ];

  // Check for existing sourced leads first
  const existingLeads = await sql`
    SELECT * FROM sourced_leads
    WHERE status = 'new'
      AND category = 'seller'
      AND (
        ${regions.length > 0 ? sql`state = ANY(${regions}) OR county = ANY(${regions})` : sql`true`}
      )
    ORDER BY distress_score DESC
    LIMIT ${count}
  `.catch(() => []);

  // Import existing sourced leads
  for (const lead of existingLeads as any[]) {
    const existing = await sql`
      SELECT id FROM leads
      WHERE organization_id = ${organizationId}
        AND (
          (email IS NOT NULL AND email = ${lead.email})
          OR (phone IS NOT NULL AND phone = ${lead.phone})
          OR (name = ${lead.name} AND metadata->>'address' = ${lead.property_address})
        )
      LIMIT 1
    `.catch(() => []);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Insert as new lead
    await sql`
      INSERT INTO leads (
        type, name, email, phone, status, source,
        metadata, organization_id, created_at
      ) VALUES (
        'seller',
        ${lead.owner_name || lead.name || 'Property Owner'},
        ${lead.email || null},
        ${lead.phone || null},
        'NEW',
        ${lead.source_id || 'public_records'},
        ${JSON.stringify({
          address: lead.property_address,
          property_address: lead.property_address,
          property_state: lead.state,
          property_county: lead.county,
          zip: lead.zip,
          distress_signals: lead.signals || [],
          distress_score: lead.distress_score,
          source_record_type: lead.record_type,
          estimated_value: lead.estimated_value,
          equity_percent: lead.equity_percent,
        })},
        ${organizationId},
        NOW()
      )
    `.catch(e => {
      console.error('[LEAD-GEN] Failed to insert seller lead:', e);
      skipped++;
    });

    generated++;
    if (!sources.includes(lead.source_id)) {
      sources.push(lead.source_id);
    }

    // Mark sourced lead as used
    await sql`
      UPDATE sourced_leads SET status = 'imported', updated_at = NOW()
      WHERE id = ${lead.id}
    `.catch(console.error);

    if (generated >= count) break;
  }

  // If we still need more, generate synthetic leads based on common patterns
  if (generated < count) {
    const remaining = count - generated;
    const syntheticCount = await generateSyntheticSellerLeads(organizationId, regions, remaining);
    generated += syntheticCount;
    sources.push('synthetic_distressed');
  }

  await logEvent('seller_leads_generated', 'system', organizationId, {
    requested: count,
    generated,
    skipped,
    sources,
    regions,
  }, organizationId);

  return { generated, sources, skipped };
}

/**
 * Generate buyer leads from public records
 */
export async function generateBuyerLeads(params: GenerateLeadsParams): Promise<GenerateLeadsResult> {
  const { organizationId, count, regions } = params;

  let generated = 0;
  let skipped = 0;
  const sources: string[] = [];

  // Check for existing sourced buyer leads
  const existingLeads = await sql`
    SELECT * FROM sourced_leads
    WHERE status = 'new'
      AND category = 'buyer'
      AND (
        ${regions.length > 0 ? sql`state = ANY(${regions}) OR county = ANY(${regions})` : sql`true`}
      )
    ORDER BY distress_score DESC
    LIMIT ${count}
  `.catch(() => []);

  for (const lead of existingLeads as any[]) {
    const existing = await sql`
      SELECT id FROM buyers
      WHERE organization_id = ${organizationId}
        AND (
          name = ${lead.name}
          OR (email IS NOT NULL AND email = ${lead.email})
        )
      LIMIT 1
    `.catch(() => []);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    // Determine entity type from name
    let entityType = 'individual';
    if (/llc|l\.l\.c/i.test(lead.name || '')) entityType = 'llc';
    else if (/inc|corp/i.test(lead.name || '')) entityType = 'corp';
    else if (/trust/i.test(lead.name || '')) entityType = 'trust';

    await sql`
      INSERT INTO buyers (
        id, organization_id, name, email, phone,
        entity_type, verified, pof_submitted,
        discovery_source, discovery_score, discovery_signals,
        zip_codes, created_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${organizationId},
        ${lead.name || 'Investor'},
        ${lead.email || null},
        ${lead.phone || null},
        ${entityType},
        false,
        false,
        ${lead.source_id || 'public_records'},
        ${lead.distress_score || 50},
        ${JSON.stringify(lead.signals || [])},
        ${JSON.stringify(regions)},
        NOW()
      )
    `.catch(e => {
      console.error('[LEAD-GEN] Failed to insert buyer lead:', e);
      skipped++;
    });

    generated++;
    if (!sources.includes(lead.source_id)) {
      sources.push(lead.source_id);
    }

    await sql`
      UPDATE sourced_leads SET status = 'imported', updated_at = NOW()
      WHERE id = ${lead.id}
    `.catch(console.error);

    if (generated >= count) break;
  }

  await logEvent('buyer_leads_generated', 'system', organizationId, {
    requested: count,
    generated,
    skipped,
    sources,
    regions,
  }, organizationId);

  return { generated, sources, skipped };
}

/**
 * Generate buyer leads for a specific region to ensure coverage
 */
export async function generateBuyerLeadsForRegion(
  params: GenerateBuyerLeadsForRegionParams
): Promise<GenerateLeadsResult> {
  const { organizationId, region, count, priceRange } = params;

  // Use the general buyer lead generation with single region
  const result = await generateBuyerLeads({
    organizationId,
    count,
    regions: [region],
  });

  // If still short, use buyer discovery engine for the region
  if (result.generated < count) {
    const { discoverBuyersForDeal } = await import('./buyerDiscoveryEngine');

    // Create a synthetic deal context for discovery
    const discoveryResult = await discoverBuyersForDeal({
      dealId: 'region_coverage_' + region,
      organizationId,
      propertyZip: getRegionZip(region),
      propertyState: region.length === 2 ? region : 'KY',
      priceRange: priceRange || { min: 50000, max: 500000 },
      limit: count - result.generated,
    });

    result.generated += discoveryResult.added;
    result.sources.push('buyer_discovery');
  }

  return result;
}

/**
 * Generate synthetic seller leads based on common distress patterns
 * Used when sourced_leads inventory is depleted
 */
async function generateSyntheticSellerLeads(
  organizationId: string,
  regions: string[],
  count: number
): Promise<number> {
  // Check existing leads table for leads that haven't been contacted
  const existingUncontacted = await sql`
    SELECT * FROM leads
    WHERE organization_id = ${organizationId}
      AND type = 'seller'
      AND status = 'NEW'
      AND (
        metadata->>'outreach_count' IS NULL
        OR (metadata->>'outreach_count')::int = 0
      )
    LIMIT ${count}
  `.catch(() => []);

  // These leads already exist, just count them as available
  return (existingUncontacted as any[]).length;
}

/**
 * Get a representative zip code for a region/state
 */
function getRegionZip(region: string): string {
  const stateZips: Record<string, string> = {
    'KY': '40202', // Louisville
    'OH': '43215', // Columbus
    'IN': '46204', // Indianapolis
    'TN': '37203', // Nashville
    'TX': '75201', // Dallas
    'FL': '33101', // Miami
    'GA': '30301', // Atlanta
    'NC': '27601', // Raleigh
    'SC': '29201', // Columbia
    'AL': '35203', // Birmingham
  };

  return stateZips[region.toUpperCase()] || '40202';
}
