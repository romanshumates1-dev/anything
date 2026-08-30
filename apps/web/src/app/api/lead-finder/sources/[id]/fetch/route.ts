import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import {
  parseSourcedRecords,
  dedupeInBatch,
  scoreSourcedLead,
  type SourcedCategory,
} from '@/app/api/lead-finder/utils/normalize';

/**
 * PERMITTED-source automated fetch. The counterpart to /upload: instead of the
 * owner downloading a county file by hand, this pulls records directly from a
 * source that has been cleared for automated access.
 *
 * This is what makes the deal-target campaign mode usable end to end — sizing
 * a campaign at 10,334 sellers is meaningless if the only way to get inventory
 * is manual upload.
 *
 * THE COMPLIANCE GUARD IS THE POINT OF THIS ENDPOINT.
 * `lead_sources.terms_status` is the authority and only 'PERMITTED' may be
 * fetched. MANUAL_ONLY is refused — not because fetching is technically hard,
 * but because that status records that nobody has cleared the source's terms,
 * and the registry's whole design (see 006_lead_finder.sql) is that automated
 * access requires an affirmative, recorded check. PROHIBITED is refused
 * outright. Neither can be overridden by a request parameter; the only way to
 * change a source's status is /api/lead-finder/sources, which itself refuses
 * to mark anything PERMITTED without a recorded live robots check.
 *
 * Contact data is never persisted: the shared normalizer strips it before it
 * can reach raw_fields, and the schema has no contact columns. Phones are
 * resolved downstream by skip-trace, exactly as with manual upload.
 *
 * Body: { limit?: number, offset?: number, where?: string }
 */

