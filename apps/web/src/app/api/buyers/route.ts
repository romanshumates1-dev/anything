import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

/**
 * GET /api/buyers — list buyers + coverage-gap report.
 * POST /api/buyers — add/update a buyer.
 *
 * Phase 10: scored buyer network.
 * Coverage-gap report flags thin zip+price-band coverage — the decision tool
 * for (a) which JV intakes are safe to accept, (b) which markets need
 * buyer-building focus.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const url = new URL(request.url);
  const includeGap = url.searchParams.get('gap') === '1';

  const buyers = await sql`
    SELECT * FROM buyers
    WHERE organization_id = ${organization.id}
    ORDER BY quality_score DESC, actual_close_count DESC
    LIMIT 200
  `;

  if (!includeGap) {
    return Response.json({ buyers });
  }

  // Coverage-gap report: for each zip in our lead database, how many verified
  // buyers do we have in each price band?
  const gapRows = await sql`
    SELECT
      l.metadata->>'zip' AS zip,
      COUNT(DISTINCT l.id) as lead_count,
      COUNT(DISTINCT b.id) FILTER (WHERE b.verified = true) as verified_buyer_count,
      COUNT(DISTINCT b.id) as total_buyer_count,
      MIN(b.price_min_cents) as buyer_price_min,
      MAX(b.price_max_cents) as buyer_price_max
    FROM leads l
    LEFT JOIN buyers b ON b.organization_id = ${organization.id}
      AND (l.metadata->>'zip') = ANY(b.zip_codes)
    WHERE l.organization_id = ${organization.id}
      AND l.metadata->>'zip' IS NOT NULL
    GROUP BY l.metadata->>'zip'
    ORDER BY lead_count DESC, verified_buyer_count ASC
    LIMIT 50
  `.catch(() => []);

  const coverageGaps = (gapRows as any[]).map(r => ({
    zip: r.zip,
    leadCount: Number(r.lead_count),
    verifiedBuyerCount: Number(r.verified_buyer_count),
    totalBuyerCount: Number(r.total_buyer_count),
    thin: Number(r.verified_buyer_count) < 2,
    recommendation: Number(r.verified_buyer_count) < 2
      ? 'THIN COVERAGE — build buyer list or avoid JV intakes in this zip'
      : 'adequate',
  }));

  return Response.json({ buyers, coverageGaps });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) return Response.json({ error: 'No organization' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as any;
  const {
    id,
    name, phone, email,
    zipCodes, priceMinCents, priceMaxCents,
    cashBuyer, propertyTypes,
    verified, pofSubmitted, allMarkets, // [FIX] Added missing columns for matching
    source, notes,
  } = body;

  if (!name) return Response.json({ error: 'name is required' }, { status: 400 });

  if (id) {
    // Update existing buyer
    await sql`
      UPDATE buyers SET
        name = ${name}, phone = ${phone ?? null}, email = ${email ?? null},
        zip_codes = ${zipCodes ?? []}, price_min_cents = ${priceMinCents ?? null},
        price_max_cents = ${priceMaxCents ?? null}, cash_buyer = ${cashBuyer ?? true},
        property_types = ${propertyTypes ?? []}, verified = ${verified ?? false},
        pof_submitted = ${pofSubmitted ?? false}, all_markets = ${allMarkets ?? false},
        source = ${source ?? 'manual'}, notes = ${notes ?? null},
        updated_at = now()
      WHERE id = ${Number(id)} AND organization_id = ${organization.id}
    `;
    return Response.json({ ok: true, id });
  }

  const [buyer] = await sql`
    INSERT INTO buyers
      (organization_id, name, phone, email, zip_codes, price_min_cents, price_max_cents,
       cash_buyer, property_types, verified, pof_submitted, all_markets, source, notes)
    VALUES
      (${organization.id}, ${name}, ${phone ?? null}, ${email ?? null},
       ${zipCodes ?? []}, ${priceMinCents ?? null}, ${priceMaxCents ?? null},
       ${cashBuyer ?? true}, ${propertyTypes ?? []}, ${verified ?? false},
       ${pofSubmitted ?? false}, ${allMarkets ?? false},
       ${source ?? 'manual'}, ${notes ?? null})
    RETURNING id
  `;

  await logEvent('buyer_added', 'buyer', String(buyer.id), { name, zipCodes }, organization.id);

  return Response.json({ id: buyer.id }, { status: 201 });
}
