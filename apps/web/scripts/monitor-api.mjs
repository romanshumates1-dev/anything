#!/usr/bin/env node
/**
 * Standalone monitor API server with enhanced analytics
 * Run: node --env-file=.env scripts/monitor-api.mjs
 * Access: http://localhost:4001/api/campaigns/monitor
 */
import http from 'http';
import { neon } from '@neondatabase/serverless';

const PORT = 4001;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Pipeline phases for wholesaling
const PIPELINE_PHASES = [
  { id: 'new', label: 'New Lead', color: 'slate', icon: 'inbox' },
  { id: 'outreach', label: 'Initial Outreach', color: 'blue', icon: 'send' },
  { id: 'engaged', label: 'Engaged', color: 'cyan', icon: 'message' },
  { id: 'qualifying', label: 'Qualifying', color: 'violet', icon: 'filter' },
  { id: 'negotiating', label: 'Negotiating', color: 'amber', icon: 'handshake' },
  { id: 'contract', label: 'Under Contract', color: 'orange', icon: 'document' },
  { id: 'closing', label: 'Closing', color: 'emerald', icon: 'check' },
  { id: 'won', label: 'Won', color: 'green', icon: 'trophy' },
  { id: 'lost', label: 'Lost', color: 'rose', icon: 'x' },
];

// Prospect tiers
const TIERS = [
  { id: 'hot', label: 'Hot', color: 'rose', description: 'High intent, ready to close' },
  { id: 'warm', label: 'Warm', color: 'amber', description: 'Interested, needs nurturing' },
  { id: 'cold', label: 'Cold', color: 'blue', description: 'New or unresponsive' },
];

async function getProspectMessages(prospectId) {
  // Get messages for a specific prospect from jobs table (outbound)
  const outboundJobs = await sql`
    SELECT
      j.id,
      j.type,
      j.status,
      j.payload,
      j.created_at,
      j.updated_at
    FROM jobs j
    WHERE j.type IN ('send_email', 'send_message')
      AND j.status = 'completed'
      AND (
        j.payload->>'leadId' = ${prospectId.toString()}
        OR j.payload->>'lead_id' = ${prospectId.toString()}
      )
    ORDER BY j.created_at ASC
    LIMIT 50
  `.catch(() => []);

  // Get AI reply jobs (these contain both inbound context and outbound response)
  const aiReplyJobs = await sql`
    SELECT
      j.id,
      j.type,
      j.status,
      j.payload,
      j.created_at,
      j.updated_at
    FROM jobs j
    WHERE j.type = 'ai_reply'
      AND (
        j.payload->>'leadId' = ${prospectId.toString()}
        OR j.payload->>'lead_id' = ${prospectId.toString()}
      )
    ORDER BY j.created_at ASC
    LIMIT 50
  `.catch(() => []);

  // Get message_events for all activity (note: table uses direction and contact_id)
  const events = await sql`
    SELECT
      id,
      direction,
      status,
      metadata,
      created_at
    FROM message_events
    WHERE contact_id = ${prospectId}
    ORDER BY created_at ASC
    LIMIT 100
  `.catch(() => []);

  // Get lead info and queue status
  const [lead] = await sql`
    SELECT l.name, l.email, l.metadata, clq.touch_number, clq.status as queue_status, clq.expected_value
    FROM leads l
    LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
    WHERE l.id = ${prospectId}
  `.catch(() => [{}]);

  // Transform into conversation format
  const formattedMessages = [];

  // Add outbound messages from jobs
  for (const msg of outboundJobs) {
    const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : (msg.payload || {});
    formattedMessages.push({
      id: `job-${msg.id}`,
      type: 'outbound',
      subject: payload.subject || 'Property Inquiry',
      content: payload.body || payload.content || `Hi ${lead?.name?.split(' ')[0] || 'there'},\n\nI noticed your property and wanted to reach out. I'm a local real estate investor and I help homeowners like yourself who might be looking for a quick, hassle-free sale.\n\nWould you be interested in receiving a no-obligation cash offer?\n\nBest regards,\nDealFlow AI`,
      status: msg.status === 'completed' ? 'delivered' : 'pending',
      sentAt: msg.created_at,
      channel: 'email',
    });
  }

  // Add AI reply interactions (includes inbound message context)
  for (const msg of aiReplyJobs) {
    const payload = typeof msg.payload === 'string' ? JSON.parse(msg.payload) : (msg.payload || {});
    // If there's an inbound message, add it
    if (payload.message || payload.content) {
      formattedMessages.push({
        id: `inbound-${msg.id}`,
        type: 'inbound',
        content: payload.message || payload.content,
        status: 'received',
        sentAt: new Date(new Date(msg.created_at).getTime() - 3600000).toISOString(), // 1 hour before reply
        channel: 'email',
      });
    }
  }

  // Add events from message_events
  for (const evt of events) {
    const meta = typeof evt.metadata === 'string' ? JSON.parse(evt.metadata) : (evt.metadata || {});

    if (evt.direction === 'outbound' && evt.status === 'sent') {
      // Only add if we don't already have this message
      if (!formattedMessages.find(m => m.sentAt === evt.created_at)) {
        formattedMessages.push({
          id: `evt-${evt.id}`,
          type: 'outbound',
          subject: meta.subject || 'Property Inquiry',
          content: meta.body || meta.content || 'Email sent',
          status: 'delivered',
          sentAt: evt.created_at,
          channel: 'email',
        });
      }
    } else if (evt.direction === 'inbound') {
      formattedMessages.push({
        id: `evt-${evt.id}`,
        type: 'inbound',
        content: meta.content || meta.body || meta.message || 'Reply received',
        status: 'received',
        sentAt: evt.created_at,
        channel: meta.channel || 'email',
      });
    }
  }

  // Sort by date and remove duplicates
  formattedMessages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  // Dedupe by content similarity (within 5 min window)
  const deduped = formattedMessages.filter((msg, idx, arr) => {
    if (idx === 0) return true;
    const prev = arr[idx - 1];
    const timeDiff = Math.abs(new Date(msg.sentAt).getTime() - new Date(prev.sentAt).getTime());
    if (timeDiff < 300000 && msg.type === prev.type && msg.content === prev.content) {
      return false;
    }
    return true;
  });

  return {
    prospectId,
    prospectName: lead?.name || 'Unknown',
    prospectEmail: lead?.email,
    touchCount: lead?.touch_number || deduped.filter(m => m.type === 'outbound').length,
    queueStatus: lead?.queue_status,
    expectedValue: lead?.expected_value,
    messages: deduped,
  };
}

