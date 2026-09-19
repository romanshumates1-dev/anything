import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';

type ActivityType =
  | 'deal_closed'
  | 'contract_signed'
  | 'message_sent'
  | 'lead_added'
  | 'response_received'
  | 'hot_lead'
  | 'campaign_started'
  | 'alert';

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: string;
  metadata?: {
    amount?: number;
    campaignName?: string;
    propertyAddress?: string;
    leadId?: string;
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  try {
    const activities: ActivityItem[] = [];

    // Get closed deals
    const closedDeals = await sql`
      SELECT l.id, l.property_address, l.updated_at,
             COALESCE(l.deal_value, 0) as deal_value
      FROM leads l
      WHERE l.organization_id = ${org.id}
        AND l.stage = 'closed'
        AND l.updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY l.updated_at DESC
      LIMIT 5
    `;

    for (const deal of closedDeals) {
      activities.push({
        id: `deal-${deal.id}`,
        type: 'deal_closed',
        title: 'Deal closed',
        description: deal.property_address || 'Property',
        timestamp: deal.updated_at,
        metadata: {
          amount: deal.deal_value,
          propertyAddress: deal.property_address,
          leadId: deal.id,
        },
      });
    }

    // Get hot leads (interested responses)
    const hotLeads = await sql`
      SELECT l.id, l.first_name, l.last_name, l.property_address, i.received_at
      FROM inbound_messages i
      JOIN leads l ON l.id = i.lead_id
      WHERE l.organization_id = ${org.id}
        AND i.intent IN ('sell_now', 'interested', 'hot')
        AND i.received_at >= NOW() - INTERVAL '7 days'
      ORDER BY i.received_at DESC
      LIMIT 5
    `;

    for (const lead of hotLeads) {
      activities.push({
        id: `hot-${lead.id}`,
        type: 'hot_lead',
        title: 'Hot lead detected',
        description: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Lead',
        timestamp: lead.received_at,
        metadata: {
          propertyAddress: lead.property_address,
          leadId: lead.id,
        },
      });
    }

    // Get recent responses
    const responses = await sql`
      SELECT l.id, l.first_name, l.last_name, l.property_address, i.received_at
      FROM inbound_messages i
      JOIN leads l ON l.id = i.lead_id
      WHERE l.organization_id = ${org.id}
        AND i.received_at >= NOW() - INTERVAL '7 days'
        AND i.intent NOT IN ('sell_now', 'interested', 'hot')
      ORDER BY i.received_at DESC
      LIMIT 5
    `;

    for (const resp of responses) {
      activities.push({
        id: `resp-${resp.id}`,
        type: 'response_received',
        title: 'New response',
        description: `${resp.first_name || ''} ${resp.last_name || ''}`.trim() || 'Lead',
        timestamp: resp.received_at,
        metadata: {
          propertyAddress: resp.property_address,
          leadId: resp.id,
        },
      });
    }

    // Get campaign launches
    const campaigns = await sql`
      SELECT c.id, c.name, c.member_count, c.created_at
      FROM campaigns c
      WHERE c.organization_id = ${org.id}
        AND c.status IN ('active', 'running')
        AND c.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY c.created_at DESC
      LIMIT 5
    `;

    for (const campaign of campaigns) {
      activities.push({
        id: `camp-${campaign.id}`,
        type: 'campaign_started',
        title: 'Campaign launched',
        description: `${campaign.name} - ${campaign.member_count || 0} leads`,
        timestamp: campaign.created_at,
        metadata: {
          campaignName: campaign.name,
        },
      });
    }

    // Get bulk outreach activity
    const outreachBatches = await sql`
      SELECT c.name, COUNT(*) as count, MAX(o.sent_at) as latest
      FROM outreach_log o
      JOIN campaigns c ON c.id = o.campaign_id
      JOIN leads l ON l.id = o.lead_id
      WHERE l.organization_id = ${org.id}
        AND o.sent_at >= NOW() - INTERVAL '1 day'
      GROUP BY c.id, c.name
      HAVING COUNT(*) >= 10
      ORDER BY latest DESC
      LIMIT 5
    `;

    for (const batch of outreachBatches) {
      activities.push({
        id: `outreach-${batch.name}-${batch.latest}`,
        type: 'message_sent',
        title: `${batch.count} messages sent`,
        description: batch.name,
        timestamp: batch.latest,
        metadata: {
          campaignName: batch.name,
        },
      });
    }

    // Get newly added leads
    const newLeads = await sql`
      SELECT COUNT(*) as count, MIN(id) as sample_id, MAX(created_at) as latest
      FROM leads
      WHERE organization_id = ${org.id}
        AND created_at >= NOW() - INTERVAL '1 day'
      GROUP BY DATE_TRUNC('hour', created_at)
      HAVING COUNT(*) >= 5
      ORDER BY latest DESC
      LIMIT 3
    `;

    for (const batch of newLeads) {
      activities.push({
        id: `leads-${batch.latest}`,
        type: 'lead_added',
        title: `${batch.count} new leads imported`,
        description: 'From data source',
        timestamp: batch.latest,
      });
    }

    // Sort all activities by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return Response.json({
      activities: activities.slice(0, limit),
    });
  } catch (error: any) {
    console.error('GET /api/dashboard/activity error', error);
    // Return empty array on error
    return Response.json({ activities: [] });
  }
}
