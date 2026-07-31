/**
 * GET /api/analytics/attribution
 *
 * Per-source attribution for $0 inbound channels (Phase 5).
 * Shows lead counts, conversion rates, and cost-per-lead by source.
 *
 * Sources tracked: bandit_sign, facebook_marketplace, craigslist, nextdoor,
 * google_business, driving_for_dollars, word_of_mouth, landing_page, unknown.
 *
 * Also includes consent_capture (web form) and keyword_inbound (SMS keyword)
 * as origination types so the owner sees which free channel is converting.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization found' }, { status: 403 });

  // Lead counts by inbound_source from metadata
  const sourceRows = await sql`
    SELECT
      COALESCE(metadata->>'inbound_source', source, 'unknown') AS source,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE status IN ('NEGOTIATING', 'DEAL_AGREED', 'CLOSED_WON'))::int AS converted,
      COUNT(*) FILTER (WHERE status = 'CLOSED_WON')::int AS closed
    FROM leads
    WHERE organization_id = ${organization.id}
      AND source IN ('keyword_inbound', 'consent_capture', 'landing_page')
    GROUP BY 1
    ORDER BY leads DESC
  `;

  // Consent records by method (keyword vs web form)
  const consentRows = await sql`
    SELECT
      COALESCE(metadata->>'consentMethod', 'unknown') AS method,
      COUNT(*)::int AS count
    FROM compliance_records
    WHERE type = 'consent'
    GROUP BY 1
    ORDER BY count DESC
  `;

  // Stage transitions from inbound leads (funnel depth)
  const funnelRows = await sql`
    SELECT
      st.to_stage AS stage,
      COUNT(*)::int AS count
    FROM stage_transitions st
    JOIN leads l ON l.id = st.lead_id
    WHERE l.organization_id = ${organization.id}
      AND l.source IN ('keyword_inbound', 'consent_capture', 'landing_page')
    GROUP BY 1
    ORDER BY count DESC
  `;

  const sources = (sourceRows as any[]).map((r) => ({
    source: r.source,
    leads: r.leads,
    converted: r.converted,
    closed: r.closed,
    conversionRate: r.leads > 0 ? (r.converted / r.leads) : 0,
    closeRate: r.leads > 0 ? (r.closed / r.leads) : 0,
    // $0 acquisition cost for all inbound channels
    acquisitionCostUsd: 0,
    note: 'BENCHMARK — $0 acquisition, consent already established',
  }));

  return Response.json({
    sources,
    consentMethods: consentRows,
    funnelByStage: funnelRows,
    totalInboundLeads: sources.reduce((s, r) => s + r.leads, 0),
    note: 'Inbound channels only. Outbound (skip-traced) leads excluded from this view.',
  });
}
