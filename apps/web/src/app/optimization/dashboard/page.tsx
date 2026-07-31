import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { KPIBar } from './components/KPIBar';
import { DealTable } from './components/DealTable';
import { ActionQueue } from './components/ActionQueue';

async function getDashboardData(organizationId: string) {
  // Total leads
  const [totalLeadsRow] = await sql`
    SELECT COUNT(*) as count
    FROM leads
    WHERE organization_id = ${organizationId}
  `;

  // Active deals (have scores)
  const [activeDealsRow] = await sql`
    SELECT COUNT(*) as count
    FROM lead_scores ls
    JOIN leads l ON l.id = ls.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Sum of expected values
  const [evRow] = await sql`
    SELECT COALESCE(SUM(dp.expected_value), 0) as total_ev
    FROM deal_probabilities dp
    JOIN leads l ON l.id = dp.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Average probability
  const [avgProbRow] = await sql`
    SELECT COALESCE(AVG(dp.p_close), 0) as avg_prob
    FROM deal_probabilities dp
    JOIN leads l ON l.id = dp.lead_id
    WHERE l.organization_id = ${organizationId}
  `;

  // Deals for table (top 20 by EV)
  const deals = await sql`
    SELECT
      l.id,
      l.name,
      l.metadata->>'address' as address,
      l.status,
      ls.composite_score as score,
      pv.arv,
      pv.offer_max,
      dp.p_close,
      dp.expected_value
    FROM leads l
    JOIN lead_scores ls ON ls.lead_id = l.id
    JOIN property_valuations pv ON pv.lead_id = l.id
    JOIN deal_probabilities dp ON dp.lead_id = l.id
    WHERE l.organization_id = ${organizationId}
    ORDER BY dp.expected_value DESC
    LIMIT 20
  `;

  // Actions for queue (top 10 by priority)
  const actions = await sql`
    SELECT
      la.id,
      la.lead_id,
      la.action,
      la.priority,
      la.reason,
      la.created_at,
      l.name as lead_name,
      l.metadata->>'address' as address
    FROM lead_actions la
    JOIN leads l ON l.id = la.lead_id
    WHERE l.organization_id = ${organizationId}
      AND la.status = 'pending'
    ORDER BY la.priority DESC
    LIMIT 10
  `;

  return {
    totalLeads: Number(totalLeadsRow.count),
    activeDeals: Number(activeDealsRow.count),
    expectedValue: Number(evRow.total_ev),
    avgProbability: Number(avgProbRow.avg_prob),
    deals: deals.map(d => ({
      id: d.id,
      name: d.name,
      address: d.address || 'No address',
      score: Number(d.score),
      arv: d.arv,
      offerMax: d.offer_max,
      pClose: Number(d.p_close),
      expectedValue: d.expected_value,
      status: d.status
    })),
    actions: actions.map(a => ({
      id: a.id,
      leadId: a.lead_id,
      leadName: a.lead_name,
      address: a.address || 'No address',
      action: a.action,
      priority: Number(a.priority),
      reason: a.reason,
      createdAt: a.created_at
    }))
  };
}

export default async function OptimizationDashboard() {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return <div>Unauthorized</div>;
  }

  const organization = await getOrganization();
  if (!organization) {
    return <div>No organization found</div>;
  }

  const data = await getDashboardData(organization.id);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Deal Command Center</h1>

      <KPIBar
        totalLeads={data.totalLeads}
        activeDeals={data.activeDeals}
        expectedValue={data.expectedValue}
        avgProbability={data.avgProbability}
      />

      <div className="grid grid-cols-2 gap-6 mb-6">
        <DealTable deals={data.deals} />
        <ActionQueue actions={data.actions} />
      </div>
    </div>
  );
}
