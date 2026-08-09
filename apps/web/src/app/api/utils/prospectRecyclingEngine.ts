/**
 * Prospect Recycling Engine
 *
 * Manages recycling of prospects from past campaigns:
 * - Adds past campaign prospects back to outreach lists
 * - Ensures lead-finder doesn't return old prospects as "new"
 * - Tracks prospect history across campaigns
 * - Prevents over-contacting while maximizing re-engagement
 */

import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';

export interface RecycleConfig {
  minDaysSinceLastContact: number;
  maxContactAttempts: number;
  excludeStatuses: string[];
  prioritizeByScore: boolean;
  batchSize: number;
}

export interface RecyclableProspect {
  leadId: string;
  email?: string;
  phone?: string;
  name: string;
  address?: string;
  lastCampaignId: string;
  lastContactedAt: Date;
  totalCampaigns: number;
  totalTouches: number;
  lastStatus: string;
  recycleScore: number;
}

export interface DedupeResult {
  newLeads: number;
  duplicatesFound: number;
  mergedLeads: number;
  skippedExisting: number;
}

const DEFAULT_CONFIG: RecycleConfig = {
  minDaysSinceLastContact: 90,
  maxContactAttempts: 10,
  excludeStatuses: ['contracted', 'closed', 'blacklisted', 'dnc', 'opted_out'],
  prioritizeByScore: true,
  batchSize: 500,
};

/**
 * Find prospects eligible for recycling
 */
export async function findRecyclableProspects(
  organizationId: string,
  config: Partial<RecycleConfig> = {}
): Promise<RecyclableProspect[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Build excluded statuses as a string for IN clause
  const excludedList = cfg.excludeStatuses.map(s => `'${s}'`).join(',');

  const prospects = await sql`
    WITH prospect_history AS (
      SELECT
        l.id as lead_id,
        l.email,
        l.phone,
        l.name,
        l.raw_address as address,
        l.status as last_status,
        MAX(clq.campaign_id) as last_campaign_id,
        MAX(clq.last_sent_at) as last_contacted_at,
        COUNT(DISTINCT clq.campaign_id) as total_campaigns,
        COALESCE(SUM(clq.touches_sent), 0) as total_touches
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.organization_id = ${organizationId}
        AND l.status NOT IN ('contracted', 'closed', 'blacklisted', 'dnc', 'opted_out')
        AND (l.is_blacklisted IS NULL OR l.is_blacklisted = false)
        AND (l.opted_out IS NULL OR l.opted_out = false)
      GROUP BY l.id, l.email, l.phone, l.name, l.raw_address, l.status
      HAVING
        MAX(clq.last_sent_at) < now() - (${cfg.minDaysSinceLastContact} || ' days')::interval
        AND COALESCE(SUM(clq.touches_sent), 0) < ${cfg.maxContactAttempts}
    )
    SELECT
      ph.*,
      (
        EXTRACT(DAYS FROM (now() - ph.last_contacted_at)) * 0.1 +
        (${cfg.maxContactAttempts} - ph.total_touches) * 5 +
        CASE ph.last_status
          WHEN 'engaged' THEN 50
          WHEN 'negotiating' THEN 40
          WHEN 'contacted' THEN 30
          WHEN 'new' THEN 20
          WHEN 'lost' THEN 10
          ELSE 0
        END
      ) as recycle_score
    FROM prospect_history ph
    WHERE ph.last_contacted_at IS NOT NULL
    ORDER BY recycle_score DESC
    LIMIT ${cfg.batchSize}
  `;

  return prospects.map(p => ({
    leadId: p.lead_id,
    email: p.email,
    phone: p.phone,
    name: p.name,
    address: p.address,
    lastCampaignId: p.last_campaign_id,
    lastContactedAt: p.last_contacted_at,
    totalCampaigns: Number(p.total_campaigns),
    totalTouches: Number(p.total_touches),
    lastStatus: p.last_status,
    recycleScore: Number(p.recycle_score),
  }));
}

/**
 * Add recycled prospects to a new campaign
 */
