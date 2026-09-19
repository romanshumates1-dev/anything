/**
 * Territories API
 *
 * GET /api/territories - List saved territories
 * POST /api/territories - Create a new territory
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import sql from '@/app/api/utils/sql';
import * as crypto from 'crypto';

interface Region {
  type: 'ZIP' | 'COUNTY' | 'STATE' | 'CITY' | 'MSA';
  value: string;
  name?: string;
  include: boolean;
  parentState?: string;
  parentCounty?: string;
}

// GET /api/territories
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const territories = await sql`
      SELECT
        id,
        name,
        description,
        regions,
        region_count as "regionCount",
        estimated_leads as "estimatedLeads",
        color,
        is_default as "isDefault",
        times_used as "timesUsed",
        last_used_at as "lastUsedAt",
        created_at as "createdAt"
      FROM saved_territories
      WHERE organization_id = ${organization.id}
      ORDER BY is_default DESC, times_used DESC, created_at DESC
    `;

    return NextResponse.json(territories);
  } catch (error: any) {
    console.error('GET /api/territories error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/territories
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
    const { name, description, regions, color, isDefault } = body as {
      name: string;
      description?: string;
      regions: Region[];
      color?: string;
      isDefault?: boolean;
    };

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (name.length > 100) {
      return NextResponse.json({ error: 'Name must be 100 characters or less' }, { status: 400 });
    }

    if (!Array.isArray(regions) || regions.length === 0) {
      return NextResponse.json({ error: 'At least one region is required' }, { status: 400 });
    }

    if (regions.length > 500) {
      return NextResponse.json({ error: 'Maximum 500 regions per territory' }, { status: 400 });
    }

    // Validate each region
    for (const region of regions) {
      if (!['ZIP', 'COUNTY', 'STATE', 'CITY', 'MSA'].includes(region.type)) {
        return NextResponse.json({
          error: `Invalid region type: ${region.type}`,
        }, { status: 400 });
      }
      if (!region.value || typeof region.value !== 'string') {
        return NextResponse.json({
          error: 'Region value is required',
        }, { status: 400 });
      }
    }

    // Check for duplicate name
    const [existing] = await sql`
      SELECT id FROM saved_territories
      WHERE organization_id = ${organization.id}
        AND LOWER(name) = LOWER(${name.trim()})
    `;

    if (existing) {
      return NextResponse.json({
        error: 'A territory with this name already exists',
      }, { status: 409 });
    }

    // If setting as default, clear other defaults
    if (isDefault) {
      await sql`
        UPDATE saved_territories
        SET is_default = false, updated_at = NOW()
        WHERE organization_id = ${organization.id}
          AND is_default = true
      `;
    }

    // Create territory
    const id = crypto.randomUUID();

    const [territory] = await sql`
      INSERT INTO saved_territories (
        id, organization_id, name, description, regions,
        region_count, color, is_default
      )
      VALUES (
        ${id}, ${organization.id}, ${name.trim()}, ${description || null},
        ${JSON.stringify(regions)}, ${regions.length},
        ${color || null}, ${isDefault || false}
      )
      RETURNING
        id,
        name,
        description,
        regions,
        region_count as "regionCount",
        color,
        is_default as "isDefault",
        created_at as "createdAt"
    `;

    await logEvent('territory_created', 'territory', id, {
      name: name.trim(),
      regionCount: regions.length,
    }, session.user.id);

    return NextResponse.json(territory, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/territories error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
