/**
 * Dashboard Engagements API - GET recent responses and engagement
 *
 * Returns the latest lead responses grouped by engagement type
 * for the real-time activity feed.
 */
import { NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

interface Engagement {
  id: string;
  leadName: string;
  propertyAddress: string;
  type: 'response' | 'interested' | 'not_interested' | 'callback' | 'hot_lead';
  message?: string;
  timestamp: string;
  campaignName?: string;
}

export async function GET() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    // SECURITY: All queries scoped to organization
    // Get recent AI conversations with lead info
    const recentResponses = await sql`
      SELECT
        c.id,
        c.lead_id,
        c.message_type,
        c.content,
        c.classification,
        c.created_at,
        l.first_name,
        l.last_name,
        l.property_address,
        l.property_city,
        l.property_state,
        camp.name as campaign_name
      FROM ai_conversations c
      JOIN leads l ON l.id = c.lead_id
      LEFT JOIN campaign_leads cl ON cl.lead_id = l.id
      LEFT JOIN campaigns camp ON camp.id = cl.campaign_id
      WHERE l.organization_id = ${org.id}
        AND c.message_type = 'inbound'
        AND c.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY c.created_at DESC
      LIMIT 20
    `;

    // Map classification to engagement type
    const mapClassification = (classification: string | null): Engagement['type'] => {
      if (!classification) return 'response';
      const lower = classification.toLowerCase();
      if (lower.includes('hot') || lower.includes('urgent')) return 'hot_lead';
      if (lower.includes('interested') || lower.includes('yes')) return 'interested';
      if (lower.includes('callback') || lower.includes('call')) return 'callback';
      if (lower.includes('not') || lower.includes('no') || lower.includes('stop')) return 'not_interested';
      return 'response';
    };

    const engagements: Engagement[] = recentResponses.map((row) => ({
      id: row.id,
      leadName: [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unknown',
      propertyAddress: [row.property_address, row.property_city, row.property_state]
        .filter(Boolean)
        .join(', ') || 'Address unavailable',
      type: mapClassification(row.classification),
      message: row.content?.slice(0, 200),
      timestamp: row.created_at,
      campaignName: row.campaign_name,
    }));

    return NextResponse.json({ engagements });
  } catch (error: any) {
    console.error('GET /api/dashboard/engagements error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
