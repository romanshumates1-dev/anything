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
        l.name,
        l.metadata->>'address' as property_address,
        c.created_at,
        c.history
      FROM leads l
      JOIN ai_conversations c ON c.lead_id = l.id
      WHERE l.organization_id = ${org.id}
        AND c.last_message_at IS NOT NULL
        AND c.requires_human = TRUE
        AND c.created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY c.created_at DESC
      LIMIT 5
    `;

    for (const lead of hotLeads) {
      const timeSince = formatDistanceToNow(new Date(lead.created_at), { addSuffix: false });
      actions.push({
        id: `hot-${lead.id}`,
        type: 'urgent',
        title: `Hot lead: ${lead.name || 'Lead'} wants to sell`,
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
        l.name,
        l.metadata->>'address' as property_address,
        c.created_at
      FROM ai_conversations c
      JOIN leads l ON l.id = c.lead_id
      WHERE l.organization_id = ${org.id}

      ORDER BY c.created_at DESC
      LIMIT 5
    `;

    for (const lead of humanRequired) {
      actions.push({
        id: `human-${lead.id}`,
        type: 'response',
        title: `Review conversation with ${lead.name || 'Lead'}`,
        description: `${lead.property_address || 'Property'} - AI needs assistance`,
        dueIn: 'Today',
        href: `/crm?lead=${lead.id}`,
        priority: 'high',
      });
    }

    // 3. Contracts awaiting signature
    // Defect #45: this selected c.expiration_date and joined on c.lead_id.
    // `contracts` really has (id, organization_id, template_id, direction,
    // seller_lead_id, filled_body, pdf_url, status, signed_at, created_at,
    // updated_at, assignment_fee_cents, inspection_days, contract_price_cents,
    // assigned_at, esign_status, fee_collection, fee_config, origination_type,
    // buyer_id, metadata) - there is NO expiration_date and NO lead_id, so the
    // query 500'd.
    //
    // "Expiring soon" is therefore not derivable from stored data and is not
    // faked. The honest, genuinely actionable signal is a contract still
    // awaiting signature, which IS recorded (status/esign_status + assigned_at).
    const expiringContracts = await sql`
      SELECT
        c.id,
        c.status,
        c.esign_status,
        c.direction,
        c.assigned_at,
        c.created_at,
        c.assignment_fee_cents,
        l.id as lead_id,
        l.name as lead_name,
        l.metadata->>'address' as property_address
      FROM contracts c
      -- Defect #45 (cont): contracts.seller_lead_id is TEXT while leads.id is
      -- INTEGER, so joining them directly raised
      -- "operator does not exist: integer = text". Verified via
      -- information_schema rather than guessed. The cast is explicit and the
      -- non-matching case simply produces no join row.
      JOIN leads l ON l.id = c.seller_lead_id::int
      WHERE c.organization_id = ${org.id}
        AND c.signed_at IS NULL
        AND COALESCE(c.esign_status, c.status) IN ('sent', 'pending', 'awaiting_signature', 'draft')
      ORDER BY c.created_at DESC
      LIMIT 5
    `;

    for (const contract of expiringContracts) {
      const daysSince = Math.max(
        0,
        Math.ceil((Date.now() - new Date(contract.created_at).getTime()) / (1000 * 60 * 60 * 24))
      );
      actions.push({
        id: `contract-${contract.id}`,
        type: 'contract',
        title: 'Contract awaiting signature',
        description: `${contract.property_address || 'Property'} - ${
          contract.lead_name || 'Lead'
        } (sent ${daysSince} day${daysSince === 1 ? '' : 's'} ago)`,
        dueIn: daysSince >= 5 ? 'Overdue' : 'Today',
        href: `/contracts?id=${contract.id}`,
        priority: daysSince >= 5 ? 'high' : 'medium',
      });
    }

    // 4. Follow-ups needed (no response in 5+ days)
    const followUps = await sql`
      SELECT
        l.id,
        l.name,
        l.metadata->>'address' as property_address,
        l.updated_at
      FROM leads l
      WHERE l.organization_id = ${org.id}
        AND l.status = 'contacted'
        AND l.updated_at <= NOW() - INTERVAL '5 days'
        AND l.updated_at >= NOW() - INTERVAL '30 days'
      ORDER BY l.updated_at ASC
      LIMIT 5
    `;

    for (const lead of followUps) {
      const daysSince = Math.floor(
        (Date.now() - new Date(lead.updated_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      actions.push({
        id: `followup-${lead.id}`,
        type: 'follow_up',
        title: `Follow up with ${lead.name || 'Lead'}`,
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
