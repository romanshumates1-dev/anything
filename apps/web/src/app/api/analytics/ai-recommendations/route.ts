/**
 * AI-Powered Campaign Recommendations API
 *
 * Uses Claude AI to analyze campaign performance data and generate
 * specific, actionable recommendations for improving results.
 *
 * This endpoint:
 * 1. Fetches comprehensive campaign metrics
 * 2. Sends data to AI for deep analysis
 * 3. Returns structured recommendations with ROI projections
 */

import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { callAI } from '@/app/api/utils/ai-provider';

export const dynamic = 'force-dynamic';

interface AIRecommendation {
  category: 'messaging' | 'timing' | 'targeting' | 'channel' | 'followup' | 'compliance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  analysis: string;
  specificAction: string;
  expectedImpact: string;
  implementationSteps: string[];
  estimatedEffort: 'quick-win' | 'moderate' | 'significant';
  // NEW: ROI projections and confidence
  roiProjection?: {
    projectedAdditionalReplies: number;
    projectedAdditionalDeals: number;
    projectedRevenueImpact: string;
    confidenceRange: { low: string; high: string };
  };
  confidence: 'high' | 'medium' | 'low' | 'insufficient';
  sampleSize: number;
  minSampleSizeNeeded: number;
  dataCitations: string[];
}

