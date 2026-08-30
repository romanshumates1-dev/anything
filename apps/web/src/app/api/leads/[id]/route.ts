/**
 * Lead CRUD operations
 *
 * GET: Get lead details
 * PATCH: Update lead
 * DELETE: Delete lead (soft delete)
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

    const [lead] = await sql`
      SELECT l.*,
        (SELECT COUNT(*) FROM ai_conversations ac WHERE ac.lead_id = l.id) as conversation_count,
        (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.lead_id = l.id) as campaign_count
      FROM leads l
      WHERE l.id = ${id} AND l.organization_id = ${organization.id}
      LIMIT 1
    `;

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json(lead);
  } catch (error: any) {
    console.error('GET /api/leads/[id] error', error);
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

    // Verify lead belongs to org
    const [existing] = await sql`
      SELECT id, status FROM leads
      WHERE id = ${id} AND organization_id = ${organization.id}
      LIMIT 1
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, email, phone, type, status, metadata, ai_paused } = body;

    // Validate type if provided
    if (type && !['seller', 'buyer'].includes(type)) {
      return NextResponse.json({ error: 'Invalid lead type' }, { status: 400 });
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ['new', 'contacted', 'qualified', 'negotiating', 'closed', 'lost', 'CLOSED_WON', 'ASSIGNED', 'OPTED_OUT'];
      if (!validStatuses.includes(status.toLowerCase()) && !validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
    }

    const [updated] = await sql`
      UPDATE leads
      SET
        name = COALESCE(${name}, name),
        email = COALESCE(${email}, email),
        phone = COALESCE(${phone}, phone),
        type = COALESCE(${type}, type),
        status = COALESCE(${status}, status),
        metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata),
        ai_paused = COALESCE(${ai_paused}, ai_paused),
        updated_at = NOW()
      WHERE id = ${id} AND organization_id = ${organization.id}
      RETURNING *
    `;

    await logEvent('lead_updated', 'lead', id, {
      changes: { name, email, phone, type, status, ai_paused },
    }, session.user.id);

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PATCH /api/leads/[id] error', error);
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

    // Verify lead belongs to org
    const [existing] = await sql`
      SELECT id, name, status FROM leads
      WHERE id = ${id} AND organization_id = ${organization.id}
      LIMIT 1
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Don't allow deleting leads with active contracts
    const [activeContract] = await sql`
      SELECT id FROM contracts
      WHERE lead_id = ${id} AND status NOT IN ('cancelled', 'expired')
      LIMIT 1
    `.catch(() => [null]);

    if (activeContract) {
      return NextResponse.json({
        error: 'Cannot delete lead with active contracts',
      }, { status: 400 });
    }

    // Soft delete: mark as deleted instead of hard delete
    await sql`
      UPDATE leads
      SET status = 'DELETED', deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND organization_id = ${organization.id}
    `;

    // Clean up related data
    await sql`
      DELETE FROM campaign_leads WHERE lead_id = ${id}
    `.catch(() => {});

    await logEvent('lead_deleted', 'lead', id, {
      previousStatus: existing.status,
      name: existing.name,
    }, session.user.id);

    return NextResponse.json({
      success: true,
      message: 'Lead deleted successfully',
    });
  } catch (error: any) {
    console.error('DELETE /api/leads/[id] error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
