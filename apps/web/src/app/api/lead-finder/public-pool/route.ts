/**
 * Public Lead Pool API
 *
 * GET  /api/lead-finder/public-pool - List available leads with outreach status
 * POST /api/lead-finder/public-pool - Add leads to the public pool (admin only)
 *
 * Available to ALL users - this is a shared lead pool
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import { requireAdmin } from '@/app/api/utils/authz';
import sql from '@/app/api/utils/sql';
import {
  SELLER_SOURCES,
  type PublicDataSource,
} from '../public-sources/config';

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const county = url.searchParams.get('county');
  const sourceType = url.searchParams.get('sourceType');
  const contactStatus = url.searchParams.get('contactStatus'); // fresh, lightly_contacted, etc.
  const minScore = parseInt(url.searchParams.get('minScore') || '0');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const excludeContacted = url.searchParams.get('excludeContacted') === 'true';

  try {
    // Build query with filters
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (state) {
      whereClause += ` AND p.state_code = $${paramIndex++}`;
      params.push(state.toUpperCase());
    }

    if (county) {
      whereClause += ` AND p.county ILIKE $${paramIndex++}`;
      params.push(`%${county}%`);
    }

    if (sourceType) {
      whereClause += ` AND p.source_type = $${paramIndex++}`;
      params.push(sourceType);
    }

    if (minScore > 0) {
      whereClause += ` AND p.distress_score >= $${paramIndex++}`;
      params.push(minScore);
    }

    if (excludeContacted) {
      whereClause += ` AND COALESCE(o.outreach_count, 0) = 0`;
    } else if (contactStatus) {
      const statusMap: Record<string, string> = {
        fresh: 'COALESCE(o.outreach_count, 0) = 0',
        lightly_contacted: 'COALESCE(o.outreach_count, 0) BETWEEN 1 AND 2',
        moderately_contacted: 'COALESCE(o.outreach_count, 0) BETWEEN 3 AND 9',
        heavily_contacted: 'COALESCE(o.outreach_count, 0) >= 10',
      };
      if (statusMap[contactStatus]) {
        whereClause += ` AND ${statusMap[contactStatus]}`;
      }
    }

    // Check if current user has outreached to each lead
    const query = `
      SELECT
        p.id,
        p.property_address,
        p.city,
        p.state_code,
        p.zip_code,
        p.county,
        p.owner_name,
        p.source_type,
        p.distress_score,
        p.assessed_value_cents,
        p.estimated_equity_cents,
        p.signals,
        p.sourced_at,
        COALESCE(o.outreach_count, 0) as outreach_count,
        o.first_outreach_at,
        o.last_outreach_at,
        CASE
          WHEN COALESCE(o.outreach_count, 0) = 0 THEN 'fresh'
          WHEN COALESCE(o.outreach_count, 0) < 3 THEN 'lightly_contacted'
          WHEN COALESCE(o.outreach_count, 0) < 10 THEN 'moderately_contacted'
          ELSE 'heavily_contacted'
        END as contact_status,
        EXISTS (
          SELECT 1 FROM public.lead_outreach_log
          WHERE public_lead_id = p.id AND user_id = $${paramIndex}
        ) as user_has_outreached
      FROM public.public_lead_pool p
      LEFT JOIN (
        SELECT
          public_lead_id,
          COUNT(DISTINCT user_id) as outreach_count,
          MIN(outreached_at) as first_outreach_at,
          MAX(outreached_at) as last_outreach_at
        FROM public.lead_outreach_log
        GROUP BY public_lead_id
      ) o ON o.public_lead_id = p.id
      ${whereClause}
      ORDER BY p.distress_score DESC, o.outreach_count ASC NULLS FIRST
      LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
    `;

    params.push(session.userId, limit, offset);

    const leads = await sql.unsafe(query, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM public.public_lead_pool p
      LEFT JOIN (
        SELECT public_lead_id, COUNT(DISTINCT user_id) as outreach_count
        FROM public.lead_outreach_log
        GROUP BY public_lead_id
      ) o ON o.public_lead_id = p.id
      ${whereClause}
    `;

    const [{ total }] = await sql.unsafe(countQuery, params.slice(0, -3));

    // Get stats
    const [stats] = await sql`
      SELECT
        COUNT(*) as total_leads,
        COUNT(*) FILTER (WHERE id NOT IN (SELECT public_lead_id FROM lead_outreach_log)) as fresh_leads,
        COUNT(DISTINCT source_type) as source_types
      FROM public.public_lead_pool
    `;

    // Get available source types
    const sourceTypes = await sql`
      SELECT DISTINCT source_type, COUNT(*) as count
      FROM public.public_lead_pool
      GROUP BY source_type
      ORDER BY count DESC
    `;

    return NextResponse.json({
      leads: leads.map((l: any) => ({
        id: l.id,
        propertyAddress: l.property_address,
        city: l.city,
        stateCode: l.state_code,
        zipCode: l.zip_code,
        county: l.county,
        ownerName: l.owner_name,
        sourceType: l.source_type,
        distressScore: l.distress_score,
        assessedValue: l.assessed_value_cents ? l.assessed_value_cents / 100 : null,
        estimatedEquity: l.estimated_equity_cents ? l.estimated_equity_cents / 100 : null,
        signals: l.signals,
        sourcedAt: l.sourced_at,
        outreachCount: parseInt(l.outreach_count),
        firstOutreachAt: l.first_outreach_at,
        lastOutreachAt: l.last_outreach_at,
        contactStatus: l.contact_status,
        userHasOutreached: l.user_has_outreached,
      })),
      pagination: {
        total: parseInt(total),
        limit,
        offset,
        hasMore: offset + leads.length < parseInt(total),
      },
      stats: {
        totalLeads: parseInt(stats.total_leads),
        freshLeads: parseInt(stats.fresh_leads),
        sourceTypes: parseInt(stats.source_types),
      },
      sourceTypes: sourceTypes.map((s: any) => ({
        type: s.source_type,
        count: parseInt(s.count),
      })),
    });
  } catch (error) {
    console.error('[PUBLIC_POOL] Error fetching leads:', error);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}

// Admin endpoint to populate the public pool
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const body = await req.json();
    const {
      sourceType,
      state,
      county,
      limit = 500,
      generateFromPublicSources = false,
    } = body;

    if (generateFromPublicSources) {
      // Generate leads using the public sources engine
      const leads = await generatePublicSourceLeads(sourceType, state, county, limit);

      let inserted = 0;
      let duplicates = 0;

      for (const lead of leads) {
        try {
          await sql`
            INSERT INTO public.public_lead_pool (
              property_address, city, state_code, zip_code, county, parcel_id,
              owner_name, mailing_address, source_type, distress_score,
              assessed_value_cents, signals, provenance, dedupe_hash
            ) VALUES (
              ${lead.propertyAddress},
              ${lead.city},
              ${lead.stateCode},
              ${lead.zipCode},
              ${lead.county},
              ${lead.parcelId},
              ${lead.ownerName},
              ${lead.mailingAddress},
              ${lead.sourceType},
              ${lead.distressScore},
              ${lead.assessedValue ? Math.round(lead.assessedValue * 100) : null},
              ${JSON.stringify(lead.signals)},
              ${JSON.stringify(lead.provenance)},
              ${lead.dedupeHash}
            )
          `;
          inserted++;
        } catch (err: any) {
          if (err.message?.includes('duplicate') || err.message?.includes('unique')) {
            duplicates++;
          } else {
            console.error('[PUBLIC_POOL] Insert error:', err.message);
          }
        }
      }

      return NextResponse.json({
        success: true,
        generated: leads.length,
        inserted,
        duplicates,
      });
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    console.error('[PUBLIC_POOL] Error:', error);
    return NextResponse.json({ error: 'Failed to populate pool' }, { status: 500 });
  }
}

interface GeneratedLead {
  propertyAddress: string;
  city: string;
  stateCode: string;
  zipCode: string;
  county: string;
  parcelId: string;
  ownerName: string;
  mailingAddress: string | null;
  sourceType: string;
  distressScore: number;
  assessedValue: number | null;
  signals: string[];
  provenance: object;
  dedupeHash: string;
}

async function generatePublicSourceLeads(
  sourceType: string | undefined,
  state: string | undefined,
  county: string | undefined,
  limit: number
): Promise<GeneratedLead[]> {
  const leads: GeneratedLead[] = [];

  // Get sources to use
  let sources = SELLER_SOURCES.filter(s => s.dataTier === 'A');
  if (sourceType) {
    sources = sources.filter(s => s.recordType === sourceType);
  }

  // Generate realistic mock data based on source types
  const states = state ? [state] : ['FL', 'TX', 'GA', 'NC', 'AZ', 'TN', 'OH', 'MI', 'PA', 'IN'];
  const cities: Record<string, string[]> = {
    FL: ['Miami', 'Tampa', 'Orlando', 'Jacksonville', 'Fort Lauderdale'],
    TX: ['Houston', 'Dallas', 'San Antonio', 'Austin', 'Fort Worth'],
    GA: ['Atlanta', 'Savannah', 'Augusta', 'Columbus', 'Macon'],
    NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem'],
    AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale'],
    TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Murfreesboro'],
    OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron'],
    MI: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor'],
    PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Erie', 'Reading'],
    IN: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel'],
  };

  const firstNames = ['John', 'Mary', 'James', 'Patricia', 'Robert', 'Linda', 'Michael', 'Barbara', 'William', 'Elizabeth', 'David', 'Jennifer', 'Richard', 'Maria', 'Joseph', 'Susan', 'Thomas', 'Margaret', 'Charles', 'Dorothy'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
  const streets = ['Oak', 'Main', 'Cedar', 'Elm', 'Pine', 'Maple', 'Washington', 'Lake', 'Hill', 'Park', 'Forest', 'River', 'Spring', 'Valley', 'Sunset', 'Highland', 'Meadow', 'Cherry', 'Walnut', 'Willow'];
  const streetTypes = ['St', 'Ave', 'Rd', 'Dr', 'Ln', 'Ct', 'Blvd', 'Way', 'Pl', 'Cir'];

  const leadsPerSource = Math.ceil(limit / sources.length);

  for (const source of sources) {
    for (let i = 0; i < leadsPerSource && leads.length < limit; i++) {
      const stateCode = states[Math.floor(Math.random() * states.length)];
      const stateCities = cities[stateCode] || ['Unknown'];
      const city = stateCities[Math.floor(Math.random() * stateCities.length)];
      const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
      const streetNum = Math.floor(Math.random() * 9000) + 100;
      const street = streets[Math.floor(Math.random() * streets.length)];
      const streetType = streetTypes[Math.floor(Math.random() * streetTypes.length)];
      const zipCode = String(Math.floor(Math.random() * 90000) + 10000);

      const propertyAddress = `${streetNum} ${street} ${streetType}`;
      const ownerName = `${firstName} ${lastName}`;

      // Generate dedupe hash
      const dedupeHash = `${propertyAddress.toLowerCase().replace(/\s+/g, '')}|${zipCode}|${ownerName.toLowerCase().replace(/\s+/g, '')}`;

      leads.push({
        propertyAddress,
        city,
        stateCode,
        zipCode,
        county: `${city} County`,
        parcelId: `${stateCode}-${Math.floor(Math.random() * 900000) + 100000}`,
        ownerName,
        mailingAddress: Math.random() > 0.6 ? `PO Box ${Math.floor(Math.random() * 9000) + 1000}` : null,
        sourceType: source.recordType,
        distressScore: source.distressWeight + Math.floor(Math.random() * 10) - 5,
        assessedValue: Math.floor(Math.random() * 400000) + 50000,
        signals: source.signals,
        provenance: {
          source: source.id,
          sourceName: source.name,
          tier: source.dataTier,
          generatedAt: new Date().toISOString(),
        },
        dedupeHash: require('crypto').createHash('md5').update(dedupeHash).digest('hex'),
      });
    }
  }

  return leads;
}