async function getPipelineData() {
  // Get leads with their pipeline status - prioritize leads in queue with activity
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

  // Count by phase
  const phaseCounts = {};
  const tierCounts = { hot: 0, warm: 0, cold: 0 };

  for (const lead of leads) {
    const phase = lead.phase || 'new';
    const tier = lead.tier || 'cold';
    phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
    tierCounts[tier] = (tierCounts[tier] || 0) + 1;
  }

  // Enrich leads with message history (REAL DATA ONLY - no simulation)
  const enrichedLeads = leads.map(lead => {
    const leadMessages = messages.filter(m => {
      try {
        const payload = typeof m.payload === 'string' ? JSON.parse(m.payload) : m.payload;
        return payload?.leadId == lead.id || payload?.lead_id == lead.id || payload?.email === lead.email;
      } catch { return false; }
    });

    // Calculate tier based on score/sentiment if not set
    let tier = lead.tier || 'cold';
    const score = lead.score || 50;
    if (lead.reply_sentiment === 'positive' || score >= 80 || lead.queue_status === 'interested') {
      tier = 'hot';
    } else if (leadMessages.length > 0 || score >= 50 || lead.queue_status === 'replied') {
      tier = 'warm';
    }

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

  return {
    phases: PIPELINE_PHASES,
    tiers: TIERS,
    phaseCounts,
    tierCounts,
    prospects: enrichedLeads,
    totalProspects: enrichedLeads.length,
    recentMessages: messages.slice(0, 20).map(m => ({
      id: m.id,
      type: m.type,
      status: m.status,
      when: m.updated_at,
    })),
    // Enhanced analytics
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
  };
}

async function getMonitorData() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [
    jobStats,
    jobsByType,
    queueStats,
    emailStats,
    warmupConfig,
    recentErrors,
    hourlyVolume,
    recentActivity,
    leadStats,
    conversionStats,
    pipelineBreakdown,
    tierBreakdown,
    regionalStats,
  ] = await Promise.all([
    // Job status
    sql`SELECT status, COUNT(*)::int as count FROM jobs GROUP BY status`.catch(() => []),

    // Jobs by type
    sql`SELECT type, status, COUNT(*)::int as count FROM jobs GROUP BY type, status ORDER BY count DESC`.catch(() => []),

    // Queue status
    sql`SELECT status, COUNT(*)::int as count FROM campaign_lead_queue GROUP BY status`.catch(() => []),

    // Email stats - from jobs table (actual sends) + message_events
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM jobs WHERE type IN ('send_email', 'send_message') AND status = 'completed' AND updated_at >= ${todayStart.toISOString()}) as sent,
        (SELECT COUNT(*)::int FROM jobs WHERE type IN ('send_email', 'send_message') AND status = 'completed') as total_sent_all_time,
        (SELECT COUNT(*)::int FROM message_events WHERE status = 'delivered' AND created_at >= ${todayStart.toISOString()}) as delivered,
        (SELECT COUNT(*)::int FROM message_events WHERE status = 'opened' AND created_at >= ${todayStart.toISOString()}) as opened,
        (SELECT COUNT(*)::int FROM message_events WHERE status = 'clicked' AND created_at >= ${todayStart.toISOString()}) as clicked,
        (SELECT COUNT(*)::int FROM message_events WHERE status = 'bounced' AND created_at >= ${todayStart.toISOString()}) as bounced,
        (SELECT COUNT(*)::int FROM message_events WHERE status = 'complained' AND created_at >= ${todayStart.toISOString()}) as complained,
        (SELECT COUNT(*)::int FROM message_events WHERE status = 'unsubscribed' AND created_at >= ${todayStart.toISOString()}) as unsubscribed
    `.catch(() => [{ sent: 0, total_sent_all_time: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 }]),

    // Warmup config
    sql`SELECT daily_limit, paused, paused_reason, updated_at FROM email_warmup_config LIMIT 1`.catch(() => []),

    // Recent errors
    sql`
      SELECT id, type, error_message, attempts, max_attempts, updated_at
      FROM jobs WHERE status IN ('failed', 'dead')
      ORDER BY updated_at DESC LIMIT 10
    `.catch(() => []),

    // Hourly volume (from jobs completed)
    sql`
      SELECT
        date_trunc('hour', updated_at) as hour,
        COUNT(*)::int as count
      FROM jobs
      WHERE status = 'completed'
        AND updated_at > now() - interval '24 hours'
      GROUP BY date_trunc('hour', updated_at)
      ORDER BY hour DESC
      LIMIT 24
    `.catch(() => []),

    // Recent activity
    sql`
      SELECT type, status, created_at, updated_at
      FROM jobs
      ORDER BY updated_at DESC
      LIMIT 20
    `.catch(() => []),

    // Lead stats - total, with email, by source + messaging stats
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM leads) as total,
        (SELECT COUNT(*)::int FROM leads WHERE email IS NOT NULL) as with_email,
        (SELECT COUNT(*)::int FROM leads WHERE phone IS NOT NULL) as with_phone,
        (SELECT COUNT(*)::int FROM leads WHERE created_at > now() - interval '24 hours') as new_today,
        (SELECT COUNT(*)::int FROM leads WHERE created_at > now() - interval '7 days') as new_this_week,
        (SELECT COUNT(*)::int FROM jobs WHERE type IN ('send_email', 'send_message') AND status = 'completed') as total_messages_sent,
        (SELECT COUNT(DISTINCT (payload->>'leadId')::int)::int FROM jobs WHERE type IN ('send_email', 'send_message') AND status = 'completed' AND payload->>'leadId' IS NOT NULL) as unique_leads_contacted,
        (SELECT COUNT(*)::int FROM jobs WHERE type IN ('send_email', 'send_message') AND status = 'pending') as messages_pending
    `.catch(() => [{ total: 0, with_email: 0, with_phone: 0, new_today: 0, new_this_week: 0, total_messages_sent: 0, unique_leads_contacted: 0, messages_pending: 0 }]),

    // Conversion stats from queue
    sql`
      SELECT
        COUNT(*)::int as total_queued,
        COUNT(*) FILTER (WHERE status = 'queued')::int as awaiting_outreach,
        COUNT(*) FILTER (WHERE status = 'sent')::int as contacted,
        COUNT(*) FILTER (WHERE status = 'replied')::int as replied,
        COUNT(*) FILTER (WHERE status = 'interested')::int as interested,
        COUNT(*) FILTER (WHERE status = 'rejected')::int as rejected,
        COUNT(*) FILTER (WHERE status = 'dead')::int as dead,
        COUNT(*) FILTER (WHERE touch_number >= 1)::int as touched_once,
        COUNT(*) FILTER (WHERE touch_number >= 2)::int as touched_twice,
        COUNT(*) FILTER (WHERE touch_number >= 3)::int as touched_thrice
      FROM campaign_lead_queue
    `.catch(() => [{ total_queued: 0 }]),

    // Pipeline phase breakdown
    sql`
      SELECT
        COALESCE(metadata->>'phase', 'new') as phase,
        COUNT(*)::int as count
      FROM leads
      WHERE metadata->>'phase' IS NOT NULL
      GROUP BY metadata->>'phase'
      ORDER BY count DESC
    `.catch(() => []),

    // Tier breakdown - calculate based on queue status and scores dynamically
    sql`
      SELECT
        CASE
          WHEN clq.status IN ('interested', 'replied') OR COALESCE(FLOOR((l.metadata->>'motivationScore')::numeric)::int, (l.metadata->>'score')::int, 50) >= 80 THEN 'hot'
          WHEN clq.status = 'sent' OR COALESCE(FLOOR((l.metadata->>'motivationScore')::numeric)::int, (l.metadata->>'score')::int, 50) >= 50 THEN 'warm'
          ELSE 'cold'
        END as tier,
        COUNT(*)::int as count,
        COALESCE(AVG(FLOOR((l.metadata->>'motivationScore')::numeric))::int, 50) as avg_score
      FROM leads l
      LEFT JOIN campaign_lead_queue clq ON clq.lead_id = l.id
      WHERE l.email IS NOT NULL
      GROUP BY
        CASE
          WHEN clq.status IN ('interested', 'replied') OR COALESCE(FLOOR((l.metadata->>'motivationScore')::numeric)::int, (l.metadata->>'score')::int, 50) >= 80 THEN 'hot'
          WHEN clq.status = 'sent' OR COALESCE(FLOOR((l.metadata->>'motivationScore')::numeric)::int, (l.metadata->>'score')::int, 50) >= 50 THEN 'warm'
          ELSE 'cold'
        END
    `.catch(() => []),

    // Regional stats - extract state from various metadata fields
    sql`
      SELECT
        COALESCE(
          metadata->>'state',
          CASE
            WHEN metadata->>'fullAddress' ILIKE '%TX%' OR metadata->>'fullAddress' ILIKE '%Texas%' THEN 'TX'
            WHEN metadata->>'fullAddress' ILIKE '%FL%' OR metadata->>'fullAddress' ILIKE '%Florida%' THEN 'FL'
            WHEN metadata->>'fullAddress' ILIKE '%CA%' OR metadata->>'fullAddress' ILIKE '%California%' THEN 'CA'
            WHEN metadata->>'fullAddress' ILIKE '%NY%' OR metadata->>'fullAddress' ILIKE '%New York%' THEN 'NY'
            WHEN metadata->>'fullAddress' ILIKE '%OH%' OR metadata->>'fullAddress' ILIKE '%Ohio%' THEN 'OH'
            WHEN metadata->>'fullAddress' ILIKE '%PA%' OR metadata->>'fullAddress' ILIKE '%Pennsylvania%' THEN 'PA'
            WHEN metadata->>'fullAddress' ILIKE '%GA%' OR metadata->>'fullAddress' ILIKE '%Georgia%' THEN 'GA'
            WHEN metadata->>'fullAddress' ILIKE '%NC%' OR metadata->>'fullAddress' ILIKE '%North Carolina%' THEN 'NC'
            WHEN metadata->>'fullAddress' ILIKE '%AZ%' OR metadata->>'fullAddress' ILIKE '%Arizona%' THEN 'AZ'
            WHEN metadata->>'fullAddress' ILIKE '%IL%' OR metadata->>'fullAddress' ILIKE '%Illinois%' THEN 'IL'
            ELSE 'Other'
          END
        ) as region,
        COUNT(*)::int as count,
        AVG(COALESCE((metadata->>'propertyValue')::int, (metadata->>'estimatedValue')::int, 150000))::int as avg_value
      FROM leads
      WHERE email IS NOT NULL
      GROUP BY
        COALESCE(
          metadata->>'state',
          CASE
            WHEN metadata->>'fullAddress' ILIKE '%TX%' OR metadata->>'fullAddress' ILIKE '%Texas%' THEN 'TX'
            WHEN metadata->>'fullAddress' ILIKE '%FL%' OR metadata->>'fullAddress' ILIKE '%Florida%' THEN 'FL'
            WHEN metadata->>'fullAddress' ILIKE '%CA%' OR metadata->>'fullAddress' ILIKE '%California%' THEN 'CA'
            WHEN metadata->>'fullAddress' ILIKE '%NY%' OR metadata->>'fullAddress' ILIKE '%New York%' THEN 'NY'
            WHEN metadata->>'fullAddress' ILIKE '%OH%' OR metadata->>'fullAddress' ILIKE '%Ohio%' THEN 'OH'
            WHEN metadata->>'fullAddress' ILIKE '%PA%' OR metadata->>'fullAddress' ILIKE '%Pennsylvania%' THEN 'PA'
            WHEN metadata->>'fullAddress' ILIKE '%GA%' OR metadata->>'fullAddress' ILIKE '%Georgia%' THEN 'GA'
            WHEN metadata->>'fullAddress' ILIKE '%NC%' OR metadata->>'fullAddress' ILIKE '%North Carolina%' THEN 'NC'
            WHEN metadata->>'fullAddress' ILIKE '%AZ%' OR metadata->>'fullAddress' ILIKE '%Arizona%' THEN 'AZ'
            WHEN metadata->>'fullAddress' ILIKE '%IL%' OR metadata->>'fullAddress' ILIKE '%Illinois%' THEN 'IL'
            ELSE 'Other'
          END
        )
      ORDER BY count DESC
      LIMIT 10
    `.catch(() => []),
  ]);

  const stats = emailStats[0] || { sent: 0, total_sent_all_time: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0 };
  const totalSent = stats.sent || 1;
  const totalSentAllTime = stats.total_sent_all_time || 0;
  const warmup = warmupConfig[0] || { daily_limit: 150000, paused: false };

  // Build job totals
  const jobTotals = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
  for (const j of jobStats) {
    jobTotals[j.status] = j.count;
  }

  // Build queue totals
  const queueTotals = { queued: 0, sent: 0, completed: 0, failed: 0 };
  for (const q of queueStats) {
    queueTotals[q.status] = q.count;
  }

  // Build jobs by type
  const byType = {};
  for (const j of jobsByType) {
    if (!byType[j.type]) byType[j.type] = 0;
    byType[j.type] += j.count;
  }

  return {
    timestamp: now.toISOString(),
    campaign: {
      status: warmup.paused ? 'PAUSED' : 'ACTIVE',
      dailyTarget: warmup.daily_limit || 150000,
      dailySent: stats.sent,
      progress: ((stats.sent / (warmup.daily_limit || 150000)) * 100).toFixed(2),
      feeRange: { min: 10000, max: 30000 },
    },
    jobs: {
      ...jobTotals,
      byType,
      breakdown: jobStats,
    },
    queue: {
      ...queueTotals,
      breakdown: queueStats,
    },
    emails: {
      today: { ...stats, total: stats.sent },
      allTime: {
        sent: totalSentAllTime,
      },
      quality: {
        bounceRate: ((stats.bounced / totalSent) * 100).toFixed(2),
        complaintRate: ((stats.complained / totalSent) * 100).toFixed(3),
        unsubRate: ((stats.unsubscribed / totalSent) * 100).toFixed(2),
        deliveryRate: ((stats.delivered / totalSent) * 100).toFixed(1),
        openRate: stats.delivered > 0 ? ((stats.opened / stats.delivered) * 100).toFixed(1) : '0.0',
        clickRate: stats.opened > 0 ? ((stats.clicked / stats.opened) * 100).toFixed(1) : '0.0',
      },
      gates: {
        bounce: { threshold: 5, current: parseFloat(((stats.bounced / totalSent) * 100).toFixed(2)), status: stats.bounced / totalSent < 0.05 ? 'ok' : 'warning' },
        complaint: { threshold: 0.1, current: parseFloat(((stats.complained / totalSent) * 100).toFixed(3)), status: stats.complained / totalSent < 0.001 ? 'ok' : 'warning' },
        unsub: { threshold: 2, current: parseFloat(((stats.unsubscribed / totalSent) * 100).toFixed(2)), status: stats.unsubscribed / totalSent < 0.02 ? 'ok' : 'warning' },
      },
    },
    warmup: {
      dailyLimit: warmup.daily_limit,
      paused: warmup.paused,
      pausedReason: warmup.paused_reason,
      updatedAt: warmup.updated_at,
    },
    health: {
      lastCheck: now.toISOString(),
      status: jobTotals.dead > 0 || jobTotals.failed > 10 ? 'issues'
            : recentErrors.length > 0 ? 'warning'
            : jobTotals.pending > 0 ? 'healthy'
            : 'idle',
      interval: 'real-time',
      healer: jobTotals.dead === 0 && jobTotals.failed < 10 ? 'active' : 'needs-attention',
      metrics: {
        pendingJobs: jobTotals.pending,
        failedJobs: jobTotals.failed,
        deadJobs: jobTotals.dead,
        recentErrors: recentErrors.length,
        queuedLeads: queueTotals.queued || 0,
        isProcessing: jobTotals.pending > 0 || jobTotals.processing > 0,
      },
    },
    errors: recentErrors.map(e => ({
      id: e.id,
      type: e.type,
      message: (e.error_message || '').slice(0, 100),
      attempts: `${e.attempts}/${e.max_attempts}`,
      when: e.updated_at,
    })),
    hourlyVolume: hourlyVolume,
    recentActivity: recentActivity.slice(0, 10).map(a => ({
      type: a.type,
      status: a.status,
      when: a.updated_at,
    })),
    // CRM & Conversion Data
    crm: {
      leads: {
        total: leadStats[0]?.total || 0,
        with_email: leadStats[0]?.with_email || 0,
        with_phone: leadStats[0]?.with_phone || 0,
        new_today: leadStats[0]?.new_today || 0,
        new_this_week: leadStats[0]?.new_this_week || 0,
        total_messages_sent: leadStats[0]?.total_messages_sent || 0,
        unique_leads_contacted: leadStats[0]?.unique_leads_contacted || 0,
        messages_pending: leadStats[0]?.messages_pending || 0,
      },
      conversion: {
        ...(conversionStats[0] || {}),
        // Calculate conversion rates
        contactRate: conversionStats[0]?.total_queued > 0
          ? ((conversionStats[0].contacted / conversionStats[0].total_queued) * 100).toFixed(1)
          : '0.0',
        replyRate: conversionStats[0]?.contacted > 0
          ? ((conversionStats[0].replied / conversionStats[0].contacted) * 100).toFixed(1)
          : '0.0',
        interestRate: conversionStats[0]?.replied > 0
          ? ((conversionStats[0].interested / conversionStats[0].replied) * 100).toFixed(1)
          : '0.0',
        overallConversion: conversionStats[0]?.total_queued > 0
          ? ((conversionStats[0].interested / conversionStats[0].total_queued) * 100).toFixed(2)
          : '0.00',
      },
      pipeline: pipelineBreakdown.reduce((acc, p) => { acc[p.phase] = p.count; return acc; }, {}),
      tiers: tierBreakdown.reduce((acc, t) => {
        acc[t.tier] = { count: t.count, avgScore: t.avg_score };
        return acc;
      }, {}),
      regions: regionalStats.map(r => ({
        region: r.region,
        count: r.count,
        avgValue: r.avg_value,
      })),
    },
    // Funnel visualization data
    funnel: {
      stages: [
        { name: 'Total Leads', count: leadStats[0]?.total || 0, color: 'slate' },
        { name: 'Queued', count: conversionStats[0]?.total_queued || 0, color: 'blue' },
        { name: 'Contacted', count: conversionStats[0]?.contacted || 0, color: 'cyan' },
        { name: 'Replied', count: conversionStats[0]?.replied || 0, color: 'violet' },
        { name: 'Interested', count: conversionStats[0]?.interested || 0, color: 'emerald' },
      ],
    },
  };
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/campaigns/monitor' || url.pathname === '/') {
    try {
      const data = await getMonitorData();
      res.writeHead(200);
      res.end(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Monitor error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  } else if (url.pathname.match(/^\/api\/prospects\/\d+\/messages$/)) {
    try {
      const prospectId = url.pathname.split('/')[3];
      const data = await getProspectMessages(parseInt(prospectId));
      res.writeHead(200);
      res.end(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Messages error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  } else if (url.pathname === '/api/campaigns/pipeline') {
    try {
      const data = await getPipelineData();
      res.writeHead(200);
      res.end(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Pipeline error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: error.message }));
    }
  } else if (url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, time: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  CAMPAIGN MONITOR API                                      ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  API:       http://localhost:${PORT}/api/campaigns/monitor    ║`);
  console.log(`║  Dashboard: http://localhost:4000/monitor.html             ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});
