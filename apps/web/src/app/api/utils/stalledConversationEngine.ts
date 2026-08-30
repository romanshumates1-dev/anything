/**
 * Stalled Conversation Recovery Engine
 *
 * Detects and re-engages conversations that went cold AFTER initial engagement.
 * This is distinct from:
 * - Resurrection Engine: re-touches 30-180 day old COLD leads that never engaged
 * - Cadence Engine: scheduled follow-ups for non-responsive leads
 *
 * This engine targets: leads that REPLIED but then went silent mid-conversation.
 * These are the highest-value recovery targets because they already showed interest.
 *
 * Trigger criteria:
 * - Lead replied at least once (last_reply_at IS NOT NULL)
 * - No activity for 48-168 hours (configurable stall threshold)
 * - Status is REPLIED, ENGAGED, or NEGOTIATING (not CONTRACTED or CLOSED)
 * - Not opted out
 *
 * Re-engagement strategy:
 * - 48h stall: Soft check-in ("Just following up...")
 * - 96h stall: Value reinforcement ("Quick reminder of what we discussed...")
 * - 168h stall: Last chance with urgency ("Before I close your file...")
 *
 * Research backing:
 * - SMS re-engagement within 48-72h has 3x higher response rate than cold outreach
 * - "Closing file" language creates urgency without being pushy (real estate industry standard)
 */
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { logEvent } from '@/app/api/utils/logger';

export interface StalledConversationConfig {
  enabled: boolean;
  thresholdHours: {
    softCheckIn: number;    // Default 48h
    valueReinforce: number; // Default 96h
    lastChance: number;     // Default 168h (1 week)
  };
  maxPerDay: number;
  templates: {
    softCheckIn: string;
    valueReinforce: string;
    lastChance: string;
  };
}

const DEFAULT_CONFIG: StalledConversationConfig = {
  enabled: true,
  thresholdHours: {
    softCheckIn: 48,
    valueReinforce: 96,
    lastChance: 168,
  },
  maxPerDay: 50,
  templates: {
    softCheckIn: "Hi {first_name}, just checking in on our conversation about {property_address}. Still interested in hearing our offer?",
    valueReinforce: "Hi {first_name}, wanted to follow up on {property_address}. We can still close quickly with cash if timing works for you. Any questions I can answer?",
    lastChance: "Hi {first_name}, before I close your file on {property_address} - is there anything holding you back? Happy to discuss if you're still considering.",
  },
};

export type StallLevel = 'softCheckIn' | 'valueReinforce' | 'lastChance';

export interface StalledLead {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  lastReplyAt: Date;
  status: string;
  hoursSinceReply: number;
  stallLevel: StallLevel;
  metadata: Record<string, any>;
  organizationId: string;
  campaignId: string | null;
}

function interpolateTemplate(template: string, lead: StalledLead): string {
  const meta = lead.metadata ?? {};
  const firstName = (lead.name ?? '').split(' ')[0] || 'there';
  const propertyAddress = meta.property_address ?? meta.address ?? 'your property';

  return template
    .replace(/{first_name}/g, firstName)
    .replace(/{property_address}/g, propertyAddress)
    .replace(/{name}/g, lead.name ?? 'there');
}

function getStallLevel(hoursSinceReply: number, config: StalledConversationConfig): StallLevel | null {
  const { thresholdHours } = config;

  if (hoursSinceReply >= thresholdHours.lastChance) {
    return 'lastChance';
  }
  if (hoursSinceReply >= thresholdHours.valueReinforce) {
    return 'valueReinforce';
  }
  if (hoursSinceReply >= thresholdHours.softCheckIn) {
    return 'softCheckIn';
  }
  return null;
}

/**
 * Get configuration for stalled conversation recovery
 */
export async function getStalledConfig(organizationId: string): Promise<StalledConversationConfig> {
  try {
    const [config] = await sql`
      SELECT stalled_conversation_config
      FROM organization_settings
      WHERE organization_id = ${organizationId}
    `;
    if (config?.stalled_conversation_config) {
      return { ...DEFAULT_CONFIG, ...config.stalled_conversation_config };
    }
  } catch {
    // Table may not exist yet
  }
  return DEFAULT_CONFIG;
}

/**
 * Find leads with stalled conversations that need re-engagement
 */
