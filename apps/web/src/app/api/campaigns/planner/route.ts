import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { computeCapacityPlan, DEFAULT_RATES, type PlanInputs } from '@/app/api/utils/capacityPlanner';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/campaigns/planner — capacity plan + 10–30/mo gap model.
 *
 * Query params (all optional):
 *   budget       — budget in dollars (default 500)
 *   conversion   — conversion rate 0–1 (default 0.0007, BENCHMARK)
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const url = new URL(request.url);
    const budgetDollars = Math.max(1, Number(url.searchParams.get('budget')) || 500);
    const conversionRate = Math.min(0.1, Math.max(0.0001, Number(url.searchParams.get('conversion')) || 0.0007));

    // Count active jurisdictions from the lead_sources registry
    const [jCount] = await sql`
      SELECT COUNT(DISTINCT state) as cnt FROM lead_sources
      WHERE organization_id IS NULL OR organization_id = ${organization.id}
    `.catch(() => [{ cnt: 1 }]);
    const jurisdictionCount = Number((jCount as any)?.cnt ?? 1);

    // Count active JV relationships
    const [jvCount] = await sql`
      SELECT COUNT(*) as cnt FROM jv_deals
      WHERE organization_id = ${organization.id} AND status = 'active'
    `.catch(() => [{ cnt: 0 }]);
    const jvRelationshipCount = Number((jvCount as any)?.cnt ?? 0);

    // Buyer coverage: fraction of unique lead zips with ≥1 verified buyer
    const [coverageRow] = await sql`
      SELECT
        COUNT(DISTINCT l.zip) FILTER (WHERE b.id IS NOT NULL) AS covered,
        GREATEST(COUNT(DISTINCT l.zip), 1) AS total
      FROM leads l
      LEFT JOIN buyers b ON b.organization_id = ${organization.id}
        AND l.zip = ANY(b.zip_codes) AND b.verified = true
      WHERE l.organization_id = ${organization.id}
        AND l.zip IS NOT NULL
    `.catch(() => [{ covered: 0, total: 1 }]);
    const covered = Number((coverageRow as any)?.covered ?? 0);
    const total = Number((coverageRow as any)?.total ?? 1);
    const buyerCoverageScore = covered / total;

    const inputs: PlanInputs = {
      budgetCents: budgetDollars * 100,
      rates: DEFAULT_RATES,
      conversionRate,
      jurisdictionCount,
      jvRelationshipCount,
      buyerCoverageScore,
    };

    const plan = computeCapacityPlan(inputs);

    return Response.json({
      inputs: {
        budgetDollars,
        conversionRate,
        conversionRateLabel: 'BENCHMARK (unverified for this account)',
        jurisdictionCount,
        jvRelationshipCount,
        buyerCoverageScore: Math.round(buyerCoverageScore * 100) + '%',
      },
      ...plan,
    });
  } catch (error: any) {
    console.error('GET /api/campaigns/planner error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
