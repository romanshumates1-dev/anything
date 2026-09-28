import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import sql from '@/app/api/utils/sql';
import { buildWhere } from '@/app/api/utils/sqlFragments';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_CHANNELS,
  isTemplateCategory,
  isTemplateChannel,
} from '@/lib/templateEnums';

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

  // `category` / `channel` are Postgres ENUM columns, so an unrecognised value
  // produced `invalid input value for enum` -> 500. Verified live:
  // GET /api/templates/library?category=EMAIL returned 500 before this check.
  // Domains come from lib/templateEnums (derived from the live enums) so this
  // route and api/templates cannot drift apart.
  if (category && !isTemplateCategory(category)) {
    return NextResponse.json(
      { error: `Invalid category. Expected one of: ${TEMPLATE_CATEGORIES.join(', ')}` },
      { status: 400 }
    );
  }
  if (channel && !isTemplateChannel(channel)) {
    return NextResponse.json(
      { error: `Invalid channel. Expected one of: ${TEMPLATE_CHANNELS.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    // Defect #32, fourth wave: four nested-fragment sites, each a 500 whenever
    // the corresponding query parameter was present - i.e. every filtered view
    // of the template library. The library loads unfiltered (200), so the bug
    // only appeared once a user actually searched or filtered.
    const filters = buildWhere()
      .raw('is_active = true')
      .when(category, (w) => w.eq('category', category))
      .when(channel, (w) => w.eq('channel', channel))
      .when(featuredOnly, (w) => w.raw('is_featured = true'))
      .when(search, (w) =>
        w.expr(
          '(name ILIKE ? OR description ILIKE ? OR body ILIKE ? OR ? = ANY(tags))',
          `%${search}%`,
          `%${search}%`,
          `%${search}%`,
          search
        )
      )
      .build();

    const templates = await sql(
      `SELECT
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
      WHERE ${filters.text}
      ORDER BY is_featured DESC, sort_order ASC, use_count DESC
      LIMIT 50`,
      filters.params as never[]
    );

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