export async function findStalledConversations(
  organizationId: string,
  config: StalledConversationConfig
): Promise<StalledLead[]> {
  const minHours = config.thresholdHours.softCheckIn;
  const maxHours = config.thresholdHours.lastChance + 24; // Don't re-engage beyond last chance + 1 day

  const leads = await sql`
    SELECT
      l.id,
      l.name,
      l.phone,
      l.email,
      l.metadata,
      l.organization_id,
      clq.status,
      clq.campaign_id,
      clq.updated_at as last_reply_at,
      EXTRACT(EPOCH FROM (now() - clq.updated_at)) / 3600 as hours_since_reply
    FROM leads l
    JOIN campaign_lead_queue clq ON clq.lead_id = l.id
    WHERE l.organization_id = ${organizationId}
      AND clq.status IN ('replied', 'engaged', 'negotiating')
      AND clq.updated_at < now() - make_interval(hours => ${minHours})
      AND clq.updated_at > now() - make_interval(hours => ${maxHours})
      AND NOT EXISTS (
        SELECT 1 FROM compliance_records cr
        WHERE (cr.target = l.phone OR cr.target = l.email)
          AND cr.type = 'opt_out'
      )
      AND NOT EXISTS (
        SELECT 1 FROM stalled_conversation_log scl
        WHERE scl.lead_id = l.id
          AND scl.created_at > now() - interval '24 hours'
      )
    ORDER BY hours_since_reply DESC
    LIMIT ${config.maxPerDay}
  `;

  return leads.map((lead: any) => {
    const hoursSinceReply = parseFloat(lead.hours_since_reply);
    const stallLevel = getStallLevel(hoursSinceReply, config);

    return {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      lastReplyAt: new Date(lead.last_reply_at),
      status: lead.status,
      hoursSinceReply,
      stallLevel: stallLevel || 'softCheckIn',
      metadata: lead.metadata || {},
      organizationId: lead.organization_id,
      campaignId: lead.campaign_id,
    };
  }).filter((l: StalledLead) => l.stallLevel !== null);
}

/**
 * Queue re-engagement messages for stalled conversations
 */
export async function queueStalledReengagement(
  organizationId: string
): Promise<{ queued: number; skipped: number; reason?: string }> {
  // Check feature flag
  if (!(await isBetaFlagOn('stalledConversation'))) {
    return { queued: 0, skipped: 0, reason: 'flag_off' };
  }

  const config = await getStalledConfig(organizationId);
  if (!config.enabled) {
    return { queued: 0, skipped: 0, reason: 'disabled' };
  }

  const stalledLeads = await findStalledConversations(organizationId, config);
  if (stalledLeads.length === 0) {
    return { queued: 0, skipped: 0, reason: 'no_stalled_conversations' };
  }

  let queued = 0;
  let skipped = 0;

  for (const lead of stalledLeads) {
    if (!lead.phone) {
      skipped++;
      continue;
    }

    const template = config.templates[lead.stallLevel];
    const message = interpolateTemplate(template, lead);

    const jobId = await enqueueJob(
      'send_message',
      {
        leadId: lead.id,
        to: lead.phone,
        text: message,
        channel: 'sms',
        organizationId,
        isStalledReengagement: true,
        stallLevel: lead.stallLevel,
      },
      {
        runAt: new Date(),
        dedupeKey: `stalled:${lead.id}:${lead.stallLevel}`,
        maxAttempts: 2,
      }
    );

    if (jobId) {
      // Log the re-engagement attempt
      await sql`
        INSERT INTO stalled_conversation_log (
          organization_id, lead_id, stall_level, hours_stalled, template_used, created_at
        ) VALUES (
          ${organizationId}, ${lead.id}, ${lead.stallLevel},
          ${Math.round(lead.hoursSinceReply)}, ${lead.stallLevel}, now()
        )
      `.catch(() => {
        // Table may not exist - log but don't fail
        console.warn('[STALLED] stalled_conversation_log table not found');
      });

      queued++;
    } else {
      skipped++;
    }
  }

  await logEvent('stalled_reengagement_queued', 'system', 'stalled_engine', {
    queued,
    skipped,
    organizationId,
  });

  return { queued, skipped };
}

/**
 * Run stalled conversation recovery for all organizations.
 * Called by system cron job.
 */
export async function runStalledRecoveryAll(): Promise<{
  organizations: number;
  totalQueued: number;
  totalSkipped: number;
}> {
  const orgs = await sql`
    SELECT DISTINCT organization_id FROM leads
    WHERE created_at > now() - interval '180 days'
  `;

  let totalQueued = 0;
  let totalSkipped = 0;

  for (const org of orgs) {
    const result = await queueStalledReengagement(org.organization_id);
    totalQueued += result.queued;
    totalSkipped += result.skipped;
  }

  return {
    organizations: orgs.length,
    totalQueued,
    totalSkipped,
  };
}
