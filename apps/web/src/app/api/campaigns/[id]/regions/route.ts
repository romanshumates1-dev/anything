/**
 * Campaign Regions API
 *
 * GET /api/campaigns/:id/regions - Get campaign regions
 * POST /api/campaigns/:id/regions - Save campaign regions
 * DELETE /api/campaigns/:id/regions - Clear campaign regions
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

// GET /api/campaigns/:id/regions
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
    const { id: campaignId } = await params;

    // Verify campaign belongs to org
    const [campaign] = await sql`
      SELECT id FROM outreach_campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
    `;

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Get regions
    const regions = await sql`
      SELECT
        id,
        type,
        value,
        name,
        include,
        parent_state as "parentState",
        parent_county as "parentCounty",
        metadata,
        created_at as "createdAt"
      FROM campaign_regions
      WHERE campaign_id = ${campaignId}
      ORDER BY include DESC, type, value
    `;

    // Also get from campaign_settings.target_regions for backwards compatibility
    const [settings] = await sql`
      SELECT target_regions FROM campaign_settings
      WHERE campaign_id = ${campaignId}
    `;

    // Merge if campaign_regions table is empty but target_regions has data
    const legacyRegions = settings?.target_regions || [];
    const normalizedLegacy = legacyRegions.map((r: any) => ({
      type: (r.type || 'ZIP').toUpperCase(),
      value: r.value,
      include: r.include !== false,
    }));

    // If no regions in new table but have legacy, return legacy
    if (regions.length === 0 && normalizedLegacy.length > 0) {
      return NextResponse.json({
        regions: normalizedLegacy,
        source: 'legacy',
      });
    }

    return NextResponse.json({
      regions: regions.map((r: any) => ({
        type: r.type,
        value: r.value,
        name: r.name,
        include: r.include,
        parentState: r.parentState,
        parentCounty: r.parentCounty,
      })),
      source: 'campaign_regions',
    });
  } catch (error: any) {
    console.error('GET /api/campaigns/[id]/regions error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/campaigns/:id/regions
export async function POST(
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
    const { id: campaignId } = await params;
    const body = await request.json();
    const { regions, replace = true } = body as { regions: Region[]; replace?: boolean };

    if (!Array.isArray(regions)) {
      return NextResponse.json({ error: 'regions array required' }, { status: 400 });
    }

    // Verify campaign belongs to org
    const [campaign] = await sql`
      SELECT id FROM outreach_campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
    `;

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Validate regions
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

    // Transaction: clear existing and insert new
    if (replace) {
      await sql`
        DELETE FROM campaign_regions
        WHERE campaign_id = ${campaignId}
      `;
    }

    // Insert new regions
    let inserted = 0;
    for (const region of regions) {
      const id = crypto.randomUUID();
      await sql`
        INSERT INTO campaign_regions (
          id, organization_id, campaign_id,
          type, value, name, include,
          parent_state, parent_county
        )
        VALUES (
          ${id}, ${organization.id}, ${campaignId},
          ${region.type}, ${region.value}, ${region.name || null}, ${region.include !== false},
          ${region.parentState || null}, ${region.parentCounty || null}
        )
        ON CONFLICT (campaign_id, type, value) WHERE campaign_id IS NOT NULL
        DO UPDATE SET
          include = EXCLUDED.include,
          name = EXCLUDED.name,
          parent_state = EXCLUDED.parent_state,
          parent_county = EXCLUDED.parent_county,
          updated_at = NOW()
      `;
      inserted++;
    }

    // Also update campaign_settings.target_regions for backwards compatibility
    const targetRegions = regions.map((r) => ({
      type: r.type.toLowerCase(),
      value: r.value,
      include: r.include !== false,
    }));

    await sql`
      INSERT INTO campaign_settings (id, campaign_id, organization_id, target_regions)
      VALUES (${crypto.randomUUID()}, ${campaignId}, ${organization.id}, ${JSON.stringify(targetRegions)})
      ON CONFLICT (campaign_id) DO UPDATE SET
        target_regions = ${JSON.stringify(targetRegions)},
        updated_at = NOW()
    `;

    await logEvent('campaign_regions_updated', 'campaign', campaignId, {
      regionCount: regions.length,
      replace,
    }, session.user.id);

    return NextResponse.json({
      success: true,
      inserted,
      total: regions.length,
    });
  } catch (error: any) {
    console.error('POST /api/campaigns/[id]/regions error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE /api/campaigns/:id/regions
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
    const { id: campaignId } = await params;

    // Verify campaign belongs to org
    const [campaign] = await sql`
      SELECT id FROM outreach_campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
    `;

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Delete all regions
    const result = await sql`
      DELETE FROM campaign_regions
      WHERE campaign_id = ${campaignId}
      RETURNING id
    `;

    // Clear from campaign_settings too
    await sql`
      UPDATE campaign_settings
      SET target_regions = '[]'::jsonb, updated_at = NOW()
      WHERE campaign_id = ${campaignId}
    `;

    await logEvent('campaign_regions_cleared', 'campaign', campaignId, {
      deleted: result.length,
    }, session.user.id);

    return NextResponse.json({
      success: true,
      deleted: result.length,
    });
  } catch (error: any) {
    console.error('DELETE /api/campaigns/[id]/regions error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
