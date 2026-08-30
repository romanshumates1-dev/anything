import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/optimization/decision/[id]
 *
 * Returns all agent outputs for a specific lead
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return NextResponse.json({ error: 'No organization found' }, { status: 403 });
    }

    const leadId = parseInt(params.id, 10);

    // Verify lead belongs to organization
    const [lead] = await sql`
      SELECT id, name, phone, status, metadata
      FROM leads
      WHERE id = ${leadId} AND organization_id = ${organization.id}
    `;

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Fetch all agent outputs
    const [score] = await sql`
      SELECT composite_score, distress_score, recency_score, equity_score, geo_score
      FROM lead_scores
      WHERE lead_id = ${leadId}
    `;

    const [valuation] = await sql`
      SELECT arv, arv_confidence, repairs, offer_min, offer_max, comps_count
      FROM property_valuations
      WHERE lead_id = ${leadId}
    `;

    const [probability] = await sql`
      SELECT p_close, expected_value
      FROM deal_probabilities
      WHERE lead_id = ${leadId}
    `;

    const actions = await sql`
      SELECT action, priority, status, reason, created_at
      FROM lead_actions
      WHERE lead_id = ${leadId}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    return NextResponse.json({
      lead: {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        status: lead.status,
        metadata: lead.metadata
      },
      score: score ? {
        composite: Number(score.composite_score),
        components: {
          distress: Number(score.distress_score),
          recency: Number(score.recency_score),
          equity: Number(score.equity_score),
          geo: Number(score.geo_score)
        }
      } : null,
      valuation: valuation ? {
        arv: valuation.arv,
        arvConfidence: Number(valuation.arv_confidence),
        repairs: valuation.repairs,
        offerMin: valuation.offer_min,
        offerMax: valuation.offer_max,
        compsCount: valuation.comps_count
      } : null,
      probability: probability ? {
        pClose: Number(probability.p_close),
        expectedValue: probability.expected_value
      } : null,
      actions: actions.map(a => ({
        action: a.action,
        priority: Number(a.priority),
        status: a.status,
        reason: a.reason,
        createdAt: a.created_at
      }))
    });
  } catch (error: any) {
    console.error(`GET /api/optimization/decision/${params.id} error`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
