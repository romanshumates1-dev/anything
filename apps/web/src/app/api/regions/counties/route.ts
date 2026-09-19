/**
 * Counties API
 *
 * GET /api/regions/counties?state=CA,TX - List counties for given states
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import sql from '@/app/api/utils/sql';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const states = searchParams.getAll('state');

  if (states.length === 0) {
    return NextResponse.json({ error: 'state parameter required' }, { status: 400 });
  }

  // Validate state codes
  const validStates = states.filter((s) => /^[A-Z]{2}$/.test(s.toUpperCase()));
  if (validStates.length === 0) {
    return NextResponse.json({ error: 'Invalid state codes' }, { status: 400 });
  }

  try {
    // Try to get from county_reference table first
    const counties = await sql`
      SELECT
        id,
        state,
        county,
        zip_count
      FROM county_reference
      WHERE state = ANY(${validStates.map((s) => s.toUpperCase())})
      ORDER BY state, county
    `;

    if (counties.length > 0) {
      return NextResponse.json(counties);
    }

    // Fallback: aggregate from zip_reference
    const countiesFromZips = await sql`
      SELECT DISTINCT ON (state, county)
        state || '_' || county AS id,
        state,
        county,
        COUNT(*) OVER (PARTITION BY state, county) AS zip_count
      FROM zip_reference
      WHERE state = ANY(${validStates.map((s) => s.toUpperCase())})
        AND county IS NOT NULL
      ORDER BY state, county
    `;

    if (countiesFromZips.length > 0) {
      return NextResponse.json(countiesFromZips);
    }

    // Final fallback: return hardcoded counties for common states
    const fallbackCounties = getFallbackCounties(validStates);
    return NextResponse.json(fallbackCounties);
  } catch (error: any) {
    console.error('GET /api/regions/counties error:', error);
    // Return fallback on error
    const fallbackCounties = getFallbackCounties(validStates);
    return NextResponse.json(fallbackCounties);
  }
}

// Hardcoded fallback for major states (most populous counties)
function getFallbackCounties(states: string[]): Array<{ id: string; state: string; county: string; zipCount?: number }> {
  const countyMap: Record<string, string[]> = {
    CA: [
      'Los Angeles', 'San Diego', 'Orange', 'Riverside', 'San Bernardino',
      'Santa Clara', 'Alameda', 'Sacramento', 'Contra Costa', 'Fresno',
      'San Francisco', 'Ventura', 'San Mateo', 'Kern', 'San Joaquin',
    ],
    TX: [
      'Harris', 'Dallas', 'Tarrant', 'Bexar', 'Travis',
      'Collin', 'Hidalgo', 'El Paso', 'Denton', 'Fort Bend',
      'Montgomery', 'Williamson', 'Cameron', 'Nueces', 'Bell',
    ],
    FL: [
      'Miami-Dade', 'Broward', 'Palm Beach', 'Hillsborough', 'Orange',
      'Pinellas', 'Duval', 'Lee', 'Polk', 'Brevard',
      'Volusia', 'Pasco', 'Seminole', 'Sarasota', 'Manatee',
    ],
    NY: [
      'Kings', 'Queens', 'New York', 'Suffolk', 'Bronx',
      'Nassau', 'Westchester', 'Erie', 'Monroe', 'Richmond',
      'Onondaga', 'Orange', 'Rockland', 'Albany', 'Dutchess',
    ],
    GA: [
      'Fulton', 'Gwinnett', 'Cobb', 'DeKalb', 'Chatham',
      'Clayton', 'Cherokee', 'Forsyth', 'Henry', 'Richmond',
      'Hall', 'Muscogee', 'Bibb', 'Columbia', 'Douglas',
    ],
    AZ: [
      'Maricopa', 'Pima', 'Pinal', 'Yavapai', 'Yuma',
      'Mohave', 'Coconino', 'Cochise', 'Navajo', 'Apache',
    ],
    NC: [
      'Mecklenburg', 'Wake', 'Guilford', 'Forsyth', 'Cumberland',
      'Durham', 'Buncombe', 'Union', 'Gaston', 'New Hanover',
    ],
    PA: [
      'Philadelphia', 'Allegheny', 'Montgomery', 'Bucks', 'Delaware',
      'Lancaster', 'Chester', 'York', 'Berks', 'Lehigh',
    ],
    OH: [
      'Franklin', 'Cuyahoga', 'Hamilton', 'Summit', 'Montgomery',
      'Lucas', 'Butler', 'Stark', 'Lorain', 'Warren',
    ],
    IL: [
      'Cook', 'DuPage', 'Lake', 'Will', 'Kane',
      'McHenry', 'Winnebago', 'Madison', 'St. Clair', 'Champaign',
    ],
  };

  const results: Array<{ id: string; state: string; county: string }> = [];

  for (const state of states) {
    const stateUpper = state.toUpperCase();
    const counties = countyMap[stateUpper] || [];
    for (const county of counties) {
      results.push({
        id: `${stateUpper}_${county}`,
        state: stateUpper,
        county,
      });
    }
  }

  return results;
}