export async function GET(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: 'DATABASE_URL not configured' }, { status: 500 });
  }

  const sql = neon(process.env.DATABASE_URL);
  const searchParams = req.nextUrl.searchParams;
  const days = parseInt(searchParams.get('days') || '30');
  const campaignId = searchParams.get('campaignId');

  try {
    // 1. Gather comprehensive campaign data
    const [overallMetrics] = await sql`
      SELECT
        COUNT(DISTINCT clq.lead_id)::int as total_leads,
        COUNT(*) FILTER (WHERE clq.status = 'sent')::int as total_contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as total_replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as total_interested,
        COUNT(*) FILTER (WHERE clq.status = 'rejected')::int as total_rejected,
        COALESCE(AVG(clq.touch_number) FILTER (WHERE clq.status = 'interested'), 0)::numeric(4,2) as avg_touches_to_interest,
        COALESCE(AVG(clq.expected_value) FILTER (WHERE clq.status = 'interested'), 0)::int as avg_deal_value
      FROM campaign_lead_queue clq
      WHERE clq.created_at > now() - (${days} || ' days')::interval
        ${campaignId ? sql`AND clq.campaign_id = ${campaignId}` : sql``}
    `.catch(() => [{}]) as any[];

    // 2. Message template performance
    const templatePerformance = await sql`
      SELECT
        COALESCE(c.name, 'Unknown') as campaign_name,
        COUNT(*) FILTER (WHERE clq.status = 'sent')::int as sent,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested,
        ROUND(COUNT(*) FILTER (WHERE clq.status = 'replied')::numeric /
              NULLIF(COUNT(*) FILTER (WHERE clq.status = 'sent'), 0) * 100, 2) as response_rate
      FROM campaign_lead_queue clq
      JOIN campaigns c ON c.id = clq.campaign_id
      WHERE clq.created_at > now() - (${days} || ' days')::interval
      GROUP BY c.id, c.name
      HAVING COUNT(*) FILTER (WHERE clq.status = 'sent') > 10
      ORDER BY response_rate DESC NULLS LAST
      LIMIT 10
    `.catch(() => []);

    // 3. Regional breakdown
    const regionalData = await sql`
      SELECT
        COALESCE(l.state, 'Unknown') as state,
        COUNT(DISTINCT clq.lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested
      FROM campaign_lead_queue clq
      JOIN leads l ON l.id = clq.lead_id
      WHERE clq.created_at > now() - (${days} || ' days')::interval
      GROUP BY COALESCE(l.state, 'Unknown')
      HAVING COUNT(DISTINCT clq.lead_id) > 20
      ORDER BY COUNT(DISTINCT clq.lead_id) DESC
      LIMIT 15
    `.catch(() => []);

    // 4. Time-of-day performance (if we have hourly data)
    const hourlyData = await sql`
      SELECT
        EXTRACT(HOUR FROM me.created_at AT TIME ZONE 'America/New_York')::int as hour,
        COUNT(*)::int as sent,
        COUNT(*) FILTER (WHERE me.status = 'delivered')::int as delivered,
        COUNT(*) FILTER (WHERE me.status IN ('replied', 'responded'))::int as replied
      FROM message_events me
      WHERE me.created_at > now() - (${days} || ' days')::interval
        AND me.direction = 'outbound'
      GROUP BY EXTRACT(HOUR FROM me.created_at AT TIME ZONE 'America/New_York')
      ORDER BY hour
    `.catch(() => []);

    // 5. Lead source quality
    const sourceData = await sql`
      SELECT
        COALESCE(l.source, 'Unknown') as source,
        COUNT(DISTINCT l.id)::int as total_leads,
        COUNT(DISTINCT clq.lead_id)::int as contacted,
        COUNT(*) FILTER (WHERE clq.status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE clq.status = 'interested')::int as interested
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.created_at > now() - (${days} || ' days')::interval
      GROUP BY COALESCE(l.source, 'Unknown')
      HAVING COUNT(DISTINCT l.id) > 10
      ORDER BY COUNT(DISTINCT l.id) DESC
      LIMIT 10
    `.catch(() => []);

    // 6. Build analysis prompt for AI
    const totalContacted = overallMetrics.total_contacted || 0;
    const totalReplied = overallMetrics.total_replied || 0;
    const totalInterested = overallMetrics.total_interested || 0;
    const responseRate = totalContacted > 0 ? (totalReplied / totalContacted * 100).toFixed(2) : '0';
    const interestRate = totalReplied > 0 ? (totalInterested / totalReplied * 100).toFixed(2) : '0';

    const analysisPrompt = `You are an expert real estate wholesaling campaign analyst. Analyze the following campaign data and provide specific, actionable recommendations.

## Campaign Performance (Last ${days} Days)

### Overall Metrics
- Total Leads Contacted: ${totalContacted}
- Total Replies: ${totalReplied} (${responseRate}% response rate)
- Total Interested: ${totalInterested} (${interestRate}% interest rate of replies)
- Avg Deal Value: $${((overallMetrics.avg_deal_value || 0) / 100).toLocaleString()}
- Avg Touches to Interest: ${overallMetrics.avg_touches_to_interest || 'N/A'}

### Campaign/Template Performance
${templatePerformance.map((t: any) =>
  `- ${t.campaign_name}: ${t.sent} sent, ${t.response_rate || 0}% response rate`
).join('\n') || 'No template data available'}

### Regional Performance
${regionalData.map((r: any) => {
  const rate = r.contacted > 0 ? (r.replied / r.contacted * 100).toFixed(1) : '0';
  return `- ${r.state}: ${r.contacted} contacted, ${rate}% response rate`;
}).join('\n') || 'No regional data available'}

### Time-of-Day Performance
${hourlyData.map((h: any) => {
  const rate = h.sent > 0 ? (h.replied / h.sent * 100).toFixed(1) : '0';
  return `- ${h.hour}:00: ${h.sent} sent, ${rate}% response rate`;
}).join('\n') || 'No hourly data available'}

### Lead Source Quality
${sourceData.map((s: any) => {
  const rate = s.contacted > 0 ? (s.replied / s.contacted * 100).toFixed(1) : '0';
  return `- ${s.source}: ${s.total_leads} leads, ${rate}% response rate`;
}).join('\n') || 'No source data available'}

## Industry Benchmarks (Real Estate Wholesaling)
- Good response rate: 2-3%
- Excellent response rate: 4%+
- Good interest conversion: 15-20% of replies
- Optimal send times: Tue-Thu 10am-2pm local time
- Multi-touch optimal: 3-5 touches over 14 days

## Data Quality Assessment
- Total sample size: ${totalContacted} contacts
- Minimum for reliable insights: 100 contacts
- Minimum for A/B test conclusions: 500 contacts per variant
- Confidence level: ${totalContacted >= 1000 ? 'HIGH' : totalContacted >= 500 ? 'MEDIUM' : totalContacted >= 100 ? 'LOW' : 'INSUFFICIENT'}

Based on this data, provide ${totalContacted >= 500 ? '4-6' : totalContacted >= 100 ? '2-4' : '1-2'} recommendations. ONLY provide recommendations where the data supports the conclusion. If sample size is insufficient, say so.

Return recommendations in this JSON format:
{
  "recommendations": [
    {
      "category": "messaging|timing|targeting|channel|followup|compliance",
      "priority": "critical|high|medium|low",
      "title": "Short title (max 50 chars)",
      "analysis": "1-2 sentence analysis of the specific problem identified in the data",
      "specificAction": "Exactly what to change (be specific - which campaign, region, time, etc.)",
      "expectedImpact": "Quantified expected improvement (e.g., 'increase response rate by 0.5%')",
      "implementationSteps": ["Step 1", "Step 2", "Step 3"],
      "estimatedEffort": "quick-win|moderate|significant",
      "roiProjection": {
        "projectedAdditionalReplies": 50,
        "projectedAdditionalDeals": 2,
        "projectedRevenueImpact": "$20,000",
        "confidenceRange": {"low": "$14,000", "high": "$26,000"}
      },
      "confidence": "high|medium|low|insufficient",
      "sampleSize": 1000,
      "minSampleSizeNeeded": 100,
      "dataCitations": ["Specific data point 1", "Specific data point 2"]
    }
  ]
}

IMPORTANT RULES:
1. ALWAYS include roiProjection with dollar amounts based on avg deal value
2. ALWAYS include confidence based on sample size vs minSampleSizeNeeded
3. ALWAYS include dataCitations - specific numbers from the data above
4. If sample size < 100, set confidence to "insufficient" and note it
5. Focus on recommendations that can be acted on TODAY
6. Order by projected revenue impact (highest first), not just priority`;

    // 7. Call AI for analysis
    let aiRecommendations: AIRecommendation[] = [];
    try {
      const aiResponse = await callAI({
        messages: [{ role: 'user', content: analysisPrompt }],
        system: 'You are a data-driven marketing analyst specializing in real estate wholesaling. Always respond with valid JSON. Focus on specific, measurable recommendations.',
        maxTokens: 1500,
      });

      // Parse AI response
      const jsonMatch = aiResponse.text.match(/\{[\s\S]*"recommendations"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        aiRecommendations = parsed.recommendations || [];
      }
    } catch (aiError: any) {
      console.error('AI recommendation error:', aiError.message);
      // Fall back to rule-based recommendations
      aiRecommendations = generateFallbackRecommendations({
        responseRate: parseFloat(responseRate),
        interestRate: parseFloat(interestRate),
        totalContacted,
        templatePerformance,
        regionalData,
      });
    }

    // Calculate data quality indicators
    const dataQuality = {
      totalSampleSize: totalContacted,
      sufficientForAnalysis: totalContacted >= 100,
      sufficientForABTests: totalContacted >= 500,
      recommendedMinimum: 500,
      confidenceLevel: totalContacted >= 1000 ? 'high' : totalContacted >= 500 ? 'medium' : totalContacted >= 100 ? 'low' : 'insufficient',
    };

    // Sort recommendations by projected revenue impact if available
    const sortedRecommendations = [...aiRecommendations].sort((a, b) => {
      // Parse revenue impact strings like "$20,000" to numbers
      const parseRevenue = (r: AIRecommendation) => {
        const impact = r.roiProjection?.projectedRevenueImpact || '0';
        const num = parseInt(impact.replace(/[^0-9]/g, ''), 10);
        return isNaN(num) ? 0 : num;
      };
      return parseRevenue(b) - parseRevenue(a);
    });

    return Response.json({
      period: { days, campaignId },

      summary: {
        totalContacted,
        totalReplied,
        totalInterested,
        responseRate: responseRate + '%',
        interestRate: interestRate + '%',
        avgDealValue: (overallMetrics.avg_deal_value || 0) / 100,
      },

      // Recommendations sorted by ROI impact
      aiRecommendations: sortedRecommendations,

      // Data quality indicators
      dataQuality,

      dataAnalyzed: {
        campaigns: templatePerformance.length,
        regions: regionalData.length,
        hourlyDataPoints: hourlyData.length,
        sources: sourceData.length,
      },

      // Warning if insufficient data
      warnings: dataQuality.confidenceLevel === 'insufficient'
        ? ['Insufficient data for reliable insights. Need at least 100 contacts for basic analysis, 500 for A/B test conclusions.']
        : dataQuality.confidenceLevel === 'low'
          ? ['Low confidence - recommendations based on limited data. Results may vary.']
          : [],

      generatedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('AI recommendations error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function generateFallbackRecommendations(data: {
  responseRate: number;
  interestRate: number;
  totalContacted: number;
  templatePerformance: any[];
  regionalData: any[];
}): AIRecommendation[] {
  const recommendations: AIRecommendation[] = [];
  const avgDealValue = 10000; // Default assumption
  const replyToContractRate = 0.05; // 5% of replies become contracts

  // Helper to determine confidence
  const getConfidence = (sampleSize: number, minNeeded: number = 100): 'high' | 'medium' | 'low' | 'insufficient' => {
    if (sampleSize < minNeeded * 0.5) return 'insufficient';
    if (sampleSize < minNeeded) return 'low';
    if (sampleSize < minNeeded * 3) return 'medium';
    return 'high';
  };

  // Low response rate recommendation
  if (data.responseRate < 2) {
    const currentReplies = Math.round(data.responseRate * data.totalContacted / 100);
    const targetRate = 2.5;
    const projectedReplies = Math.round(targetRate * data.totalContacted / 100);
    const additionalReplies = projectedReplies - currentReplies;
    const additionalDeals = Math.round(additionalReplies * replyToContractRate);
    const revenueImpact = additionalDeals * avgDealValue;

    recommendations.push({
      category: 'messaging',
      priority: 'critical',
      title: 'Improve Message Response Rate',
      analysis: `Current ${data.responseRate.toFixed(2)}% response rate is below the 2% industry benchmark.`,
      specificAction: 'A/B test subject lines with urgency ("Regarding Your Property at [Address]") and personalization.',
      expectedImpact: `Improve response rate to ${targetRate}% (+${additionalReplies} replies, +${additionalDeals} deals)`,
      implementationSteps: [
        'Create 3 subject line variants',
        'Split next campaign 33/33/33',
        'Measure after 500 sends per variant',
        'Scale winner to 100%',
      ],
      estimatedEffort: 'quick-win',
      roiProjection: {
        projectedAdditionalReplies: additionalReplies,
        projectedAdditionalDeals: additionalDeals,
        projectedRevenueImpact: `$${revenueImpact.toLocaleString()}`,
        confidenceRange: {
          low: `$${Math.round(revenueImpact * 0.7).toLocaleString()}`,
          high: `$${Math.round(revenueImpact * 1.3).toLocaleString()}`,
        },
      },
      confidence: getConfidence(data.totalContacted, 100),
      sampleSize: data.totalContacted,
      minSampleSizeNeeded: 100,
      dataCitations: [
        `Current: ${currentReplies} replies from ${data.totalContacted} contacts (${data.responseRate.toFixed(2)}%)`,
        `Industry benchmark: 2.5% for motivated seller campaigns`,
        `Avg deal value assumption: $${avgDealValue.toLocaleString()}`,
      ],
    });
  }

  // Low interest conversion
  if (data.interestRate < 15 && data.responseRate >= 1) {
    const currentReplies = Math.round(data.responseRate * data.totalContacted / 100);
    const currentInterested = Math.round(data.interestRate * currentReplies / 100);
    const targetInterestRate = 20;
    const additionalInterested = Math.round(currentReplies * (targetInterestRate - data.interestRate) / 100);
    const additionalDeals = Math.round(additionalInterested * 0.2); // 20% of interested become deals
    const revenueImpact = additionalDeals * avgDealValue;

    recommendations.push({
      category: 'followup',
      priority: 'high',
      title: 'Speed Up Reply Response Time',
      analysis: `${data.interestRate.toFixed(2)}% of replies convert to interest. Faster response increases conversion.`,
      specificAction: 'Set up mobile alerts for inbound replies. Respond within 5 minutes during business hours.',
      expectedImpact: `Improve interest conversion to ${targetInterestRate}% (+${additionalInterested} interested leads)`,
      implementationSteps: [
        'Enable push notifications for reply alerts',
        'Create response templates for common scenarios',
        'Set SLA of <5min during 9am-6pm',
        'Queue auto-response for after-hours',
      ],
      estimatedEffort: 'moderate',
      roiProjection: {
        projectedAdditionalReplies: 0,
        projectedAdditionalDeals: additionalDeals,
        projectedRevenueImpact: `$${revenueImpact.toLocaleString()}`,
        confidenceRange: {
          low: `$${Math.round(revenueImpact * 0.6).toLocaleString()}`,
          high: `$${Math.round(revenueImpact * 1.4).toLocaleString()}`,
        },
      },
      confidence: getConfidence(currentReplies, 50),
      sampleSize: currentReplies,
      minSampleSizeNeeded: 50,
      dataCitations: [
        `Current: ${currentInterested} interested from ${currentReplies} replies (${data.interestRate.toFixed(2)}%)`,
        `Target: ${targetInterestRate}% interest conversion`,
        `Industry data: 5-minute response increases conversion 9x`,
      ],
    });
  }

  // Regional optimization
  if (data.regionalData.length >= 2) {
    const sorted = [...data.regionalData].sort((a: any, b: any) => {
      const rateA = a.contacted > 0 ? a.replied / a.contacted : 0;
      const rateB = b.contacted > 0 ? b.replied / b.contacted : 0;
      return rateB - rateA;
    });
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (best && worst && worst.contacted >= 20) {
      const bestRate = best.contacted > 0 ? (best.replied / best.contacted * 100) : 0;
      const worstRate = worst.contacted > 0 ? (worst.replied / worst.contacted * 100) : 0;
      const additionalReplies = Math.round(worst.contacted * 0.3 * (bestRate - worstRate) / 100);
      const additionalDeals = Math.round(additionalReplies * replyToContractRate);
      const revenueImpact = additionalDeals * avgDealValue;

      recommendations.push({
        category: 'targeting',
        priority: 'medium',
        title: 'Optimize Regional Targeting',
        analysis: `${best.state} (${bestRate.toFixed(1)}%) outperforms ${worst.state} (${worstRate.toFixed(1)}%).`,
        specificAction: `Shift 30% of ${worst.state} budget to ${best.state}. Test localized messaging for ${worst.state}.`,
        expectedImpact: `+${additionalReplies} replies by reallocating ${Math.round(worst.contacted * 0.3)} contacts`,
        implementationSteps: [
          `Reduce ${worst.state} daily cap by 30%`,
          `Increase ${best.state} daily cap by 30%`,
          `Create ${worst.state}-specific message variant`,
          'Review after 2 weeks',
        ],
        estimatedEffort: 'quick-win',
        roiProjection: {
          projectedAdditionalReplies: additionalReplies,
          projectedAdditionalDeals: additionalDeals,
          projectedRevenueImpact: `$${revenueImpact.toLocaleString()}`,
          confidenceRange: {
            low: `$${Math.round(revenueImpact * 0.5).toLocaleString()}`,
            high: `$${Math.round(revenueImpact * 1.5).toLocaleString()}`,
          },
        },
        confidence: getConfidence(worst.contacted, 50),
        sampleSize: worst.contacted,
        minSampleSizeNeeded: 50,
        dataCitations: [
          `${best.state}: ${best.contacted} contacts, ${best.replied} replies (${bestRate.toFixed(1)}%)`,
          `${worst.state}: ${worst.contacted} contacts, ${worst.replied} replies (${worstRate.toFixed(1)}%)`,
          `Gap: ${(bestRate - worstRate).toFixed(1)} percentage points`,
        ],
      });
    }
  }

  // Volume recommendation
  if (data.totalContacted < 500) {
    recommendations.push({
      category: 'targeting',
      priority: 'high',
      title: 'Increase Outreach Volume',
      analysis: `${data.totalContacted} contacts is below the 500/week minimum for statistical significance.`,
      specificAction: 'Add more motivated seller lists: tax delinquent, pre-foreclosure, probate, code violations.',
      expectedImpact: 'More data for optimization + more deal flow',
      implementationSteps: [
        'Import tax delinquent list (county records)',
        'Add pre-foreclosure from PropStream/ListSource',
        'Set up weekly list refresh automation',
        'Target 200+ contacts/day',
      ],
      estimatedEffort: 'moderate',
      roiProjection: {
        projectedAdditionalReplies: Math.round((500 - data.totalContacted) * 0.025),
        projectedAdditionalDeals: Math.round((500 - data.totalContacted) * 0.025 * replyToContractRate),
        projectedRevenueImpact: `$${Math.round((500 - data.totalContacted) * 0.025 * replyToContractRate * avgDealValue).toLocaleString()}`,
        confidenceRange: {
          low: 'N/A - need more data',
          high: 'N/A - need more data',
        },
      },
      confidence: 'insufficient',
      sampleSize: data.totalContacted,
      minSampleSizeNeeded: 500,
      dataCitations: [
        `Current volume: ${data.totalContacted} contacts`,
        `Minimum needed for reliable A/B tests: 500 per variant`,
        `Cannot make data-driven decisions with current sample size`,
      ],
    });
  }

  // Sort by projected revenue impact
  return recommendations
    .sort((a, b) => {
      const aRev = parseInt((a.roiProjection?.projectedRevenueImpact || '0').replace(/[^0-9]/g, ''), 10) || 0;
      const bRev = parseInt((b.roiProjection?.projectedRevenueImpact || '0').replace(/[^0-9]/g, ''), 10) || 0;
      return bRev - aRev;
    })
    .slice(0, data.totalContacted >= 500 ? 6 : data.totalContacted >= 100 ? 4 : 2);
}
