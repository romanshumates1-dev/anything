/**
 * Territory Detail API
 *
 * GET /api/territories/:id - Get territory details
 * PATCH /api/territories/:id - Update territory
 * DELETE /api/territories/:id - Delete territory
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import sql from '@/app/api/utils/sql';

interface Region {
  type: 'ZIP' | 'COUNTY' | 'STATE' | 'CITY' | 'MSA';
  value: string;
  name?: string;
  include: boolean;
  parentState?: string;
  parentCounty?: string;
}

// GET /api/territories/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await params;

    const [territory] = await sql`
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
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM saved_territories
      WHERE id = ${id} AND organization_id = ${organization.id}
    `;

    if (!territory) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    return NextResponse.json(territory);
  } catch (error: any) {
    console.error('GET /api/territories/[id] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PATCH /api/territories/:id
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, regions, color, isDefault } = body as {
      name?: string;
      description?: string;
      regions?: Region[];
      color?: string;
      isDefault?: boolean;
    };

    // Check territory exists and belongs to org
    const [existing] = await sql`
      SELECT id FROM saved_territories
      WHERE id = ${id} AND organization_id = ${organization.id}
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    // Validate name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
      }
      if (name.length > 100) {
        return NextResponse.json({ error: 'Name must be 100 characters or less' }, { status: 400 });
      }

      // Check for duplicate name (excluding self)
      const [duplicate] = await sql`
        SELECT id FROM saved_territories
        WHERE organization_id = ${organization.id}
          AND LOWER(name) = LOWER(${name.trim()})
          AND id != ${id}
      `;

      if (duplicate) {
        return NextResponse.json({
          error: 'A territory with this name already exists',
        }, { status: 409 });
      }
    }

    // Validate regions if provided
    if (regions !== undefined) {
      if (!Array.isArray(regions) || regions.length === 0) {
        return NextResponse.json({ error: 'At least one region is required' }, { status: 400 });
      }
      if (regions.length > 500) {
        return NextResponse.json({ error: 'Maximum 500 regions per territory' }, { status: 400 });
      }

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
    }

    // If setting as default, clear other defaults
    if (isDefault === true) {
      await sql`
        UPDATE saved_territories
        SET is_default = false, updated_at = NOW()
        WHERE organization_id = ${organization.id}
          AND is_default = true
          AND id != ${id}
      `;
    }

    // Build update
    const [updated] = await sql`
      UPDATE saved_territories
      SET
        name = COALESCE(${name?.trim() || null}, name),
        description = COALESCE(${description}, description),
        regions = COALESCE(${regions ? JSON.stringify(regions) : null}, regions),
        region_count = COALESCE(${regions?.length || null}, region_count),
        color = COALESCE(${color || null}, color),
        is_default = COALESCE(${isDefault}, is_default),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING
        id,
        name,
        description,
        regions,
        region_count as "regionCount",
        color,
        is_default as "isDefault",
        updated_at as "updatedAt"
    `;

    await logEvent('territory_updated', 'territory', id, {
      changes: { name: !!name, regions: !!regions, isDefault },
    }, session.user.id);

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PATCH /api/territories/[id] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/territories/:id
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const { id } = await params;

    // Check territory exists and belongs to org
    const [existing] = await sql`
      SELECT id, name FROM saved_territories
      WHERE id = ${id} AND organization_id = ${organization.id}
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Territory not found' }, { status: 404 });
    }

    // Delete
    await sql`
      DELETE FROM saved_territories
      WHERE id = ${id}
    `;

    await logEvent('territory_deleted', 'territory', id, {
      name: existing.name,
    }, session.user.id);

    return NextResponse.json({ success: true, deleted: id });
  } catch (error: any) {
    console.error('DELETE /api/territories/[id] error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
