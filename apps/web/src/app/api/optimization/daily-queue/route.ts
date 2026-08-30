import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * GET /api/optimization/daily-queue
 *
 * Returns the top 20 highest expected-value deals that need action TODAY.
 *
 * This is your daily execution list - focus only on these high-conviction opportunities.
 * Sorted by EV (descending) and time waiting (oldest first for ties).
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const topDeals = await sql`
      SELECT
        l.id as lead_id,
        l.name,
        l.phone,
        l.email,
        l.metadata->>'address' as address,
        l.metadata->>'zip' as zip,
        l.metadata->>'signals' as distress_signals,
        ls.composite_score,
        ls.distress_score,
        ls.equity_score,
        pv.arv,
        pv.arv_confidence,
        pv.repairs,
        pv.offer_min,
        pv.offer_max,
        pv.comps_count,
        dp.p_close,
        dp.expected_value,
        la.action,
        la.status,
        la.reason,
        la.created_at as action_queued_at,
        EXTRACT(EPOCH FROM (now() - la.created_at)) / 3600 as hours_waiting
      FROM leads l
      JOIN lead_scores ls ON ls.lead_id = l.id
      JOIN property_valuations pv ON pv.lead_id = l.id
      JOIN deal_probabilities dp ON dp.lead_id = l.id
      LEFT JOIN lead_actions la ON la.lead_id = l.id
        AND la.status = 'pending'
      WHERE l.organization_id = ${organization.id}
        AND la.action IS NOT NULL
        AND la.action != 'reject'
      ORDER BY
        dp.expected_value DESC,
        hours_waiting DESC
      LIMIT 20
    `;

    // Transform for display
    const deals = topDeals.map(d => ({
      leadId: d.lead_id,
      name: d.name,
      phone: d.phone,
      email: d.email,
      address: d.address,
      zip: d.zip,
      distressSignals: d.distress_signals ? JSON.parse(d.distress_signals) : [],

      // Scoring
      compositeScore: Number(d.composite_score),
      distressScore: Number(d.distress_score),
      equityScore: Number(d.equity_score),

      // Valuation (convert cents to dollars)
      arvDollars: Math.round(d.arv / 100),
      arvConfidence: Number(d.arv_confidence),
      repairsDollars: Math.round(d.repairs / 100),
      offerMinDollars: Math.round(d.offer_min / 100),
      offerMaxDollars: Math.round(d.offer_max / 100),
      compsCount: d.comps_count,

      // Probability & EV
      pClose: Number(d.p_close),
      expectedValueDollars: Math.round(d.expected_value / 100),

      // Action metadata
      recommendedAction: d.action,
      actionReason: d.reason?.reasoning || '',
      queuedAt: d.action_queued_at,
      hoursWaiting: Math.round(Number(d.hours_waiting) * 10) / 10,

      // Computed urgency
      urgencyLevel: getUrgencyLevel(
        Number(d.expected_value),
        Number(d.hours_waiting),
        d.distress_signals ? JSON.parse(d.distress_signals) : []
      )
    }));

    // Calculate summary stats
    const totalEV = deals.reduce((sum, d) => sum + d.expectedValueDollars, 0);
    const avgPClose = deals.reduce((sum, d) => sum + d.pClose, 0) / deals.length;
    const highUrgency = deals.filter(d => d.urgencyLevel === 'high').length;

    return NextResponse.json({
      deals,
      summary: {
        totalDeals: deals.length,
        totalExpectedValue: totalEV,
        averagePClose: Math.round(avgPClose * 1000) / 1000,
        highUrgencyCount: highUrgency,
        generatedAt: new Date().toISOString()
      },
      actionGuidance: {
        immediateAction: deals.slice(0, 5).map(d => ({
          leadId: d.leadId,
          name: d.name,
          action: `Call ${d.phone} - offer $${d.offerMaxDollars.toLocaleString()}`,
          reasoning: d.actionReason
        })),
        thisWeekTarget: Math.min(10, deals.length),
        estimatedWeeklyDeals: Math.round(
          deals.slice(0, 10).reduce((sum, d) => sum + d.pClose, 0)
        )
      }
    });

  } catch (error: any) {
    console.error('GET /api/optimization/daily-queue error', error);
    return NextResponse.json(
      { error: 'Failed to fetch daily queue' },
      { status: 500 }
    );
  }
}

/**
 * Determine urgency level based on EV, wait time, and distress signals
 */
function getUrgencyLevel(
  expectedValueCents: number,
  hoursWaiting: number,
  distressSignals: string[]
): 'high' | 'medium' | 'normal' {
  // High urgency: >$7k EV OR time-sensitive distress OR waiting >24h
  if (
    expectedValueCents > 700000 ||
    distressSignals.includes('pre_foreclosure') ||
    distressSignals.includes('tax_delinquent') ||
    hoursWaiting > 24
  ) {
    return 'high';
  }

  // Medium urgency: >$4k EV OR any distress OR waiting >12h
  if (
    expectedValueCents > 400000 ||
    distressSignals.length > 0 ||
    hoursWaiting > 12
  ) {
    return 'medium';
  }

  return 'normal';
}
