/**
 * Lead Outreach Tracking API
 *
 * POST /api/lead-finder/public-pool/outreach - Mark lead(s) as outreached
 *
 * When a user contacts a lead, this endpoint:
 * 1. Records the outreach globally (visible to all users as "contacted")
 * 2. Prevents users from seeing this lead as "fresh"
 * 3. Helps prevent multiple users from contacting the same lead
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { leadIds, channel, campaignId } = body;

    if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds array required' }, { status: 400 });
    }

    if (!channel || !['sms', 'email', 'call', 'mail'].includes(channel)) {
      return NextResponse.json({ error: 'Valid channel required (sms, email, call, mail)' }, { status: 400 });
    }

    // Get user's organization if any
    const orgRows = await sql`
      SELECT organization_id FROM organization_members
      WHERE user_id = ${session.userId}
      LIMIT 1
    `;
    const organizationId = orgRows[0]?.organization_id || null;

    let recorded = 0;
    let alreadyRecorded = 0;
    const errors: string[] = [];

    for (const leadId of leadIds) {
      try {
        // Use the record_lead_outreach function
        const result = await sql`
          INSERT INTO public.lead_outreach_log (
            public_lead_id, user_id, organization_id, channel, campaign_id
          ) VALUES (
            ${leadId}, ${session.userId}, ${organizationId}, ${channel}, ${campaignId || null}
          )
          ON CONFLICT (public_lead_id, user_id) DO NOTHING
          RETURNING id
        `;

        if (result.length > 0) {
          recorded++;
        } else {
          alreadyRecorded++;
        }
      } catch (err: any) {
        if (err.message?.includes('violates foreign key')) {
          errors.push(`Lead ${leadId} not found`);
        } else {
          errors.push(`Lead ${leadId}: ${err.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      recorded,
      alreadyRecorded,
      total: leadIds.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[OUTREACH] Error recording outreach:', error);
    return NextResponse.json({ error: 'Failed to record outreach' }, { status: 500 });
  }
}

// GET - Check outreach status for specific leads
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const leadIdsParam = url.searchParams.get('leadIds');

  if (!leadIdsParam) {
    return NextResponse.json({ error: 'leadIds parameter required' }, { status: 400 });
  }

  const leadIds = leadIdsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

  if (leadIds.length === 0) {
    return NextResponse.json({ error: 'No valid lead IDs provided' }, { status: 400 });
  }

  try {
    const results = await sql`
      SELECT
        p.id as lead_id,
        COALESCE(o.total_outreach, 0) as total_outreach_count,
        COALESCE(o.unique_users, 0) as unique_users_contacted,
        o.first_outreach_at,
        o.last_outreach_at,
        EXISTS (
          SELECT 1 FROM lead_outreach_log
          WHERE public_lead_id = p.id AND user_id = ${session.userId}
        ) as user_has_outreached,
        (
          SELECT outreached_at FROM lead_outreach_log
          WHERE public_lead_id = p.id AND user_id = ${session.userId}
          LIMIT 1
        ) as user_outreach_at
      FROM public.public_lead_pool p
      LEFT JOIN (
        SELECT
          public_lead_id,
          COUNT(*) as total_outreach,
          COUNT(DISTINCT user_id) as unique_users,
          MIN(outreached_at) as first_outreach_at,
          MAX(outreached_at) as last_outreach_at
        FROM lead_outreach_log
        GROUP BY public_lead_id
      ) o ON o.public_lead_id = p.id
      WHERE p.id = ANY(${leadIds})
    `;

    return NextResponse.json({
      leads: results.map((r: any) => ({
        leadId: r.lead_id,
        totalOutreachCount: parseInt(r.total_outreach_count),
        uniqueUsersContacted: parseInt(r.unique_users_contacted),
        firstOutreachAt: r.first_outreach_at,
        lastOutreachAt: r.last_outreach_at,
        userHasOutreached: r.user_has_outreached,
        userOutreachAt: r.user_outreach_at,
      })),
    });
  } catch (error) {
    console.error('[OUTREACH] Error checking status:', error);
    return NextResponse.json({ error: 'Failed to check outreach status' }, { status: 500 });
  }
}
