import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { logFallback } from '@/app/api/utils/queryFallback';

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

/**
 * Dashboard activity feed (defect #46, rewritten 2026-09-29 against the REAL
 * schema verified via information_schema):
 *
 * The previous version was written against tables/columns that have never
 * existed in this database - `inbound_messages`, `outreach_log`,
 * `leads.property_address`, `leads.first_name/last_name`, `leads.deal_value`,
 * `leads.stage`, `campaigns.member_count` - so the FIRST query threw and one
 * outer `.catch` converted the whole endpoint into `{"activities": []}` with a
 * 200. The dashboard looked "empty but working" while every query failed.
 *
 * Real sources now used:
 *   - closed deals      -> leads.status='closed'; value/address from leads.metadata
 *   - hot leads         -> campaign_lead_queue.status='interested' (the queue
 *                          that actually tracks per-lead outreach state)
 *   - responses         -> message_events.direction='inbound' (the message ledger)
 *   - campaign launches -> campaigns + a campaign_lead_queue count
 *   - outreach batches  -> message_events.direction='outbound' grouped per day
 *   - new leads         -> leads.created_at (unchanged; was already valid)
 *
 * Every query carries its own logFallback: one broken source now degrades that
 * ONE list (visibly, in the log) instead of silently zeroing the whole feed,
 * and the outer catch returns 500 rather than a fake-empty 200.
 */
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

    // 1. Closed deals. Value and address live in leads.metadata (jsonb); the
    //    numeric guard mirrors dashboard/funnel's approach so a malformed
    //    propertyValue can never throw a cast error.
    const closedDeals = await sql`
      SELECT l.id,
             COALESCE(l.metadata->>'address', l.name) AS label,
             l.updated_at,
             CASE WHEN COALESCE(l.metadata->>'propertyValue', '') ~ '^[0-9.]+$'
                  THEN (l.metadata->>'propertyValue')::numeric
                  ELSE 0 END AS deal_value
      FROM leads l
      WHERE l.organization_id = ${org.id}
        AND l.status = 'closed'
        AND l.updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY l.updated_at DESC
      LIMIT 5
    `.catch(logFallback('dashboard-activity#closed-deals', []));

    for (const deal of closedDeals as any[]) {
      activities.push({
        id: `deal-${deal.id}`,
        type: 'deal_closed',
        title: 'Deal closed',
        description: deal.label || 'Property',
        timestamp: deal.updated_at,
        metadata: {
          amount: Number(deal.deal_value) || 0,
          propertyAddress: deal.label,
          leadId: String(deal.id),
        },
      });
    }

    // 2. Hot leads: leads the queue marked interested in the last 7 days.
    const hotLeads = await sql`
      SELECT clq.lead_id,
             l.name,
             COALESCE(l.metadata->>'address', l.city, l.name) AS label,
             clq.updated_at AS ts
      FROM campaign_lead_queue clq
      JOIN leads l ON l.id = clq.lead_id
      WHERE clq.organization_id = ${org.id}
        AND clq.status = 'interested'
        AND clq.updated_at >= NOW() - INTERVAL '7 days'
      ORDER BY clq.updated_at DESC
      LIMIT 5
    `.catch(logFallback('dashboard-activity#hot-leads', []));

    for (const lead of hotLeads as any[]) {
      activities.push({
        id: `hot-${lead.lead_id}`,
        type: 'hot_lead',
        title: 'Hot lead detected',
        description: lead.name || 'Lead',
        timestamp: lead.ts,
        metadata: {
          propertyAddress: lead.label,
          leadId: String(lead.lead_id),
        },
      });
    }

    // 3. Recent inbound responses from the message ledger. Contact details
    //    come from campaign_contacts (the reply is logged against the contact).
    const responses = await sql`
      SELECT me.id,
             me.created_at AS ts,
             COALESCE(cc.name, 'Lead') AS name,
             COALESCE(cc.property_address, cc.city, '') AS label,
             cc.seller_lead_id AS lead_id
      FROM message_events me
      LEFT JOIN campaign_contacts cc ON cc.id = me.contact_id
      WHERE me.organization_id = ${org.id}
        AND me.direction = 'inbound'
        AND me.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY me.created_at DESC
      LIMIT 5
    `.catch(logFallback('dashboard-activity#responses', []));

    for (const resp of responses as any[]) {
      activities.push({
        id: `resp-${resp.id}`,
        type: 'response_received',
        title: 'New response',
        description: resp.name || 'Lead',
        timestamp: resp.ts,
        metadata: {
          propertyAddress: resp.label || undefined,
          leadId: resp.lead_id ? String(resp.lead_id) : undefined,
        },
      });
    }

    // 4. Campaign launches (member_count via the queue, since campaigns has no
    //    such column).
    const campaigns = await sql`
      SELECT c.id, c.name, c.created_at,
             (SELECT COUNT(*) FROM campaign_lead_queue q
              WHERE q.campaign_id = c.id::text
                AND q.organization_id = ${org.id}) AS member_count
      FROM campaigns c
      WHERE c.organization_id = ${org.id}
        AND c.status IN ('active', 'running')
        AND c.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY c.created_at DESC
      LIMIT 5
    `.catch(logFallback('dashboard-activity#campaigns', []));

    for (const campaign of campaigns as any[]) {
      activities.push({
        id: `camp-${campaign.id}`,
        type: 'campaign_started',
        title: 'Campaign launched',
        description: `${campaign.name} - ${Number(campaign.member_count) || 0} leads`,
        timestamp: campaign.created_at,
        metadata: {
          campaignName: campaign.name,
        },
      });
    }

    // 5. High-volume outbound days from the message ledger. Grouped by the
    //    ledger's own campaign_id (org-bound) - no join to a table that may
    //    not carry the campaign.
    const outreachBatches = await sql`
      SELECT COALESCE(NULLIF(me.campaign_id, ''), 'Direct message') AS name,
             COUNT(*) AS count,
             MAX(me.created_at) AS latest
      FROM message_events me
      WHERE me.organization_id = ${org.id}
        AND me.direction = 'outbound'
        AND me.created_at >= NOW() - INTERVAL '1 day'
      GROUP BY 1
      HAVING COUNT(*) >= 10
      ORDER BY latest DESC
      LIMIT 5
    `.catch(logFallback('dashboard-activity#outreach-batches', []));

    for (const batch of outreachBatches as any[]) {
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

    // 6. Newly added leads (columns verified real).
    const newLeads = await sql`
      SELECT COUNT(*) as count, MIN(id) as sample_id, MAX(created_at) as latest
      FROM leads
      WHERE organization_id = ${org.id}
        AND created_at >= NOW() - INTERVAL '1 day'
      GROUP BY DATE_TRUNC('hour', created_at)
      HAVING COUNT(*) >= 5
      ORDER BY latest DESC
      LIMIT 3
    `.catch(logFallback('dashboard-activity#new-leads', []));

    for (const batch of newLeads as any[]) {
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
    // A failure that reaches here is NOT one of the per-source fallbacks
    // above; answering 200 with [] would be the defect #46 lie again.
    console.error('GET /api/dashboard/activity error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
