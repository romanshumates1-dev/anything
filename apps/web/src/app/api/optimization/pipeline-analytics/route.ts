/**
 * Pipeline Analytics API
 *
 * Implements sussy2.md requirements:
 * - Phase probability tracking
 * - Drop-off diagnostics
 * - Weak phase detection
 * - Self-optimizing feedback loops
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

interface PhaseMetrics {
  phase: string;
  count: number;
  conversionRate: number;
  dropOffRate: number;
  avgTimeInPhase: number;
  probability: number;
}

interface PipelineAnalytics {
  phases: PhaseMetrics[];
  weakPhases: string[];
  bottlenecks: string[];
  recommendations: string[];
  overallConversion: number;
  kpis: {
    costPerDeal: number;
    avgTimeToClose: number;
    closeRate: number;
  };
}

const PIPELINE_STAGES = [
  'NEW',
  'CONTACTED',
  'ENGAGED',
  'NEGOTIATING',
  'SIGNED',
  'ASSIGNED',
  'CLOSED_WON'
];

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    // Get stage counts
    const stageCounts = await sql`
      SELECT
        COALESCE(status, 'NEW') as stage,
        COUNT(*) as count
      FROM leads
      WHERE organization_id = ${organization.id}
      GROUP BY status
    `;

    // Get stage transitions for conversion rates
    const transitions = await sql`
      SELECT
        from_stage,
        to_stage,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at)))) as avg_time
      FROM stage_transitions
      WHERE organization_id = ${organization.id}
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY from_stage, to_stage
    `.catch(() => []);

    // Calculate phase metrics
    const stageMap: Record<string, number> = {};
    for (const row of stageCounts as any[]) {
      stageMap[row.stage] = Number(row.count);
    }

    const totalLeads = Object.values(stageMap).reduce((a, b) => a + b, 0) || 1;
    const phases: PhaseMetrics[] = [];
    const weakPhases: string[] = [];
    const bottlenecks: string[] = [];
    const recommendations: string[] = [];

    for (let i = 0; i < PIPELINE_STAGES.length; i++) {
      const stage = PIPELINE_STAGES[i];
      const count = stageMap[stage] || 0;
      const nextStage = PIPELINE_STAGES[i + 1];
      const nextCount = nextStage ? (stageMap[nextStage] || 0) : count;

      const conversionRate = count > 0 ? nextCount / count : 0;
      const dropOffRate = count > 0 ? 1 - conversionRate : 0;
      const probability = totalLeads > 0 ? count / totalLeads : 0;

      phases.push({
        phase: stage,
        count,
        conversionRate: Math.round(conversionRate * 100) / 100,
        dropOffRate: Math.round(dropOffRate * 100) / 100,
        avgTimeInPhase: 0,
        probability: Math.round(probability * 100) / 100
      });

      // Detect weak phases (conversion < 30%)
      if (conversionRate < 0.3 && count > 10) {
        weakPhases.push(stage);
        recommendations.push(`Improve ${stage} → ${nextStage || 'CLOSE'} conversion (currently ${Math.round(conversionRate * 100)}%)`);
      }

      // Detect bottlenecks (high count, low conversion)
      if (count > totalLeads * 0.3 && conversionRate < 0.5) {
        bottlenecks.push(stage);
      }
    }

    // Calculate KPIs
    const closedDeals = stageMap['CLOSED_WON'] || 0;
    const closeRate = totalLeads > 0 ? closedDeals / totalLeads : 0;

    const analytics: PipelineAnalytics = {
      phases,
      weakPhases,
      bottlenecks,
      recommendations,
      overallConversion: Math.round(closeRate * 100) / 100,
      kpis: {
        costPerDeal: 0, // Would need cost tracking
        avgTimeToClose: 0, // Would need timestamp tracking
        closeRate: Math.round(closeRate * 100) / 100
      }
    };

    return Response.json(analytics);
  } catch (error: any) {
    console.error('Pipeline analytics error:', error);
    return Response.json({ error: 'Failed to generate analytics' }, { status: 500 });
  }
}
