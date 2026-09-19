/**
 * Dashboard Next Actions API - GET prioritized action items
 *
 * Returns time-sensitive actions sorted by priority to help
 * wholesalers focus on the most important next steps.
 */
import { NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import { formatDistanceToNow } from 'date-fns';

interface NextAction {
  id: string;
  type: 'call' | 'contract' | 'follow_up' | 'response' | 'urgent';
  title: string;
  description: string;
  dueIn?: string;
  href: string;
  priority: 'high' | 'medium' | 'low';
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
    const actions: NextAction[] = [];

    // SECURITY: All queries scoped to organization

    // 1. Hot leads that need immediate attention (responded recently with interest)
    const hotLeads = await sql`
      SELECT
        l.id,
        l.first_name,
        l.last_name,
        l.property_address,
        c.created_at,
        c.content
      FROM leads l
      JOIN ai_conversations c ON c.lead_id = l.id
      WHERE l.organization_id = ${org.id}
        AND c.message_type = 'inbound'
        AND c.classification IN ('INTERESTED', 'HOT_LEAD', 'URGENT')
        AND c.created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY c.created_at DESC
      LIMIT 5
    `;

    for (const lead of hotLeads) {
      const timeSince = formatDistanceToNow(new Date(lead.created_at), { addSuffix: false });
      actions.push({
        id: `hot-${lead.id}`,
        type: 'urgent',
        title: `Hot lead: ${lead.first_name || 'Lead'} wants to sell`,
        description: `${lead.property_address || 'Property'} - Responded ${timeSince} ago`,
        dueIn: 'Now',
        href: `/crm?lead=${lead.id}`,
        priority: 'high',
      });
    }

    // 2. Leads requiring human escalation
    const humanRequired = await sql`
      SELECT
        l.id,
        l.first_name,
        l.last_name,
        l.property_address,
        c.created_at
      FROM ai_conversations c
      JOIN leads l ON l.id = c.lead_id
      WHERE l.organization_id = ${org.id}
        AND c.requires_human = TRUE
        AND c.human_reviewed = FALSE
      ORDER BY c.created_at DESC
      LIMIT 5
    `;

    for (const lead of humanRequired) {
      actions.push({
        id: `human-${lead.id}`,
        type: 'response',
        title: `Review conversation with ${lead.first_name || 'Lead'}`,
        description: `${lead.property_address || 'Property'} - AI needs assistance`,
        dueIn: 'Today',
        href: `/crm?lead=${lead.id}`,
        priority: 'high',
      });
    }

    // 3. Contracts expiring soon
    const expiringContracts = await sql`
      SELECT
        c.id,
        c.expiration_date,
        l.id as lead_id,
        l.first_name,
        l.last_name,
        l.property_address
      FROM contracts c
      JOIN leads l ON l.id = c.lead_id
      WHERE l.organization_id = ${org.id}
        AND c.status = 'sent'
        AND c.expiration_date <= NOW() + INTERVAL '7 days'
        AND c.expiration_date >= NOW()
      ORDER BY c.expiration_date ASC
      LIMIT 5
    `;

    for (const contract of expiringContracts) {
      const daysUntil = Math.ceil(
        (new Date(contract.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      actions.push({
        id: `contract-${contract.id}`,
        type: 'contract',
        title: `Contract expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`,
        description: `${contract.property_address || 'Property'} - ${contract.first_name || 'Lead'}`,
        dueIn: daysUntil <= 1 ? 'Tomorrow' : `In ${daysUntil} days`,
        href: `/contracts?id=${contract.id}`,
        priority: daysUntil <= 2 ? 'high' : 'medium',
      });
    }

    // 4. Follow-ups needed (no response in 5+ days)
    const followUps = await sql`
      SELECT
        l.id,
        l.first_name,
        l.last_name,
        l.property_address,
        l.last_contacted_at
      FROM leads l
      WHERE l.organization_id = ${org.id}
        AND l.status = 'contacted'
        AND l.last_contacted_at <= NOW() - INTERVAL '5 days'
        AND l.last_contacted_at >= NOW() - INTERVAL '30 days'
      ORDER BY l.last_contacted_at ASC
      LIMIT 5
    `;

    for (const lead of followUps) {
      const daysSince = Math.floor(
        (Date.now() - new Date(lead.last_contacted_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      actions.push({
        id: `followup-${lead.id}`,
        type: 'follow_up',
        title: `Follow up with ${lead.first_name || 'Lead'}`,
        description: `${lead.property_address || 'Property'} - No response in ${daysSince} days`,
        dueIn: 'This week',
        href: `/crm?lead=${lead.id}`,
        priority: 'low',
      });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return NextResponse.json({ actions: actions.slice(0, 10) });
  } catch (error: any) {
    console.error('GET /api/dashboard/next-actions error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
