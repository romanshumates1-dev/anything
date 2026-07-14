import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import {
  parseSourcedCsv,
  dedupeInBatch,
  scoreSourcedLead,
  type SourcedCategory,
} from '../utils/normalize';

/**
 * MANUAL_ONLY ingestion: the owner uploads a county file for a registered
 * source. Same normalizer as any source — normalize → strip contact columns →
 * dedupe (batch + DB) → score → persist with provenance. NO contact data is
 * ever written (enforced in normalize.ts + the schema).
 *
 * PERMITTED-source automated fetch is a separate worker (deferred until the
 * owner confirms each source's terms); this endpoint is the compliant path
 * that needs no scraping.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sourceId = Number(b.sourceId);
    const text = typeof b.text === 'string' ? b.text : '';
    const filename = typeof b.filename === 'string' ? b.filename : null;

    if (!Number.isFinite(sourceId)) return Response.json({ error: 'sourceId is required' }, { status: 400 });
    if (!text.trim()) return Response.json({ error: 'No file/text content provided' }, { status: 400 });

    const [source] = await sql`SELECT * FROM lead_sources WHERE id = ${sourceId} LIMIT 1`;
    if (!source) return Response.json({ error: 'Source not found' }, { status: 404 });
    if (source.terms_status === 'PROHIBITED') {
      return Response.json({ error: 'This source is marked PROHIBITED and cannot be ingested' }, { status: 403 });
    }

    const category: SourcedCategory = source.category === 'buyer' ? 'buyer' : 'seller';
    const parsed = parseSourcedCsv(text, {
      sourceRecordType: source.record_type,
      sourceCategory: category,
      fallbackCounty: source.jurisdiction,
    });

    // Dedupe within the uploaded batch.
    const { unique, duplicates: batchDupes } = dedupeInBatch(parsed.rows);

    const provenanceBase = {
      source_name: source.name,
      source_url: source.url,
      fetch_date: new Date().toISOString(),
      public_record_type: source.record_type,
      access_method: source.access_method,
      terms_status: source.terms_status,
      ingest: 'manual_upload',
    };

    let inserted = 0;
    let dbDupes = 0;
    for (const r of unique) {
      const { score, reasons } = scoreSourcedLead({
        signals: r.signals,
        assessedValueCents: r.assessedValueCents,
        sourceWeight: Number(source.distress_weight) || 50,
      });
      // Dedupe key is scoped to the SOURCE so the same parcel appearing in a
      // second source (e.g. probate AND tax-delinquent) is NOT silently
      // dropped — the operator sees both records. Re-uploading the same source
      // file still dedupes idempotently.
      const scopedKey = `${sourceId}|${r.dedupeKey}`;
      const rows = await sql`
        INSERT INTO sourced_leads
          (source_id, category, owner_name, property_address, mailing_address, parcel_id, record_type, county,
           assessed_value_cents, signals, raw_fields, provenance, distress_score, score_reasons, dedupe_key, created_by)
        VALUES
          (${sourceId}, ${category}, ${r.ownerName}, ${r.propertyAddress}, ${r.mailingAddress}, ${r.parcelId},
           ${source.record_type}, ${r.county}, ${r.assessedValueCents},
           ${JSON.stringify(r.signals)}, ${JSON.stringify(r.rawFields)}, ${JSON.stringify(provenanceBase)},
           ${score}, ${JSON.stringify(reasons)}, ${scopedKey}, ${admin.userId})
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id
      `;
      if (rows.length > 0) inserted++;
      else dbDupes++;
    }

    const [upload] = await sql`
      INSERT INTO lead_source_uploads (source_id, filename, total_rows, inserted_rows, duplicate_rows, uploaded_by)
      VALUES (${sourceId}, ${filename}, ${parsed.totalRows}, ${inserted}, ${batchDupes + dbDupes}, ${admin.userId})
      RETURNING id
    `;
    await sql`
      UPDATE lead_sources
      SET last_refreshed_at = now(),
          last_record_count = (SELECT COUNT(*)::int FROM sourced_leads WHERE source_id = ${sourceId})
      WHERE id = ${sourceId}
    `;
    await logEvent(
      'lead_source_ingested',
      'lead_source',
      String(sourceId),
      { uploadId: upload.id, inserted, duplicates: batchDupes + dbDupes, failed: parsed.failures.length, totalRows: parsed.totalRows },
      admin.userId
    );

    return Response.json({
      uploadId: upload.id,
      sourceId,
      totalRows: parsed.totalRows,
      inserted,
      duplicates: batchDupes + dbDupes,
      failed: parsed.failures.length,
      failures: parsed.failures.slice(0, 25),
    });
  } catch (error: any) {
    console.error('POST /api/lead-finder/upload error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
