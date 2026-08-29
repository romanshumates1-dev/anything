/**
 * Campaign CRUD operations
 *
 * GET: Get campaign details
 * PATCH: Update campaign
 * DELETE: Delete campaign (soft delete, archives instead)
 */
import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';

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
    const campaignId = Number(id);

    if (!Number.isInteger(campaignId)) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    const [campaign] = await sql`
      SELECT c.*,
        (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id) as lead_count
      FROM campaigns c
      WHERE c.id = ${campaignId} AND c.organization_id = ${organization.id}
      LIMIT 1
    `;

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json(campaign);
  } catch (error: any) {
    console.error('GET /api/campaigns/[id] error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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
    const campaignId = Number(id);

    if (!Number.isInteger(campaignId)) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    // Verify campaign belongs to org
    const [existing] = await sql`
      SELECT id, status FROM campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
      LIMIT 1
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, template, status } = body;

    // Validate status transition if provided
    if (status) {
      const validStatuses = ['draft', 'scheduled', 'launched', 'paused', 'completed'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
    }

    const [updated] = await sql`
      UPDATE campaigns
      SET
        name = COALESCE(${name}, name),
        template = COALESCE(${template ? JSON.stringify(template) : null}, template),
        status = COALESCE(${status}, status),
        updated_at = NOW()
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
      RETURNING *
    `;

    await logEvent('campaign_updated', 'campaign', String(campaignId), {
      changes: { name, template: !!template, status },
    }, session.user.id);

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PATCH /api/campaigns/[id] error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

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
    const campaignId = Number(id);

    if (!Number.isInteger(campaignId)) {
      return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 });
    }

    // Verify campaign belongs to org and get current status
    const [existing] = await sql`
      SELECT id, status, name FROM campaigns
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
      LIMIT 1
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Don't allow deleting active/launched campaigns
    if (['launched', 'scheduled'].includes(existing.status)) {
      return NextResponse.json({
        error: 'Cannot delete active campaign. Pause or complete it first.',
      }, { status: 400 });
    }

    // Soft delete: mark as archived instead of hard delete
    await sql`
      UPDATE campaigns
      SET status = 'archived', updated_at = NOW()
      WHERE id = ${campaignId} AND organization_id = ${organization.id}
    `;

    // Also cancel any pending jobs for this campaign
    await sql`
      UPDATE jobs
      SET status = 'cancelled', updated_at = NOW()
      WHERE payload->>'campaignId' = ${String(campaignId)}
        AND status IN ('pending', 'processing')
    `;

    await logEvent('campaign_deleted', 'campaign', String(campaignId), {
      previousStatus: existing.status,
      name: existing.name,
    }, session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Campaign archived successfully',
    });
  } catch (error: any) {
    console.error('DELETE /api/campaigns/[id] error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