export async function recycleProspectsToCampaign(
  organizationId: string,
  campaignId: string,
  prospectIds: string[],
  options: { resetTouchCount?: boolean; customStartingTouch?: number } = {}
): Promise<{ added: number; skipped: number; errors: number }> {
  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const leadId of prospectIds) {
    try {
      // Check if already in this campaign
      const [existing] = await sql`
        SELECT 1 FROM campaign_lead_queue
        WHERE campaign_id = ${campaignId} AND lead_id = ${leadId}
      `;

      if (existing) {
        skipped++;
        continue;
      }

      // Get prospect info
      const [lead] = await sql`
        SELECT email, phone, status FROM leads
        WHERE id = ${leadId} AND organization_id = ${organizationId}
      `;

      if (!lead) {
        errors++;
        continue;
      }

      // Add to campaign queue
      await sql`
        INSERT INTO campaign_lead_queue (
          id, campaign_id, lead_id, status, priority,
          touches_sent, is_recycled, recycled_at, created_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${campaignId},
          ${leadId},
          'pending',
          50,
          ${options.resetTouchCount ? 0 : (options.customStartingTouch || 0)},
          true,
          now(),
          now()
        )
      `;

      // Update lead status if needed
      if (lead.status === 'lost' || lead.status === 'new') {
        await sql`
          UPDATE leads
          SET status = 'queued', recycled_count = COALESCE(recycled_count, 0) + 1
          WHERE id = ${leadId}
        `;
      }

      added++;
    } catch (err) {
      console.error(`[Recycle] Error adding prospect ${leadId}:`, err);
      errors++;
    }
  }

  await logEvent('prospects_recycled', 'campaign', campaignId, {
    added,
    skipped,
    errors,
    totalProspects: prospectIds.length,
  }, organizationId);

  return { added, skipped, errors };
}

/**
 * Register a lead source fingerprint to prevent duplicates
 */
export async function registerLeadFingerprint(
  organizationId: string,
  leadId: string,
  fingerprint: {
    email?: string;
    phone?: string;
    addressHash?: string;
    sourceId?: string;
  }
): Promise<void> {
  const { email, phone, addressHash, sourceId } = fingerprint;

  // Email fingerprint
  if (email) {
    await sql`
      INSERT INTO lead_fingerprints (organization_id, lead_id, fingerprint_type, fingerprint_value, created_at)
      VALUES (${organizationId}, ${leadId}, 'email', ${email.toLowerCase().trim()}, now())
      ON CONFLICT (organization_id, fingerprint_type, fingerprint_value) DO NOTHING
    `.catch(() => {});
  }

  // Phone fingerprint (normalized)
  if (phone) {
    const normalizedPhone = phone.replace(/[^0-9]/g, '').slice(-10);
    await sql`
      INSERT INTO lead_fingerprints (organization_id, lead_id, fingerprint_type, fingerprint_value, created_at)
      VALUES (${organizationId}, ${leadId}, 'phone', ${normalizedPhone}, now())
      ON CONFLICT (organization_id, fingerprint_type, fingerprint_value) DO NOTHING
    `.catch(() => {});
  }

  // Address fingerprint
  if (addressHash) {
    await sql`
      INSERT INTO lead_fingerprints (organization_id, lead_id, fingerprint_type, fingerprint_value, created_at)
      VALUES (${organizationId}, ${leadId}, 'address', ${addressHash}, now())
      ON CONFLICT (organization_id, fingerprint_type, fingerprint_value) DO NOTHING
    `.catch(() => {});
  }

  // Source ID fingerprint
  if (sourceId) {
    await sql`
      INSERT INTO lead_fingerprints (organization_id, lead_id, fingerprint_type, fingerprint_value, created_at)
      VALUES (${organizationId}, ${leadId}, 'source_id', ${sourceId}, now())
      ON CONFLICT (organization_id, fingerprint_type, fingerprint_value) DO NOTHING
    `.catch(() => {});
  }
}

/**
 * Check if a prospect already exists (dedupe for lead finder)
 */
export async function checkProspectExists(
  organizationId: string,
  prospect: {
    email?: string;
    phone?: string;
    address?: string;
    sourceId?: string;
  }
): Promise<{ exists: boolean; existingLeadId?: string; matchType?: string }> {
  const { email, phone, address, sourceId } = prospect;

  // Check email
  if (email) {
    const [match] = await sql`
      SELECT lead_id FROM lead_fingerprints
      WHERE organization_id = ${organizationId}
        AND fingerprint_type = 'email'
        AND fingerprint_value = ${email.toLowerCase().trim()}
    `;
    if (match) {
      return { exists: true, existingLeadId: match.lead_id, matchType: 'email' };
    }
  }

  // Check phone
  if (phone) {
    const normalizedPhone = phone.replace(/[^0-9]/g, '').slice(-10);
    const [match] = await sql`
      SELECT lead_id FROM lead_fingerprints
      WHERE organization_id = ${organizationId}
        AND fingerprint_type = 'phone'
        AND fingerprint_value = ${normalizedPhone}
    `;
    if (match) {
      return { exists: true, existingLeadId: match.lead_id, matchType: 'phone' };
    }
  }

  // Check address (fuzzy match using hash)
  if (address) {
    const addressHash = normalizeAddress(address);
    const [match] = await sql`
      SELECT lead_id FROM lead_fingerprints
      WHERE organization_id = ${organizationId}
        AND fingerprint_type = 'address'
        AND fingerprint_value = ${addressHash}
    `;
    if (match) {
      return { exists: true, existingLeadId: match.lead_id, matchType: 'address' };
    }
  }

  // Check source ID
  if (sourceId) {
    const [match] = await sql`
      SELECT lead_id FROM lead_fingerprints
      WHERE organization_id = ${organizationId}
        AND fingerprint_type = 'source_id'
        AND fingerprint_value = ${sourceId}
    `;
    if (match) {
      return { exists: true, existingLeadId: match.lead_id, matchType: 'source_id' };
    }
  }

  return { exists: false };
}

