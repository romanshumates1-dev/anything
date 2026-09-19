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
      // No regions = all leads
      const [result] = await sql`
        SELECT COUNT(*) as count FROM leads
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

    if (hasIncludes) {
      // If we have includes, we need to match at least one
      const [result] = await sql`
        SELECT COUNT(*) as count
        FROM leads l
        WHERE (
          ${includeZips.length > 0 ? sql`l.zip = ANY(${includeZips})` : sql`FALSE`}
          OR ${includeStates.length > 0 ? sql`l.state = ANY(${includeStates})` : sql`FALSE`}
          OR ${includeCounties.length > 0 ? sql`(l.state || '_' || l.county) = ANY(${includeCounties})` : sql`FALSE`}
        )
        AND (
          ${excludeZips.length > 0 ? sql`(l.zip IS NULL OR l.zip != ALL(${excludeZips}))` : sql`TRUE`}
          AND ${excludeStates.length > 0 ? sql`(l.state IS NULL OR l.state != ALL(${excludeStates}))` : sql`TRUE`}
          AND ${excludeCounties.length > 0 ? sql`((l.state || '_' || l.county) IS NULL OR (l.state || '_' || l.county) != ALL(${excludeCounties}))` : sql`TRUE`}
        )
      `;
      leadsCount = Number(result.count);
    } else if (excludeZips.length > 0 || excludeStates.length > 0 || excludeCounties.length > 0) {
      // Only excludes - count all leads NOT in excluded regions
      const [result] = await sql`
        SELECT COUNT(*) as count
        FROM leads l
        WHERE (
          ${excludeZips.length > 0 ? sql`(l.zip IS NULL OR l.zip != ALL(${excludeZips}))` : sql`TRUE`}
          AND ${excludeStates.length > 0 ? sql`(l.state IS NULL OR l.state != ALL(${excludeStates}))` : sql`TRUE`}
          AND ${excludeCounties.length > 0 ? sql`((l.state || '_' || l.county) IS NULL OR (l.state || '_' || l.county) != ALL(${excludeCounties}))` : sql`TRUE`}
        )
      `;
      leadsCount = Number(result.count);
    } else {
      // No filters
      const [result] = await sql`
        SELECT COUNT(*) as count FROM leads
      `;
      leadsCount = Number(result.count);
    }

    // Also get estimate from campaign_contacts for context
    let contactsCount = 0;
    try {
      if (hasIncludes) {
        const [result] = await sql`
          SELECT COUNT(*) as count
          FROM campaign_contacts cc
          WHERE cc.organization_id = ${organization.id}
          AND (
            ${includeZips.length > 0 ? sql`cc.zip = ANY(${includeZips})` : sql`FALSE`}
            OR ${includeStates.length > 0 ? sql`cc.state = ANY(${includeStates})` : sql`FALSE`}
            OR ${includeCounties.length > 0 ? sql`(cc.state || '_' || cc.county) = ANY(${includeCounties})` : sql`FALSE`}
          )
        `;
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
