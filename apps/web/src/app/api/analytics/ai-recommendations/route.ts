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

Based on this data, provide exactly 4 specific recommendations in the following JSON format:
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
      "estimatedEffort": "quick-win|moderate|significant"
    }
  ]
}

Focus on:
1. The BIGGEST opportunity for improvement based on the actual data
2. Quick wins that can be implemented today
3. Specific numbers and comparisons from the data
4. Actionable next steps, not generic advice`;

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

      aiRecommendations,

      dataAnalyzed: {
        campaigns: templatePerformance.length,
        regions: regionalData.length,
        hourlyDataPoints: hourlyData.length,
        sources: sourceData.length,
      },

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

  // Low response rate recommendation
  if (data.responseRate < 2) {
    recommendations.push({
      category: 'messaging',
      priority: 'critical',
      title: 'Improve Message Response Rate',
      analysis: `Current ${data.responseRate.toFixed(2)}% response rate is below the 2% industry benchmark.`,
      specificAction: 'A/B test subject lines with urgency ("Regarding Your Property at [Address]") and personalization.',
      expectedImpact: 'Improve response rate to 2.5% (+25% more replies)',
      implementationSteps: [
        'Create 3 subject line variants',
        'Split next campaign 33/33/33',
        'Measure after 500 sends per variant',
        'Scale winner to 100%',
      ],
      estimatedEffort: 'quick-win',
    });
  }

  // Low interest conversion
  if (data.interestRate < 15 && data.responseRate >= 1) {
    recommendations.push({
      category: 'followup',
      priority: 'high',
      title: 'Speed Up Reply Response Time',
      analysis: `${data.interestRate.toFixed(2)}% of replies convert to interest. Faster response increases conversion.`,
      specificAction: 'Set up mobile alerts for inbound replies. Respond within 5 minutes during business hours.',
      expectedImpact: 'Improve interest conversion to 20% (+33% more deals)',
      implementationSteps: [
        'Enable push notifications for reply alerts',
        'Create response templates for common scenarios',
        'Set SLA of <5min during 9am-6pm',
        'Queue auto-response for after-hours',
      ],
      estimatedEffort: 'moderate',
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

    if (best && worst) {
      const bestRate = best.contacted > 0 ? (best.replied / best.contacted * 100).toFixed(1) : '0';
      const worstRate = worst.contacted > 0 ? (worst.replied / worst.contacted * 100).toFixed(1) : '0';

      recommendations.push({
        category: 'targeting',
        priority: 'medium',
        title: 'Optimize Regional Targeting',
        analysis: `${best.state} (${bestRate}%) outperforms ${worst.state} (${worstRate}%).`,
        specificAction: `Shift 30% of ${worst.state} budget to ${best.state}. Test localized messaging for ${worst.state}.`,
        expectedImpact: 'Improve overall response by 15-20%',
        implementationSteps: [
          `Reduce ${worst.state} daily cap by 30%`,
          `Increase ${best.state} daily cap by 30%`,
          `Create ${worst.state}-specific message variant`,
          'Review after 2 weeks',
        ],
        estimatedEffort: 'quick-win',
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
    });
  }

  return recommendations.slice(0, 4);
}