/**
 * Normalize address for comparison
 */
function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd/g, '')
    .replace(/apartment|apt|unit|#/g, '')
    .trim();
}

/**
 * Dedupe incoming leads from lead finder
 */
export async function dedupeLeadFinderResults(
  organizationId: string,
  prospects: Array<{
    email?: string;
    phone?: string;
    address?: string;
    sourceId?: string;
    name?: string;
    [key: string]: unknown;
  }>
): Promise<{
  newProspects: typeof prospects;
  duplicates: Array<{ prospect: typeof prospects[0]; existingLeadId: string; matchType: string }>;
  stats: DedupeResult;
}> {
  const newProspects: typeof prospects = [];
  const duplicates: Array<{ prospect: typeof prospects[0]; existingLeadId: string; matchType: string }> = [];

  for (const prospect of prospects) {
    const check = await checkProspectExists(organizationId, prospect);

    if (check.exists) {
      duplicates.push({
        prospect,
        existingLeadId: check.existingLeadId!,
        matchType: check.matchType!,
      });
    } else {
      newProspects.push(prospect);
    }
  }

  const stats: DedupeResult = {
    newLeads: newProspects.length,
    duplicatesFound: duplicates.length,
    mergedLeads: 0,
    skippedExisting: duplicates.length,
  };

  await logEvent('lead_finder_deduped', 'organization', organizationId, stats, organizationId);

  return { newProspects, duplicates, stats };
}

/**
 * Get recycling analytics
 */
export async function getRecyclingAnalytics(
  organizationId: string,
  days: number = 30
): Promise<{
  totalRecycled: number;
  recycledEngaged: number;
  recycledConverted: number;
  avgRecycleScore: number;
  topRecycledCampaigns: Array<{ campaignId: string; campaignName: string; recycledCount: number }>;
  duplicatesPreventedCount: number;
}> {
  const [recycleStats] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE is_recycled = true)::int as total_recycled,
      COUNT(*) FILTER (WHERE is_recycled = true AND status IN ('engaged', 'negotiating', 'contracted', 'closed'))::int as recycled_engaged,
      COUNT(*) FILTER (WHERE is_recycled = true AND status IN ('contracted', 'closed'))::int as recycled_converted
    FROM campaign_lead_queue clq
    WHERE clq.campaign_id IN (
      SELECT id FROM campaigns WHERE organization_id = ${organizationId}
    )
    AND recycled_at > now() - (${days} || ' days')::interval
  `.catch(() => [{}]);

  const topCampaigns = await sql`
    SELECT
      c.id as campaign_id,
      c.name as campaign_name,
      COUNT(*) FILTER (WHERE clq.is_recycled = true)::int as recycled_count
    FROM campaigns c
    JOIN campaign_lead_queue clq ON clq.campaign_id = c.id
    WHERE c.organization_id = ${organizationId}
      AND clq.recycled_at > now() - (${days} || ' days')::interval
    GROUP BY c.id, c.name
    HAVING COUNT(*) FILTER (WHERE clq.is_recycled = true) > 0
    ORDER BY recycled_count DESC
    LIMIT 5
  `.catch(() => []);

  const [fingerprints] = await sql`
    SELECT COUNT(*)::int as count
    FROM lead_fingerprints
    WHERE organization_id = ${organizationId}
  `.catch(() => [{ count: 0 }]);

  const stats = recycleStats as Record<string, unknown> | undefined;

  return {
    totalRecycled: Number(stats?.total_recycled) || 0,
    recycledEngaged: Number(stats?.recycled_engaged) || 0,
    recycledConverted: Number(stats?.recycled_converted) || 0,
    avgRecycleScore: 0,
    topRecycledCampaigns: topCampaigns.map(c => ({
      campaignId: String(c.campaign_id),
      campaignName: String(c.campaign_name),
      recycledCount: Number(c.recycled_count),
    })),
    duplicatesPreventedCount: Number(fingerprints?.count) || 0,
  };
}

/**
 * Queue automatic recycling job
 */
export async function queueRecyclingJob(
  organizationId: string,
  campaignId: string,
  config?: Partial<RecycleConfig>
): Promise<string | null> {
  return enqueueJob('recycle_prospects', {
    organizationId,
    campaignId,
    config,
  }, {
    maxAttempts: 1,
    dedupeKey: `recycle_${campaignId}`,
  });
}
