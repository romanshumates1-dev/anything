/**
 * POST /api/lead-finder/apollo — licensed Apollo.io people search → sourced leads.
 *
 * Architecture (uses the existing lead-source abstraction, no new tables):
 *   1. Admin-only (requireAdmin) + organization scope.
 *   2. Config check → precise 503 APOLLO_NOT_CONFIGURED when the worker
 *      secret is missing (never a fake success).
 *   3. Auto-registers/ensures an "Apollo.io" lead_sources row (API method,
 *      org-scoped) — source registration through the same registry every
 *      other source uses.
 *   4. BILLING: the pull runs inside withCreditDeduction(LEAD_FIND) — the
 *      credit cost is deducted SERVER-SIDE first and REFUNDED automatically
 *      if the pull/insert fails, so failed pulls never charge (deterministic,
 *      idempotent-by-ledger, auditable).
 *   5. Adapter → normalizer (contact data stripped, defense-in-depth scrub)
 *      → in-batch dedupe → score → chunked INSERT ... ON CONFLICT
 *      (dedupe_key) DO NOTHING → attribution provenance → audit log.
 *   6. 429 from Apollo maps to 429 APOLLO_RATE_LIMITED with Retry-After;
 *      auth/upstream failures map to 502 with a static safe message.
 *
 * Contact data policy: like every other source, emails/phones are NEVER
 * persisted (schema has no contact columns; normalizer strips them). Apollo
 * supplies name/company/title/seniority/location for lead discovery;
 * contact resolution happens downstream in the operator's licensed flow.
 */
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import { withCreditDeduction } from '@/app/api/utils/creditGuard';
import { scoreSourcedLead, type SourcedCategory } from '../utils/normalize';
import { getApolloConfig } from './config';
import { apolloSearchPeople, ApolloApiError } from './client';
import { normalizeApolloPeople, dedupeApolloBatch } from './normalize';

const APOLLO_SOURCE_NAME = 'Apollo.io';
const INSERT_BATCH = 500;

interface ApolloSourceRow {
  id: number;
  distress_weight: number | null;
  record_type: string;
  category: string;
}

async function ensureApolloSource(
  organizationId: string,
  category: SourcedCategory
): Promise<ApolloSourceRow> {
  const find = () => sql`
    SELECT id, distress_weight, record_type, category FROM lead_sources
    WHERE name = ${APOLLO_SOURCE_NAME}
      AND (organization_id = ${organizationId} OR organization_id IS NULL)
    LIMIT 1
  `;

  const existing = (await find())[0] as ApolloSourceRow | undefined;
  if (existing) return existing;

  try {
    const [row] = await sql`
      INSERT INTO lead_sources
        (organization_id, name, jurisdiction, record_type, category, access_method, url,
         robots_status, terms_status, refresh_cadence, distress_weight, notes)
      VALUES
        (${organizationId}, ${APOLLO_SOURCE_NAME}, 'US', 'apollo_contact', ${category}, 'API',
         'https://www.apollo.io', 'NOT_CHECKED', 'MANUAL_ONLY', 'daily', 60,
         'Apollo.io licensed API source (auto-registered). Contact data is never persisted.')
      RETURNING id, distress_weight, record_type, category
    `;
    return row as ApolloSourceRow;
  } catch {
    // Concurrent create or unique race — re-read instead of failing the pull.
    const again = (await find())[0] as ApolloSourceRow | undefined;
    if (again) return again;
    throw new Error('Failed to register the Apollo.io lead source');
  }
}

interface ApolloRequestBody {
  query?: unknown;
  titles?: unknown;
  category?: unknown;
  page?: unknown;
  perPage?: unknown;
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization found' }, { status: 403 });

  const cfg = getApolloConfig();
  if (!cfg.ok) {
    return Response.json(
      { error: cfg.error, code: cfg.code, missing: cfg.missing },
      { status: 503 }
    );
  }

  const b = (await request.json().catch(() => ({}))) as ApolloRequestBody;

  const query = typeof b.query === 'string' ? b.query.trim().slice(0, 200) : '';
  const titles = Array.isArray(b.titles)
    ? b.titles
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const category: SourcedCategory = b.category === 'buyer' ? 'buyer' : 'seller';
  const page = Math.max(1, Math.floor(Number(b.page) || 1));
  const perPage = Math.min(
    cfg.config.maxPerPage,
    Math.max(1, Math.floor(Number(b.perPage) || 25))
  );

  const source = await ensureApolloSource(organization.id, category);

