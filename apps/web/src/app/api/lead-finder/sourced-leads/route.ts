import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';

/**
 * List scored sourced leads with filters (county / category / record_type /
 * min score / status). Admin-only. Contact data is absent by construction.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const url = new URL(request.url);
    const county = url.searchParams.get('county');
    const category = url.searchParams.get('category');
    const recordType = url.searchParams.get('recordType');
    const minScore = Number(url.searchParams.get('minScore') || 0) || 0;
    const status = url.searchParams.get('status');
    const limit = Math.min(500, Number(url.searchParams.get('limit') || 200) || 200);

    const rows = await sql`
      SELECT sl.id, sl.category, sl.owner_name, sl.property_address, sl.mailing_address, sl.parcel_id,
             sl.record_type, sl.county, sl.assessed_value_cents, sl.signals, sl.provenance,
             sl.distress_score, sl.score_reasons, sl.status, sl.handed_off_lead_id, sl.created_at,
             s.name AS source_name, s.terms_status
      FROM sourced_leads sl
      LEFT JOIN lead_sources s ON s.id = sl.source_id
      WHERE sl.distress_score >= ${minScore}
        AND (${county}::text IS NULL OR sl.county ILIKE ${county})
        AND (${category}::text IS NULL OR sl.category = ${category})
        AND (${recordType}::text IS NULL OR sl.record_type = ${recordType})
        AND (${status}::text IS NULL OR sl.status = ${status})
      ORDER BY sl.distress_score DESC, sl.created_at DESC
      LIMIT ${limit}
    `;

    const [counts] = await sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'new')::int AS new_count,
             COUNT(*) FILTER (WHERE status = 'handed_off')::int AS handed_off_count
      FROM sourced_leads
    `;

    return Response.json({ leads: rows, counts, disclaimer: 'Scores are SIGNAL-BASED ESTIMATES from public-record signals, not guaranteed outcomes.' });
  } catch (error: any) {
    console.error('GET /api/lead-finder/sourced-leads error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
