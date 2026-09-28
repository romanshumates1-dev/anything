/**
 * Region Estimate API
 *
 * POST /api/regions/estimate - Estimate lead count for a region set
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';
import { buildWhere, combine, type Fragment } from '@/app/api/utils/sqlFragments';

interface Region {
  type: 'ZIP' | 'COUNTY' | 'STATE' | 'CITY' | 'MSA';
  value: string;
  include: boolean;
}

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { regions } = body as { regions: Region[] };

    if (!Array.isArray(regions)) {
      return NextResponse.json({ error: 'regions array required' }, { status: 400 });
    }

    if (regions.length === 0) {
      // No regions = all leads FOR THIS TENANT ONLY.
      const [result] = await sql`
        SELECT COUNT(*) as count FROM leads WHERE organization_id = ${organization.id}
      `;
      return NextResponse.json({ count: Number(result.count) });
    }

    // Parse regions into include/exclude arrays
    const includeZips: string[] = [];
    const excludeZips: string[] = [];
    const includeStates: string[] = [];
    const excludeStates: string[] = [];
    const includeCounties: string[] = [];
    const excludeCounties: string[] = [];

    for (const region of regions) {
      switch (region.type) {
        case 'ZIP':
          if (region.include) {
            includeZips.push(region.value);
          } else {
            excludeZips.push(region.value);
          }
          break;
        case 'STATE':
          if (region.include) {
            includeStates.push(region.value.toUpperCase());
          } else {
            excludeStates.push(region.value.toUpperCase());
          }
          break;
        case 'COUNTY':
          // County format: "STATE_CountyName"
          if (region.include) {
            includeCounties.push(region.value);
          } else {
            excludeCounties.push(region.value);
          }
          break;
      }
    }

    // Build dynamic query for lead count
    // We count from leads table and campaign_contacts table

    // Count from leads
    let leadsCount = 0;

    // Build conditions
    const hasIncludes = includeZips.length > 0 || includeStates.length > 0 || includeCounties.length > 0;

    // Defect #32, third wave. The old form interpolated nested `sql` fragments
    // into a boolean position. The pinned driver binds EVERY interpolation to a
    // positional $n, so `AND ${sql`...`}` reached Postgres as `AND $3` and failed
    // with `invalid input syntax for type boolean` - verified against the live
    // database. Empty fragments fail the same way, so both ternary branches were
    // a 500. This route is the region-targeting lead-count estimate, called from
    // the campaign builder, so it is production-reachable.
    //
    // The whole predicate is now built as text+params and every user-supplied
    // array is BOUND, never interpolated as text.
    const includeFrag: Fragment[] = [];
    if (includeZips.length > 0) {
      includeFrag.push({ text: 'l.zip = ANY($1)', params: [includeZips] });
    }
    if (includeStates.length > 0) {
      includeFrag.push({ text: 'l.state = ANY($1)', params: [includeStates] });
    }
    if (includeCounties.length > 0) {
      includeFrag.push({
        text: "(l.state || '_' || l.county) = ANY($1)",
        params: [includeCounties],
      });
    }

    const excludeFrag: Fragment[] = [];
    if (excludeZips.length > 0) {
      excludeFrag.push({ text: '(l.zip IS NULL OR l.zip != ALL($1))', params: [excludeZips] });
    }
    if (excludeStates.length > 0) {
      excludeFrag.push({
        text: '(l.state IS NULL OR l.state != ALL($1))',
        params: [excludeStates],
      });
    }
    if (excludeCounties.length > 0) {
      excludeFrag.push({
        text:
          "((l.state || '_' || l.county) IS NULL OR (l.state || '_' || l.county) != ALL($1))",
        params: [excludeCounties],
      });
    }

    const regionWhere = buildWhere()
      .eq('l.organization_id', organization.id)
      .when(hasIncludes, (w) => w.nest(combine(includeFrag, 'OR')))
      .when(excludeFrag.length > 0, (w) => w.nest(combine(excludeFrag, 'AND')))
      .build();

    const [result] = await sql(
      `SELECT COUNT(*) as count
       FROM leads l
       WHERE ${regionWhere.text}`,
      regionWhere.params as never[]
    );
    leadsCount = Number(result.count);

    // Also get estimate from campaign_contacts for context
    let contactsCount = 0;
    try {
      if (hasIncludes) {
        const contactIncludeFrag: Fragment[] = [];
        if (includeZips.length > 0) {
          contactIncludeFrag.push({ text: 'cc.zip = ANY($1)', params: [includeZips] });
        }
        if (includeStates.length > 0) {
          contactIncludeFrag.push({ text: 'cc.state = ANY($1)', params: [includeStates] });
        }
        if (includeCounties.length > 0) {
          contactIncludeFrag.push({
            text: "(cc.state || '_' || cc.county) = ANY($1)",
            params: [includeCounties],
          });
        }
        // organization_id is already $1, so the OR group must start at $2.
        const contactInclude = combine(contactIncludeFrag, 'OR', 1);
        const [result] = await sql(
          `SELECT COUNT(*) as count
           FROM campaign_contacts cc
           WHERE cc.organization_id = $1
           AND (${contactInclude.text})`,
          [organization.id, ...contactInclude.params] as never[]
        );
        contactsCount = Number(result.count);
      } else {
        const [result] = await sql`
          SELECT COUNT(*) as count
          FROM campaign_contacts cc
          WHERE cc.organization_id = ${organization.id}
        `;
        contactsCount = Number(result.count);
      }
    } catch {
      // campaign_contacts might not have region columns yet
      contactsCount = 0;
    }

    return NextResponse.json({
      count: leadsCount,
      contactsCount,
      regions: regions.length,
      breakdown: {
        includeZips: includeZips.length,
        excludeZips: excludeZips.length,
        includeStates: includeStates.length,
        excludeStates: excludeStates.length,
        includeCounties: includeCounties.length,
        excludeCounties: excludeCounties.length,
      },
    });
  } catch (error: any) {
    console.error('POST /api/regions/estimate error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