  let outcome;
  try {
    outcome = await withCreditDeduction(
    organization.id,
    'LEAD_FIND',
    async () => {
      const search = await apolloSearchPeople(cfg.config, { page, perPage, titles, query });
      const { leads, invalid } = normalizeApolloPeople(search.people);
      const { unique, duplicates: batchDupes } = dedupeApolloBatch(leads);

      const provenanceBase = {
        provider: 'apollo.io',
        source_name: APOLLO_SOURCE_NAME,
        ingest: 'apollo_api',
        fetch_date: new Date().toISOString(),
        query: query || null,
        title_filters: titles,
        page,
        per_page: perPage,
        contacts_redacted: true,
      };

      const sourceId = source.id;
      const categoryForRows: SourcedCategory = source.category === 'buyer' ? 'buyer' : 'seller';
      const rows = unique.map((lead) => {
        const { score, reasons } = scoreSourcedLead({
          signals: lead.signals,
          assessedValueCents: null,
          sourceWeight: Number(source.distress_weight) || 50,
        });
        return {
          sourceId,
          category: categoryForRows,
          ownerName: lead.ownerName,
          recordType: source.record_type,
          signals: JSON.stringify(lead.signals),
          rawFields: JSON.stringify(lead.rawFields),
          provenance: JSON.stringify(provenanceBase),
          score,
          reasons: JSON.stringify(reasons),
          scopedKey: `${sourceId}|${lead.dedupeKey}`,
          createdBy: admin.userId,
        };
      });

      let inserted = 0;
      let dbDupes = 0;
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        const chunk = rows.slice(i, i + INSERT_BATCH);
        const result = await sql`
          INSERT INTO sourced_leads
            (source_id, category, owner_name, property_address, mailing_address, parcel_id,
             record_type, county, assessed_value_cents, signals, raw_fields, provenance,
             distress_score, score_reasons, dedupe_key, created_by)
          SELECT * FROM unnest(
            ${chunk.map((r) => r.sourceId)}::int[],
            ${chunk.map((r) => r.category)}::text[],
            ${chunk.map((r) => r.ownerName)}::text[],
            ${chunk.map(() => null)}::text[],
            ${chunk.map(() => null)}::text[],
            ${chunk.map(() => null)}::text[],
            ${chunk.map((r) => r.recordType)}::text[],
            ${chunk.map(() => null)}::text[],
            ${chunk.map(() => null)}::int[],
            ${chunk.map((r) => r.signals)}::jsonb[],
            ${chunk.map((r) => r.rawFields)}::jsonb[],
            ${chunk.map((r) => r.provenance)}::jsonb[],
            ${chunk.map((r) => r.score)}::int[],
            ${chunk.map((r) => r.reasons)}::jsonb[],
            ${chunk.map((r) => r.scopedKey)}::text[],
            ${chunk.map((r) => r.createdBy)}::text[]
          )
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id
        `;
        inserted += result.length;
        dbDupes += chunk.length - result.length;
      }

      return {
        fetched: search.people.length,
        inserted,
        duplicates: batchDupes + dbDupes,
        invalid,
        retriesUsed: search.retriesUsed,
      };
    },
    {
      description: `Apollo.io lead pull (${perPage} records, page ${page})`,
      refundOnError: true,
      metadata: {
        provider: 'apollo.io',
        sourceId: source.id,
        query: query || null,
        titles,
        category,
        page,
        perPage,
      },
    }
  );
  } catch (err) {
    // Upstream/adapter failures (credits already refunded by the guard).
    console.error('[lead-finder/apollo] pull failed:', err);
    return mapApolloError(err);
  }

  if (!outcome.success) {
    // Insufficient credits — 402 from the credit guard, nothing charged.
    return outcome.error;
  }

  await sql`
    UPDATE lead_sources
    SET last_refreshed_at = now(),
        last_record_count = (SELECT COUNT(*)::int FROM sourced_leads WHERE source_id = ${source.id})
    WHERE id = ${source.id}
      AND (organization_id = ${organization.id} OR organization_id IS NULL)
  `;

  await logEvent(
    'lead_source_fetched',
    'lead_source',
    String(source.id),
    {
      provider: 'apollo.io',
      ...outcome.result,
      creditsDeducted: outcome.creditsDeducted,
    },
    admin.userId
  );

  return Response.json({
    provider: 'apollo.io',
    sourceId: source.id,
    ...outcome.result,
    creditsDeducted: outcome.creditsDeducted,
    contactsRedacted: true,
    disclaimer:
      'Apollo.io pulls are normalized into signal-based sourced leads. Contact data is ' +
      'never persisted (platform data-minimization policy); resolve contacts downstream. ' +
      'Scores are estimates, not guaranteed outcomes.',
  });
}

/** Map upstream Apollo failures to safe, static HTTP responses (no secrets). */
export function mapApolloError(err: unknown): Response {
  if (err instanceof ApolloApiError) {
    switch (err.code) {
      case 'RATE_LIMITED':
        return Response.json(
          { error: 'Apollo rate limit reached. Retry after the indicated delay.', code: 'APOLLO_RATE_LIMITED' },
          { status: 429, headers: { 'Retry-After': '5' } }
        );
      case 'AUTH_FAILED':
        return Response.json(
          { error: 'Apollo rejected the configured credentials. Check APOLLO_API_KEY.', code: 'APOLLO_AUTH_FAILED' },
          { status: 502 }
        );
      case 'BAD_REQUEST':
        return Response.json(
          { error: 'Apollo rejected the search request.', code: 'APOLLO_BAD_REQUEST' },
          { status: 502 }
        );
      case 'TIMEOUT':
      case 'NETWORK':
      case 'SERVER_ERROR':
        return Response.json(
          { error: 'Apollo.io is currently unreachable. Try again shortly.', code: 'APOLLO_UNAVAILABLE' },
          { status: 502 }
        );
      case 'INVALID_RESPONSE':
        return Response.json(
          { error: 'Apollo returned an unexpected response shape.', code: 'APOLLO_INVALID_RESPONSE' },
          { status: 502 }
        );
    }
  }
  return Response.json({ error: 'Internal Server Error' }, { status: 500 });
}
