import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/templates/library
 *
 * Get pre-made templates from the template library.
 * Public endpoint (no org required) but still requires auth.
 */
export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const channel = searchParams.get('channel');
  const featuredOnly = searchParams.get('featured') === 'true';
  const search = searchParams.get('search');

  try {
    const templates = await sql`
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
        sort_order
      FROM template_library
      WHERE is_active = true
        ${category ? sql`AND category = ${category}` : sql``}
        ${channel ? sql`AND channel = ${channel}` : sql``}
        ${featuredOnly ? sql`AND is_featured = true` : sql``}
        ${search ? sql`AND (
          name ILIKE ${'%' + search + '%'}
          OR description ILIKE ${'%' + search + '%'}
          OR body ILIKE ${'%' + search + '%'}
          OR ${search} = ANY(tags)
        )` : sql``}
      ORDER BY is_featured DESC, sort_order ASC, use_count DESC
      LIMIT 50
    `;

    // Group by category for easier UI rendering
    const byCategory: Record<string, typeof templates> = {};
    for (const template of templates) {
      const cat = template.category as string;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(template);
    }

    return NextResponse.json({
      templates,
      byCategory,
      total: templates.length,
    });
  } catch (error: any) {
    console.error('GET /api/templates/library error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
