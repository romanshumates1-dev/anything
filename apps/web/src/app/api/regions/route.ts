/**
 * Regions API - Root endpoint
 *
 * GET /api/regions - Get summary of available region data
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

  try {
    // Get counts from reference tables
    let stateCount = 0;
    let countyCount = 0;
    let zipCount = 0;

    try {
      const [states] = await sql`SELECT COUNT(*) as count FROM state_reference`;
      stateCount = Number(states?.count || 0);
    } catch {
      stateCount = 51; // Fallback
    }

    try {
      const [counties] = await sql`SELECT COUNT(*) as count FROM county_reference`;
      countyCount = Number(counties?.count || 0);
    } catch {
      countyCount = 0; // Not seeded
    }

    try {
      const [zips] = await sql`SELECT COUNT(*) as count FROM zip_reference`;
      zipCount = Number(zips?.count || 0);
    } catch {
      zipCount = 0; // Not seeded
    }

    return NextResponse.json({
      available: {
        states: stateCount,
        counties: countyCount,
        zips: zipCount,
      },
      endpoints: {
        states: '/api/regions/states',
        counties: '/api/regions/counties?state=CA,TX',
        estimate: 'POST /api/regions/estimate',
      },
      note: 'County and ZIP reference data may need to be seeded for full functionality.',
    });
  } catch (error: any) {
    console.error('GET /api/regions error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
