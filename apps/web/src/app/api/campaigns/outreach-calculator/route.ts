/**
 * Outreach-to-Assignment Calculator API
 *
 * Calculates realistic projections for:
 * - Contacts needed to close 1 deal
 * - Expected costs
 * - ROI projections
 * - Break-even analysis
 *
 * Based on statistical probability chains with Bayesian updating
 * from actual system performance data.
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// Industry benchmarks for motivated seller outreach
const BENCHMARKS = {
  // Response rates by lead source quality
  responseRates: {
    coldList: 0.005,          // 0.5% - purchased lists, random
    warmList: 0.015,          // 1.5% - aged leads, referrals
    motivatedSeller: 0.025,   // 2.5% - tax delinquent, pre-foreclosure
    highDistress: 0.04,       // 4.0% - probate, code violation, divorce
  },

  // Conversion rates through funnel
  funnelRates: {
    responseToInterested: 0.15,    // 15% of responses show interest
    interestedToAppointment: 0.35, // 35% set appointment
    appointmentToContract: 0.20,   // 20% sign contract
    contractToClose: 0.65,         // 65% close (fall-through rate ~35%)
  },

  // Multi-touch campaign multipliers
  touchMultipliers: {
    1: 1.0,
    2: 1.5,   // +50% cumulative response with 2nd touch
    3: 1.85,  // +85% with 3rd touch
    4: 2.1,   // +110% with 4th touch
    5: 2.3,   // +130% with 5th touch (diminishing returns)
  },

  // AI optimization boost
  aiOptimizationBoost: 1.3, // 30% improvement with AI message optimization

  // Cost per channel
  costs: {
    emailPer1000: 0.10,     // AWS SES
    smsPer1000: 6.45,       // AWS SNS
    rcsPer1000: 7.00,       // AWS RCS
    directMailPer1000: 450, // Printed mailers
  },

  // Deal economics
  dealEconomics: {
    avgAssignmentFee: 12500,      // Average wholesale fee
    minViableFee: 5000,           // Minimum profitable fee
    maxTypicalFee: 35000,         // High-end fee
    avgDealTimeline: 45,          // Days from contract to close
  },
};

interface CalculatorInput {
  leadSource?: 'coldList' | 'warmList' | 'motivatedSeller' | 'highDistress';
  touchCount?: number;
  useAiOptimization?: boolean;
  targetDeals?: number;
  channels?: ('email' | 'sms' | 'rcs' | 'directMail')[];
  avgDealValue?: number;
}

export async function GET(req: NextRequest) {
  const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

  // Get actual system metrics if available
  let systemMetrics = null;
  if (sql) {
    try {
      const [metrics] = await sql`
        SELECT
          (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'sent') as total_contacted,
          (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'replied') as total_replied,
          (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'interested') as total_interested,
          (SELECT COUNT(*)::int FROM contracts WHERE esign_status = 'signed') as contracts_signed,
          (SELECT COUNT(*)::int FROM buyer_assignments WHERE status = 'SIGNED') as assignments_closed,
          (SELECT COALESCE(AVG(assignment_fee_cents), 1250000)::int FROM buyer_assignments WHERE status = 'SIGNED') as avg_assignment_fee
      `.catch(() => [{}]) as any[];

      if (metrics && metrics.total_contacted > 100) {
        systemMetrics = {
          responseRate: metrics.total_replied / Math.max(1, metrics.total_contacted),
          interestRate: metrics.total_interested / Math.max(1, metrics.total_replied),
          contractRate: metrics.contracts_signed / Math.max(1, metrics.total_interested),
          closeRate: metrics.assignments_closed / Math.max(1, metrics.contracts_signed),
          avgDealValue: metrics.avg_assignment_fee / 100,
          sampleSize: metrics.total_contacted,
        };
      }
    } catch (e) {
      console.error('Failed to fetch system metrics:', e);
    }
  }

  return Response.json({
    benchmarks: BENCHMARKS,
    systemMetrics,
    calculator: '/api/campaigns/outreach-calculator (POST)',
    description: 'Submit calculation request via POST with leadSource, touchCount, targetDeals, channels',
  });
}

export async function POST(req: NextRequest) {
  let input: CalculatorInput;
  try {
    input = await req.json();
  } catch {
    input = {};
  }

  const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

  // Get actual system performance for Bayesian updating
  let systemPrior = null;
  if (sql) {
    try {
      const [metrics] = await sql`
        SELECT
          (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'sent') as total_contacted,
          (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'replied') as total_replied,
          (SELECT COUNT(*)::int FROM campaign_lead_queue WHERE status = 'interested') as total_interested,
          (SELECT COUNT(*)::int FROM contracts WHERE esign_status = 'signed') as contracts_signed,
          (SELECT COUNT(*)::int FROM buyer_assignments WHERE status = 'SIGNED') as assignments_closed
      `.catch(() => [{}]) as any[];

      if (metrics && metrics.total_contacted > 50) {
        systemPrior = {
          n: metrics.total_contacted,
          responseRate: metrics.total_replied / Math.max(1, metrics.total_contacted),
          interestRate: metrics.total_interested / Math.max(1, metrics.total_replied || 1),
          contractRate: metrics.contracts_signed / Math.max(1, metrics.total_interested || 1),
          closeRate: metrics.assignments_closed / Math.max(1, metrics.contracts_signed || 1),
        };
      }
    } catch {
      // Use benchmarks as fallback
    }
  }

  // Parse inputs with defaults
  const leadSource = input.leadSource || 'motivatedSeller';
  const touchCount = Math.min(5, Math.max(1, input.touchCount || 3));
  const useAiOptimization = input.useAiOptimization !== false;
  const targetDeals = input.targetDeals || 1;
  const channels = input.channels || ['email', 'sms'];
  const avgDealValue = input.avgDealValue || BENCHMARKS.dealEconomics.avgAssignmentFee;

  // Calculate base response rate
  let baseResponseRate = BENCHMARKS.responseRates[leadSource] || 0.02;

  // Bayesian update if we have system data
  if (systemPrior && systemPrior.n > 50) {
    const priorWeight = 100; // Equivalent to 100 prior observations
    const dataWeight = Math.min(systemPrior.n, 1000); // Cap data influence
    const totalWeight = priorWeight + dataWeight;

    baseResponseRate = (priorWeight * baseResponseRate + dataWeight * systemPrior.responseRate) / totalWeight;
  }

  // Apply multi-touch multiplier
  const touchMultiplier = BENCHMARKS.touchMultipliers[touchCount as keyof typeof BENCHMARKS.touchMultipliers] || 2.3;
  let effectiveResponseRate = baseResponseRate * touchMultiplier;

  // Apply AI optimization boost
  if (useAiOptimization) {
    effectiveResponseRate *= BENCHMARKS.aiOptimizationBoost;
  }

  // Calculate funnel conversion probability
  let interestRate = BENCHMARKS.funnelRates.responseToInterested;
  let appointmentRate = BENCHMARKS.funnelRates.interestedToAppointment;
  let contractRate = BENCHMARKS.funnelRates.appointmentToContract;
  let closeRate = BENCHMARKS.funnelRates.contractToClose;

  // Update with system priors if available
  if (systemPrior && systemPrior.n > 100) {
    if (systemPrior.interestRate > 0) interestRate = (interestRate + systemPrior.interestRate) / 2;
    if (systemPrior.contractRate > 0) contractRate = (contractRate + systemPrior.contractRate) / 2;
    if (systemPrior.closeRate > 0) closeRate = (closeRate + systemPrior.closeRate) / 2;
  }

  // Total conversion probability (contacts → closed deal)
  const totalConversionRate = effectiveResponseRate * interestRate * appointmentRate * contractRate * closeRate;

  // Contacts needed for target deals
  const contactsPerDeal = Math.ceil(1 / totalConversionRate);
  const totalContactsNeeded = contactsPerDeal * targetDeals;

  // Cost calculation
  let costPer1000 = 0;
  for (const channel of channels) {
    switch (channel) {
      case 'email':
        costPer1000 += BENCHMARKS.costs.emailPer1000;
        break;
      case 'sms':
        costPer1000 += BENCHMARKS.costs.smsPer1000;
        break;
      case 'rcs':
        costPer1000 += BENCHMARKS.costs.rcsPer1000;
        break;
      case 'directMail':
        costPer1000 += BENCHMARKS.costs.directMailPer1000;
        break;
    }
  }

  const costPerContact = (costPer1000 / 1000) * touchCount;
  const totalCost = costPerContact * totalContactsNeeded;
  const costPerDeal = totalCost / targetDeals;

  // Revenue and ROI calculation
  const totalRevenue = avgDealValue * targetDeals;
  const profit = totalRevenue - totalCost;
  const roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;

  // Confidence intervals (using normal approximation)
  const stdError = Math.sqrt(totalConversionRate * (1 - totalConversionRate) / Math.max(100, systemPrior?.n || 100));
  const confidenceInterval95 = {
    lower: Math.max(0.0001, totalConversionRate - 1.96 * stdError),
    upper: Math.min(1, totalConversionRate + 1.96 * stdError),
  };

  const contactsRange = {
    optimistic: Math.ceil(1 / confidenceInterval95.upper) * targetDeals,
    expected: totalContactsNeeded,
    conservative: Math.ceil(1 / confidenceInterval95.lower) * targetDeals,
  };

  // Break-even analysis
  const breakEvenDeals = Math.ceil(totalCost / avgDealValue);
  const dealsAtCurrentConversion = Math.floor(totalContactsNeeded * totalConversionRate);

  // Timeline estimation
  const dailySendCapacity = 10000; // Assuming warmup complete
  const daysToContact = Math.ceil(totalContactsNeeded / dailySendCapacity);
  const totalTimeline = daysToContact + BENCHMARKS.dealEconomics.avgDealTimeline;

  return Response.json({
    input: {
      leadSource,
      touchCount,
      useAiOptimization,
      targetDeals,
      channels,
      avgDealValue,
    },

    conversionFunnel: {
      responseRate: effectiveResponseRate,
      responseToInterested: interestRate,
      interestedToAppointment: appointmentRate,
      appointmentToContract: contractRate,
      contractToClose: closeRate,
      totalConversion: totalConversionRate,
      totalConversionPercent: (totalConversionRate * 100).toFixed(4) + '%',
    },

    projections: {
      contactsPerDeal,
      totalContactsNeeded,
      contactsRange,
      confidenceLevel: '95%',
    },

    costs: {
      costPerContact: Math.round(costPerContact * 10000) / 10000,
      costPerDeal: Math.round(costPerDeal * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      breakdown: {
        perChannel: channels.map(c => ({
          channel: c,
          costPer1000: BENCHMARKS.costs[`${c}Per1000` as keyof typeof BENCHMARKS.costs] || 0,
        })),
        touchCount,
        perContactAllChannels: costPerContact,
      },
    },

    revenue: {
      avgDealValue,
      totalRevenue,
      profit: Math.round(profit * 100) / 100,
      roi: Math.round(roi * 10) / 10,
      roiMultiple: Math.round((totalRevenue / Math.max(1, totalCost)) * 10) / 10,
    },

    breakEven: {
      dealsNeeded: breakEvenDeals,
      contactsNeeded: breakEvenDeals * contactsPerDeal,
      costToBreakEven: Math.round(breakEvenDeals * costPerDeal * 100) / 100,
    },

    timeline: {
      daysToContact,
      avgDealClosingDays: BENCHMARKS.dealEconomics.avgDealTimeline,
      totalEstimatedDays: totalTimeline,
    },

    systemData: systemPrior ? {
      sampleSize: systemPrior.n,
      observedResponseRate: systemPrior.responseRate,
      observedInterestRate: systemPrior.interestRate,
      observedContractRate: systemPrior.contractRate,
      observedCloseRate: systemPrior.closeRate,
      dataUsed: true,
    } : {
      dataUsed: false,
      message: 'Using industry benchmarks (no sufficient system data)',
    },

    methodology: {
      description: 'Bayesian probability chain with multi-touch campaign modeling',
      formula: 'P(close) = P(response) × P(interest|response) × P(appointment|interest) × P(contract|appointment) × P(close|contract)',
      assumptions: [
        'Lead source quality affects base response rate',
        'Multi-touch sequences have diminishing returns after 5 touches',
        'AI optimization provides 30% lift on message personalization',
        '35% of contracts fall through before closing',
        'System data updates priors via Bayesian updating when n > 50',
      ],
    },

    updatedAt: new Date().toISOString(),
  });
}
