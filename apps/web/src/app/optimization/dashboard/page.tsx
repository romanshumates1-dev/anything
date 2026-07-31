import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { KPIBar } from './components/KPIBar';

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

  return {
    totalLeads: Number(totalLeadsRow.count),
    activeDeals: Number(activeDealsRow.count),
    expectedValue: Number(evRow.total_ev),
    avgProbability: Number(avgProbRow.avg_prob)
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

      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">
          Dashboard components (Deal Table, Action Queue, Deal Drawer) will be added in next tasks.
        </p>
      </div>
    </div>
  );
}
