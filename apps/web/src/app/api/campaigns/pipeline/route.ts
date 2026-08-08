/**
 * GET /api/campaigns/pipeline
 *
 * Pipeline data for the prospects monitoring dashboard.
 * Returns leads with their pipeline status, tiers, phases, and analytics.
 */
import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PIPELINE_PHASES = [
  { id: 'new', label: 'New Lead', color: 'slate' },
  { id: 'outreach', label: 'Initial Outreach', color: 'blue' },
  { id: 'engaged', label: 'Engaged', color: 'cyan' },
  { id: 'qualifying', label: 'Qualifying', color: 'violet' },
  { id: 'negotiating', label: 'Negotiating', color: 'amber' },
  { id: 'contract', label: 'Under Contract', color: 'orange' },
  { id: 'closing', label: 'Closing', color: 'emerald' },
  { id: 'won', label: 'Won', color: 'green' },
  { id: 'lost', label: 'Lost', color: 'rose' },
];

const TIERS = [
  { id: 'hot', label: 'Hot', color: 'rose', description: 'High intent, ready to close' },
  { id: 'warm', label: 'Warm', color: 'amber', description: 'Interested, needs nurturing' },
  { id: 'cold', label: 'Cold', color: 'blue', description: 'New or unresponsive' },
];

export async function GET(req: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return Response.json({ error: 'DATABASE_URL not configured' }, { status: 500 });
    }

    const sql = neon(process.env.DATABASE_URL);

    // Get leads with their pipeline status
    const leads = await sql`
      SELECT
        l.id,
        l.name,
        l.email,
        l.phone,
        l.created_at,
        l.updated_at,
        l.metadata,
        COALESCE(l.metadata->>'phase', 'new') as phase,
        COALESCE(l.metadata->>'tier', 'cold') as tier,
        COALESCE(FLOOR((l.metadata->>'motivationScore')::numeric)::int, (l.metadata->>'score')::int, 50) as score,
        COALESCE(l.metadata->>'last_contact', l.updated_at::text) as last_contact,
        COALESCE(l.metadata->>'address', l.metadata->>'fullAddress', '') as address,
        COALESCE(
          clq.expected_value,
          (l.metadata->>'expected_value')::int,
          (l.metadata->>'propertyValue')::int,
          15000
        ) as expected_value,
        clq.touch_number,
        clq.status as queue_status,
        clq.last_sent_at,
        clq.reply_sentiment,
        CASE WHEN clq.id IS NOT NULL THEN 1 ELSE 0 END as has_queue
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.email IS NOT NULL
      ORDER BY has_queue DESC, clq.last_sent_at DESC NULLS LAST, l.updated_at DESC
      LIMIT 200
    `.catch(() => []);

    // Get recent messages/interactions
    const messages = await sql`
      SELECT
        j.id,
        j.type,
        j.status,
        j.payload,
        j.created_at,
        j.updated_at
      FROM jobs j
      WHERE j.type IN ('send_email', 'send_message', 'ai_reply')
      ORDER BY j.updated_at DESC
      LIMIT 50
    `.catch(() => []);

    // Count by phase and tier
    const phaseCounts: Record<string, number> = {};
    const tierCounts: Record<string, number> = { hot: 0, warm: 0, cold: 0 };

    for (const lead of leads) {
      const phase = (lead as any).phase || 'new';
      phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
    }

    // Enrich leads with message history
    const enrichedLeads = leads.map((lead: any) => {
      const leadMessages = messages.filter((m: any) => {
        try {
          const payload = typeof m.payload === 'string' ? JSON.parse(m.payload) : m.payload;
          return payload?.leadId == lead.id || payload?.lead_id == lead.id || payload?.email === lead.email;
        } catch { return false; }
      });

      // Calculate tier based on score/sentiment
      let tier = lead.tier || 'cold';
      const score = lead.score || 50;
      if (lead.reply_sentiment === 'positive' || score >= 80 || lead.queue_status === 'interested') {
        tier = 'hot';
      } else if (leadMessages.length > 0 || score >= 50 || lead.queue_status === 'replied') {
        tier = 'warm';
      }

      tierCounts[tier] = (tierCounts[tier] || 0) + 1;

      return {
        id: lead.id,
        name: lead.name || 'Unknown',
        email: lead.email,
        phone: lead.phone,
        address: lead.address,
        phase: lead.phase || 'new',
        tier,
        score: score,
        expectedValue: lead.expected_value || 15000,
        lastContact: lead.last_sent_at || lead.last_contact,
        messageCount: lead.touch_number || leadMessages.length,
        lastMessage: leadMessages[0] ? {
          type: leadMessages[0].type,
          status: leadMessages[0].status,
          when: leadMessages[0].updated_at,
        } : null,
        createdAt: lead.created_at,
        updatedAt: lead.updated_at,
        queueStatus: lead.queue_status,
        replySentiment: lead.reply_sentiment,
      };
    });

    // Calculate analytics
    const totalExpectedValue = enrichedLeads.reduce((sum, l) => sum + (l.expectedValue || 0), 0);
    const avgScore = enrichedLeads.length > 0
      ? Math.round(enrichedLeads.reduce((sum, l) => sum + l.score, 0) / enrichedLeads.length)
      : 0;
    const totalMessages = enrichedLeads.reduce((sum, l) => sum + l.messageCount, 0);
    const leadsWithReplies = enrichedLeads.filter(l => l.queueStatus === 'replied' || l.queueStatus === 'interested').length;
    const hotLeads = enrichedLeads.filter(l => l.tier === 'hot');
    const warmLeads = enrichedLeads.filter(l => l.tier === 'warm');

    // Response rate by tier
    const responseByTier = {
      hot: { total: hotLeads.length, replied: hotLeads.filter(l => l.queueStatus === 'replied' || l.queueStatus === 'interested').length },
      warm: { total: warmLeads.length, replied: warmLeads.filter(l => l.queueStatus === 'replied' || l.queueStatus === 'interested').length },
      cold: { total: tierCounts.cold, replied: enrichedLeads.filter(l => l.tier === 'cold' && (l.queueStatus === 'replied' || l.queueStatus === 'interested')).length },
    };

    return Response.json({
      phases: PIPELINE_PHASES,
      tiers: TIERS,
      phaseCounts,
      tierCounts,
      prospects: enrichedLeads,
      totalProspects: enrichedLeads.length,
      recentMessages: messages.slice(0, 20).map((m: any) => ({
        id: m.id,
        type: m.type,
        status: m.status,
        when: m.updated_at,
      })),
      analytics: {
        totalExpectedValue,
        avgExpectedValue: enrichedLeads.length > 0 ? Math.round(totalExpectedValue / enrichedLeads.length) : 0,
        avgScore,
        totalMessages,
        leadsWithReplies,
        replyRate: enrichedLeads.length > 0 ? ((leadsWithReplies / enrichedLeads.length) * 100).toFixed(1) : '0.0',
        responseByTier,
        topPerformers: enrichedLeads.filter(l => l.score >= 80).length,
        inNegotiation: phaseCounts.negotiating || 0,
        underContract: phaseCounts.contract || 0,
        closing: phaseCounts.closing || 0,
        won: phaseCounts.won || 0,
        conversionRate: enrichedLeads.length > 0
          ? (((phaseCounts.won || 0) / enrichedLeads.length) * 100).toFixed(2)
          : '0.00',
        avgMessagesPerLead: enrichedLeads.length > 0 ? (totalMessages / enrichedLeads.length).toFixed(1) : '0',
      },
    });
  } catch (error: any) {
    console.error('GET /api/campaigns/pipeline error', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