/** Socrata caps a single page at 50,000; stay well under and paginate. */
const MAX_PAGE = 1000;
const DEFAULT_PAGE = 1000;
/** Hard ceiling per invocation so one call cannot run unbounded. */
const MAX_RECORDS_PER_RUN = 10000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const sourceId = Number(id);
    if (!Number.isInteger(sourceId)) {
      return Response.json({ error: 'Invalid source id' }, { status: 400 });
    }

    const [source] = await sql`
      SELECT * FROM lead_sources
      WHERE id = ${sourceId} AND organization_id = ${organization.id}
      LIMIT 1
    `;
    if (!source) return Response.json({ error: 'Source not found' }, { status: 404 });

    if (source.terms_status !== 'PERMITTED') {
      return Response.json(
        {
          error: 'automated_fetch_not_permitted',
          message:
            `Source is ${source.terms_status}. Only PERMITTED sources may be fetched automatically; ` +
            `use /api/lead-finder/upload for a manual county file.`,
          termsStatus: source.terms_status,
        },
        { status: 403 }
      );
    }
    if (!source.url) {
      return Response.json({ error: 'Source has no url configured' }, { status: 400 });
    }

    const b = (await request.json().catch(() => ({}))) as {
      limit?: unknown;
      offset?: unknown;
      where?: unknown;
    };
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(b.limit) || DEFAULT_PAGE));
    const offset = Math.max(0, Number(b.offset) || 0);
    if (limit > MAX_RECORDS_PER_RUN) {
      return Response.json({ error: `limit exceeds ${MAX_RECORDS_PER_RUN}` }, { status: 400 });
    }

    // Socrata SODA endpoint. `dataset` holds the 4x4 resource id; the registry
    // url is the portal root.
    const dataset = typeof source.dataset_id === 'string' ? source.dataset_id : null;
    if (!dataset) {
      return Response.json(
        {
          error: 'source_missing_dataset',
          message:
            'This PERMITTED source has no dataset_id. Set it on the source before fetching (the SODA 4x4 resource id).',
        },
        { status: 400 }
      );
    }

    const base = String(source.url).replace(/\/+$/, '');
    const qs = new URLSearchParams({ $limit: String(limit), $offset: String(offset) });
    if (typeof b.where === 'string' && b.where.trim()) qs.set('$where', b.where.trim());
    const endpoint = `${base}/resource/${dataset}.json?${qs.toString()}`;

    let records: Array<Record<string, unknown>>;
    try {
      const res = await fetch(endpoint, {
        headers: { Accept: 'application/json', 'User-Agent': 'DealFlowAI-LeadFinder/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        return Response.json(
          { error: 'upstream_error', status: res.status, endpoint },
          { status: 502 }
        );
      }
      const json = await res.json();
      if (!Array.isArray(json)) {
        return Response.json({ error: 'upstream returned a non-array payload' }, { status: 502 });
      }
      records = json;
    } catch (e: any) {
      // Network/timeout is an upstream condition, not a bug here — 502 with the
      // reason rather than a blank 500.
      return Response.json(
        { error: 'upstream_unreachable', message: e?.message ?? String(e), endpoint },
        { status: 502 }
      );
    }

    const category: SourcedCategory = source.category === 'buyer' ? 'buyer' : 'seller';
    const parsed = parseSourcedRecords(records, {
      sourceRecordType: source.record_type,
      sourceCategory: category,
      fallbackCounty: source.jurisdiction,
    });
    const { unique, duplicates: batchDupes } = dedupeInBatch(parsed.rows);

    const provenanceBase = {
      source_name: source.name,
      source_url: source.url,
      fetch_date: new Date().toISOString(),
      public_record_type: source.record_type,
      access_method: source.access_method,
      terms_status: source.terms_status,
      ingest: 'automated_fetch',
      endpoint,
    };

    // Batch INSERT optimization: use unnest() instead of single-row loops
    // This reduces round-trip overhead from O(n) to O(1), critical for 10K+ lead campaigns
    // PostgreSQL unnest batch inserts: 1000 leads = 1 round trip vs 1000 round trips

    // Pre-compute scores and prepare batch data
    const batchData = unique.map(r => {
      const { score, reasons } = scoreSourcedLead({
        signals: r.signals,
        assessedValueCents: r.assessedValueCents,
        sourceWeight: Number(source.distress_weight) || 50,
      });
      const scopedKey = `${sourceId}|${r.dedupeKey}`;
      return {
        sourceId,
        category,
        ownerName: r.ownerName,
        propertyAddress: r.propertyAddress,
        mailingAddress: r.mailingAddress,
        parcelId: r.parcelId,
        recordType: source.record_type,
        county: r.county,
        assessedValueCents: r.assessedValueCents,
        signals: JSON.stringify(r.signals),
        rawFields: JSON.stringify(r.rawFields),
        provenance: JSON.stringify(provenanceBase),
        score,
        reasons: JSON.stringify(reasons),
        scopedKey,
        createdBy: admin.userId,
      };
    });

    let inserted = 0;
    let dbDupes = 0;

    // Process in chunks of 500 for memory efficiency while still batching
    const BATCH_SIZE = 500;
    for (let i = 0; i < batchData.length; i += BATCH_SIZE) {
      const chunk = batchData.slice(i, i + BATCH_SIZE);

      // Use unnest for batch insert - much faster than individual INSERTs
      const result = await sql`
        INSERT INTO sourced_leads
          (source_id, category, owner_name, property_address, mailing_address, parcel_id, record_type, county,
           assessed_value_cents, signals, raw_fields, provenance, distress_score, score_reasons, dedupe_key, created_by)
        SELECT * FROM unnest(
          ${chunk.map(r => r.sourceId)}::int[],
          ${chunk.map(r => r.category)}::text[],
          ${chunk.map(r => r.ownerName)}::text[],
          ${chunk.map(r => r.propertyAddress)}::text[],
          ${chunk.map(r => r.mailingAddress)}::text[],
          ${chunk.map(r => r.parcelId)}::text[],
          ${chunk.map(r => r.recordType)}::text[],
          ${chunk.map(r => r.county)}::text[],
          ${chunk.map(r => r.assessedValueCents)}::int[],
          ${chunk.map(r => r.signals)}::jsonb[],
          ${chunk.map(r => r.rawFields)}::jsonb[],
          ${chunk.map(r => r.provenance)}::jsonb[],
          ${chunk.map(r => r.score)}::int[],
          ${chunk.map(r => r.reasons)}::jsonb[],
          ${chunk.map(r => r.scopedKey)}::text[],
          ${chunk.map(r => r.createdBy)}::text[]
        )
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id
      `;

      inserted += result.length;
      dbDupes += chunk.length - result.length;
    }

    await sql`
      UPDATE lead_sources
      SET last_refreshed_at = now(),
          last_record_count = (SELECT COUNT(*)::int FROM sourced_leads WHERE source_id = ${sourceId})
      WHERE id = ${sourceId}
    `;

    await logEvent(
      'lead_source_fetched',
      'lead_source',
      String(sourceId),
      {
        inserted,
        duplicates: batchDupes + dbDupes,
        failed: parsed.failures.length,
        fetched: records.length,
        offset,
        limit,
      },
      admin.userId
    );

    // `fetched === limit` means the page was full, so there is very likely more
    // upstream — return the next offset so the caller can page without having
    // to infer it. This is how an operator reaches 10k without manual work.
    const morePossible = records.length === limit;

    return Response.json({
      sourceId,
      endpoint,
      fetched: records.length,
      inserted,
      duplicates: batchDupes + dbDupes,
      failed: parsed.failures.length,
      morePossible,
      nextOffset: morePossible ? offset + records.length : null,
      disclaimer:
        'Scores are SIGNAL-BASED ESTIMATES from public-record signals, not guaranteed outcomes. No contact data is stored; resolve phones via skip-trace downstream.',
    });
  } catch (error: any) {
    console.error('POST /api/lead-finder/sources/[id]/fetch error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
