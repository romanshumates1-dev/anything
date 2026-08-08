/**
 * GET /api/analytics/attribution
 *
 * Per-source attribution with ACTUAL acquisition costs from lead metadata.
 * Shows lead counts, conversion rates, cost-per-lead, and ROI by source.
 *
 * Sources tracked: bandit_sign, facebook_marketplace, craigslist, nextdoor,
 * google_business, driving_for_dollars, word_of_mouth, landing_page, unknown,
 * and all outbound sources (skip-traced lists, data providers, etc.).
 *
 * Enhanced with:
 * - Actual acquisition_cost_cents from lead metadata (not hardcoded $0)
 * - Cost per deal calculation
 * - ROI per source
 * - Consent-to-conversion correlation
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

// Default costs for sources where acquisition_cost_cents is not tracked
const DEFAULT_ACQUISITION_COSTS: Record<string, number> = {
  // Inbound (free)
  keyword_inbound: 0,
  consent_capture: 0,
  landing_page: 0,
  word_of_mouth: 0,
  // Low-cost marketing
  bandit_sign: 50, // ~$0.50 per lead reached
  driving_for_dollars: 100, // ~$1.00 per lead (gas + time)
  facebook_marketplace: 25, // ~$0.25 per lead
  craigslist: 10, // ~$0.10 per lead
  nextdoor: 15, // ~$0.15 per lead
  google_business: 0, // Free organic
  // Paid data sources (estimates)
  propstream: 500, // ~$5.00 per lead
  listsource: 800, // ~$8.00 per lead
  batchskiptracing: 200, // ~$2.00 per lead
  skip_traced: 300, // ~$3.00 per lead
  tax_delinquent: 150, // ~$1.50 per lead
  probate: 400, // ~$4.00 per lead
  pre_foreclosure: 350, // ~$3.50 per lead
  unknown: 0,
};

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization found' }, { status: 403 });

  // Lead counts by source with ACTUAL acquisition costs from metadata
  const sourceRows = await sql`
    SELECT
      COALESCE(l.metadata->>'inbound_source', l.source, 'unknown') AS source,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE l.status IN ('NEGOTIATING', 'DEAL_AGREED', 'CLOSED_WON'))::int AS converted,
      COUNT(*) FILTER (WHERE l.status = 'CLOSED_WON')::int AS closed,
      -- ACTUAL acquisition cost from metadata (cents)
      COALESCE(AVG((l.metadata->>'acquisition_cost_cents')::numeric), 0)::int AS avg_acquisition_cost_cents,
      COALESCE(SUM((l.metadata->>'acquisition_cost_cents')::numeric), 0)::bigint AS total_acquisition_cost_cents,
      -- Revenue from closed deals
      COALESCE(SUM(ba.assignment_fee_cents) FILTER (WHERE ba.status = 'SIGNED'), 0)::bigint AS revenue_cents
    FROM leads l
    LEFT JOIN contracts c ON c.lead_id = l.id
    LEFT JOIN buyer_assignments ba ON ba.contract_id = c.id
    WHERE l.organization_id = ${organization.id}
    GROUP BY COALESCE(l.metadata->>'inbound_source', l.source, 'unknown')
    ORDER BY COUNT(*) DESC
  `;

  // Consent records by method with conversion tracking
  const consentRows = await sql`
    SELECT
      COALESCE(cr.metadata->>'consentMethod', 'unknown') AS method,
      COUNT(DISTINCT cr.target)::int AS count,
      COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('NEGOTIATING', 'DEAL_AGREED', 'CLOSED_WON'))::int AS converted,
      COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CLOSED_WON')::int AS closed
    FROM compliance_records cr
    LEFT JOIN leads l ON (l.phone = cr.target OR l.email = cr.target) AND l.organization_id = ${organization.id}
    WHERE cr.type = 'consent'
    GROUP BY COALESCE(cr.metadata->>'consentMethod', 'unknown')
    ORDER BY count DESC
  `;

  // Stage transitions from all leads (not just inbound)
  const funnelRows = await sql`
    SELECT
      st.to_stage AS stage,
      COUNT(*)::int AS count
    FROM stage_transitions st
    JOIN leads l ON l.id = st.lead_id
    WHERE l.organization_id = ${organization.id}
    GROUP BY 1
    ORDER BY count DESC
  `;

  const sources = (sourceRows as any[]).map((r) => {
    const leads = r.leads || 1;
    const closed = r.closed || 0;

    // Use actual cost from metadata, fall back to defaults
    const actualCostCents = r.total_acquisition_cost_cents || 0;
    const defaultCostCents = (DEFAULT_ACQUISITION_COSTS[r.source] || 0) * leads;
    const totalCostCents = actualCostCents > 0 ? actualCostCents : defaultCostCents;
    const costPerLeadCents = totalCostCents / leads;

    const revenueCents = r.revenue_cents || 0;
    const profitCents = revenueCents - totalCostCents;
    const roi = totalCostCents > 0 ? ((revenueCents - totalCostCents) / totalCostCents) * 100 : (revenueCents > 0 ? Infinity : 0);

    const isInbound = ['keyword_inbound', 'consent_capture', 'landing_page', 'word_of_mouth'].includes(r.source);

    return {
      source: r.source,
      leads,
      converted: r.converted || 0,
      closed,
      conversionRate: Math.round((r.converted / leads) * 1000) / 10,
      closeRate: Math.round((closed / leads) * 1000) / 10,
      // Costs
      acquisitionCostCents: Math.round(totalCostCents),
      acquisitionCostUsd: Math.round(totalCostCents) / 100,
      costPerLeadCents: Math.round(costPerLeadCents),
      costPerLeadUsd: Math.round(costPerLeadCents) / 100,
      costPerDealCents: closed > 0 ? Math.round(totalCostCents / closed) : null,
      costPerDealUsd: closed > 0 ? Math.round(totalCostCents / closed) / 100 : null,
      // Revenue and ROI
      revenueCents,
      revenueUsd: revenueCents / 100,
      profitCents,
      profitUsd: profitCents / 100,
      roi: isFinite(roi) ? Math.round(roi) : (revenueCents > 0 ? 'Infinite' : 0),
      // Metadata
      hasActualCosts: actualCostCents > 0,
      isInbound,
      note: actualCostCents > 0
        ? 'Costs from lead metadata (actual tracked)'
        : isInbound
          ? 'Inbound channel — $0 acquisition'
          : `Estimated cost: $${(DEFAULT_ACQUISITION_COSTS[r.source] || 0) / 100}/lead (set acquisition_cost_cents in lead metadata for accuracy)`,
    };
  });

  // Process consent methods with conversion multipliers
  const avgConversionRate = sources.reduce((sum, s) => sum + s.conversionRate, 0) / Math.max(sources.length, 1);
  const consentMethods = (consentRows as any[]).map((r) => {
    const conversionRate = r.count > 0 ? Math.round((r.converted / r.count) * 1000) / 10 : 0;
    const closeRate = r.count > 0 ? Math.round((r.closed / r.count) * 1000) / 10 : 0;
    const conversionMultiplier = avgConversionRate > 0 ? Math.round((conversionRate / avgConversionRate) * 100) / 100 : 1;

    // Determine legal strength
    const method = (r.method || '').toLowerCase();
    let legalStrength: 'strong' | 'moderate' | 'weak' = 'moderate';
    if (method.includes('keyword') || method.includes('sms') || method.includes('double')) {
      legalStrength = 'strong';
    } else if (method.includes('verbal') || method.includes('implied')) {
      legalStrength = 'weak';
    }

    return {
      method: r.method,
      count: r.count,
      converted: r.converted,
      closed: r.closed,
      conversionRate,
      closeRate,
      conversionMultiplier,
      legalStrength,
      insight: conversionMultiplier > 1.5
        ? `${conversionMultiplier}x better conversion than average`
        : conversionMultiplier < 0.5
          ? `Underperforming — ${conversionMultiplier}x vs average`
          : 'Average performance',
    };
  });

  // Find best consent method for compliance-aware optimization
  const sortedConsent = [...consentMethods].sort((a, b) => b.conversionRate - a.conversionRate);
  const bestConsent = sortedConsent[0];
  const strongConsent = consentMethods.filter(m => m.legalStrength === 'strong').sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return Response.json({
    sources,
    topSourcesByROI: [...sources].filter(s => typeof s.roi === 'number' && s.closed > 0).sort((a, b) => (b.roi as number) - (a.roi as number)).slice(0, 5),
    underperformingSources: sources.filter(s => typeof s.roi === 'number' && s.roi < 0 && s.leads >= 10),
    consentMethods,
    funnelByStage: funnelRows,
    totalLeads: sources.reduce((s, r) => s + r.leads, 0),
    totalInboundLeads: sources.filter(s => s.isInbound).reduce((s, r) => s + r.leads, 0),
    totalOutboundLeads: sources.filter(s => !s.isInbound).reduce((s, r) => s + r.leads, 0),
    // Consent insights
    consentInsight: bestConsent && strongConsent
      ? bestConsent.method === strongConsent.method
        ? `"${bestConsent.method}" provides best conversion (${bestConsent.conversionRate}%) with strong legal protection. Focus here.`
        : `"${bestConsent.method}" converts best (${bestConsent.conversionRate}%) but "${strongConsent.method}" offers stronger TCPA defense (${strongConsent.conversionRate}% conversion).`
      : null,
    note: 'Includes all lead sources. Set acquisition_cost_cents in lead metadata for accurate ROI tracking.',
  });
}
