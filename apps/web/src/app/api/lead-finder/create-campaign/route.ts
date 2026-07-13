import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';

/**
 * Phase 4 handoff — "Create campaign from segment".
 *
 * The tool ENDS where the existing pipeline BEGINS: this pushes a scored
 * segment of sourced_leads INTO the EXISTING contact set (`leads`) — the same
 * table the bulk importer writes — with type + owner name + property context in
 * metadata, and NO phone/email (the owner's EXISTING skip-trace step resolves
 * contact downstream, then DNC scrub, then the campaign wizard). It does NOT
 * duplicate import/skip-trace/DNC/scheduler — it only produces the leads they
 * consume, then marks each sourced lead handed_off.
 *
 * Body: { leadIds?: number[] }  OR  { filter?: {county,category,recordType,minScore} }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const b = (await request.json().catch(() => ({}))) as {
      leadIds?: unknown;
      filter?: { county?: string; category?: string; recordType?: string; minScore?: number };
    };

    const ids = Array.isArray(b.leadIds) ? b.leadIds.map(Number).filter(Number.isFinite) : [];
    const f = b.filter || {};

    // Resolve the segment: explicit ids win, else the filter. Only 'new' leads
    // (not already handed off) are eligible.
    const segment = ids.length
      ? await sql`SELECT * FROM sourced_leads WHERE id = ANY(${ids}) AND status = 'new'`
      : await sql`
          SELECT * FROM sourced_leads
          WHERE status = 'new'
            AND distress_score >= ${Number(f.minScore) || 0}
            AND (${f.county ?? null}::text IS NULL OR county ILIKE ${f.county ?? null})
            AND (${f.category ?? null}::text IS NULL OR category = ${f.category ?? null})
            AND (${f.recordType ?? null}::text IS NULL OR record_type = ${f.recordType ?? null})
          ORDER BY distress_score DESC
        `;

    if (segment.length === 0) {
      return Response.json({ error: 'Segment is empty (no un-handed-off leads match)' }, { status: 400 });
    }

    let created = 0;
    for (const sl of segment) {
      // Claim the row FIRST (conditional on status='new') so a concurrent call
      // or retry can't double-hand-off the same lead. If we don't claim it,
      // someone else already did — skip.
      const claim = await sql`
        UPDATE sourced_leads SET status = 'handed_off', handed_off_at = now(), updated_at = now()
        WHERE id = ${sl.id} AND status = 'new'
        RETURNING id
      `;
      if (claim.length === 0) continue;

      const name = sl.owner_name || sl.property_address || `Parcel ${sl.parcel_id || sl.id}`;
      const metadata = {
        origin: 'lead-finder',
        sourced_lead_id: sl.id,
        property_address: sl.property_address,
        mailing_address: sl.mailing_address,
        parcel_id: sl.parcel_id,
        county: sl.county,
        record_type: sl.record_type,
        signals: sl.signals,
        distress_score: sl.distress_score,
        score_reasons: sl.score_reasons,
        provenance: sl.provenance,
        needs_skip_trace: true, // phone resolved by the existing skip-trace step
      };
      // Insert into the EXISTING leads table (importer's output shape). No
      // phone/email — skip-trace resolves contact downstream.
      const [lead] = await sql`
        INSERT INTO leads (type, name, email, phone, status, source, metadata)
        VALUES (${sl.category}, ${name}, ${null}, ${null}, 'new', ${'lead-finder'}, ${JSON.stringify(metadata)})
        RETURNING id
      `;
      await sql`
        UPDATE sourced_leads SET handed_off_lead_id = ${lead.id} WHERE id = ${sl.id}
      `;
      created++;
    }

    await logEvent(
      'lead_finder_segment_handoff',
      'lead',
      'segment',
      { created, segmentSize: segment.length, filter: ids.length ? { leadIds: ids.length } : f },
      admin.userId
    );

    return Response.json({
      created,
      segmentSize: segment.length,
      next: 'Leads created with source=lead-finder (no contact yet). Run skip-trace to resolve phones, DNC scrub, then build a campaign in the wizard.',
      links: { contacts: '/leads', wizard: '/campaigns/wizard' },
    });
  } catch (error: any) {
    console.error('POST /api/lead-finder/create-campaign error', error);
    return Response.json({ error: 'Internal Server Error', detail: error?.message }, { status: 500 });
  }
}
