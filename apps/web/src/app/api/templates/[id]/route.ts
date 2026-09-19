import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import sql from '@/app/api/utils/sql';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/templates/[id]
 *
 * Get a single template by ID (user template or library template).
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Try user templates first
    let [template] = await sql`
      SELECT *, 'user' as source
      FROM user_templates
      WHERE id = ${id}
        AND organization_id = ${organization.id}
        AND is_active = true
    `;

    // If not found, try library templates
    if (!template) {
      [template] = await sql`
        SELECT *, 'library' as source
        FROM template_library
        WHERE id = ${id}
          AND is_active = true
      `;
    }

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json(template);
  } catch (error: any) {
    console.error('GET /api/templates/[id] error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * PUT /api/templates/[id]
 *
 * Update a user template.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const {
      name,
      description,
      category,
      channel,
      subject,
      templateBody,
      followUp1,
      followUp1DelayHours,
      followUp2,
      followUp2DelayHours,
      followUp3,
      followUp3DelayHours,
      tags,
      isFavorite,
    } = body;

    // Check ownership
    const [existing] = await sql`
      SELECT id FROM user_templates
      WHERE id = ${id} AND organization_id = ${organization.id} AND is_active = true
    `;

    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Extract variables if body is being updated
    let variables;
    if (templateBody) {
      const variablePattern = /\{\{[a-zA-Z]+\}\}/g;
      const allText = [templateBody, subject || '', followUp1 || '', followUp2 || '', followUp3 || ''].join(' ');
      variables = [...new Set(allText.match(variablePattern) || [])];
    }

    const [updated] = await sql`
      UPDATE user_templates
      SET
        name = COALESCE(${name}, name),
        description = COALESCE(${description}, description),
        category = COALESCE(${category}, category),
        channel = COALESCE(${channel}, channel),
        subject = COALESCE(${subject}, subject),
        body = COALESCE(${templateBody}, body),
        follow_up_1 = COALESCE(${followUp1}, follow_up_1),
        follow_up_1_delay_hours = COALESCE(${followUp1DelayHours}, follow_up_1_delay_hours),
        follow_up_2 = COALESCE(${followUp2}, follow_up_2),
        follow_up_2_delay_hours = COALESCE(${followUp2DelayHours}, follow_up_2_delay_hours),
        follow_up_3 = COALESCE(${followUp3}, follow_up_3),
        follow_up_3_delay_hours = COALESCE(${followUp3DelayHours}, follow_up_3_delay_hours),
        tags = COALESCE(${tags}, tags),
        variables = COALESCE(${variables}, variables),
        is_favorite = COALESCE(${isFavorite}, is_favorite),
        updated_at = now()
      WHERE id = ${id} AND organization_id = ${organization.id}
      RETURNING *
    `;

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('PUT /api/templates/[id] error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * DELETE /api/templates/[id]
 *
 * Soft delete a user template.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [deleted] = await sql`
      UPDATE user_templates
      SET is_active = false, updated_at = now()
      WHERE id = ${id} AND organization_id = ${organization.id}
      RETURNING id
    `;

    if (!deleted) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('DELETE /api/templates/[id] error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
