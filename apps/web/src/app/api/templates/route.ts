import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';

/**
 * GET /api/templates
 *
 * List user's saved templates and optionally library templates.
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const includeLibrary = searchParams.get('includeLibrary') === 'true';
  const category = searchParams.get('category');
  const channel = searchParams.get('channel');
  const favoritesOnly = searchParams.get('favorites') === 'true';

  try {
    // Build query for user templates
    let userTemplates = await sql`
      SELECT
        id,
        name,
        description,
        category,
        channel,
        subject,
        body,
        follow_up_1,
        follow_up_1_delay_hours,
        follow_up_2,
        follow_up_2_delay_hours,
        follow_up_3,
        follow_up_3_delay_hours,
        variables,
        tags,
        use_count,
        source_type,
        is_favorite,
        created_at,
        updated_at,
        'user' as source
      FROM user_templates
      WHERE organization_id = ${organization.id}
        AND is_active = true
        ${category ? sql`AND category = ${category}` : sql``}
        ${channel ? sql`AND channel = ${channel}` : sql``}
        ${favoritesOnly ? sql`AND is_favorite = true` : sql``}
      ORDER BY is_favorite DESC, use_count DESC, created_at DESC
    `;

    let libraryTemplates: any[] = [];
    if (includeLibrary) {
      libraryTemplates = await sql`
        SELECT
          id,
          name,
          description,
          category,
          channel,
          subject,
          body,
          follow_up_1,
          follow_up_1_delay_hours,
          follow_up_2,
          follow_up_2_delay_hours,
          follow_up_3,
          follow_up_3_delay_hours,
          variables,
          tags,
          use_count,
          avg_response_rate,
          is_featured,
          'library' as source
        FROM template_library
        WHERE is_active = true
          ${category ? sql`AND category = ${category}` : sql``}
          ${channel ? sql`AND channel = ${channel}` : sql``}
        ORDER BY is_featured DESC, sort_order ASC, use_count DESC
      `;
    }

    return NextResponse.json({
      userTemplates,
      libraryTemplates,
      total: userTemplates.length + libraryTemplates.length,
    });
  } catch (error: any) {
    console.error('GET /api/templates error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/templates
 *
 * Save a new user template.
 */
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
    const {
      name,
      description,
      category = 'custom',
      channel = 'sms',
      subject,
      templateBody,
      followUp1,
      followUp1DelayHours = 24,
      followUp2,
      followUp2DelayHours = 48,
      followUp3,
      followUp3DelayHours = 72,
      variables = [],
      tags = [],
      sourceType,
      sourceId,
      isFavorite = false,
    } = body as {
      name: string;
      description?: string;
      category?: string;
      channel?: string;
      subject?: string;
      templateBody: string;
      followUp1?: string;
      followUp1DelayHours?: number;
      followUp2?: string;
      followUp2DelayHours?: number;
      followUp3?: string;
      followUp3DelayHours?: number;
      variables?: string[];
      tags?: string[];
      sourceType?: string;
      sourceId?: string;
      isFavorite?: boolean;
    };

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    }
    if (!templateBody || typeof templateBody !== 'string' || templateBody.trim().length < 10) {
      return NextResponse.json({ error: 'Template body must be at least 10 characters' }, { status: 400 });
    }

    const templateId = crypto.randomUUID();

    // Extract variables from the template content
    const variablePattern = /\{\{[a-zA-Z]+\}\}/g;
    const allText = [templateBody, subject || '', followUp1 || '', followUp2 || '', followUp3 || ''].join(' ');
    const extractedVariables = [...new Set(allText.match(variablePattern) || [])];
    const finalVariables = extractedVariables.length > 0 ? extractedVariables : variables;

    const [template] = await sql`
      INSERT INTO user_templates (
        id, organization_id, created_by, name, description, category, channel,
        subject, body, follow_up_1, follow_up_1_delay_hours, follow_up_2, follow_up_2_delay_hours,
        follow_up_3, follow_up_3_delay_hours, variables, tags, source_type, source_id, is_favorite
      ) VALUES (
        ${templateId},
        ${organization.id},
        ${session.user.id},
        ${name.trim()},
        ${description || null},
        ${category},
        ${channel},
        ${subject || null},
        ${templateBody.trim()},
        ${followUp1 || null},
        ${followUp1DelayHours},
        ${followUp2 || null},
        ${followUp2DelayHours},
        ${followUp3 || null},
        ${followUp3DelayHours},
        ${finalVariables},
        ${tags},
        ${sourceType || 'manual'},
        ${sourceId || null},
        ${isFavorite}
      )
      RETURNING *
    `;

    // If this was generated by AI, mark the generation as used
    if (sourceType === 'ai_generated' && sourceId) {
      await sql`
        UPDATE ai_template_generations
        SET was_used = true
        WHERE id = ${sourceId} AND organization_id = ${organization.id}
      `;
    }

    return NextResponse.json(template);
  } catch (error: any) {
    console.error('POST /api/templates error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
