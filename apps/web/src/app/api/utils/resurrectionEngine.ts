/**
 * Resurrection Engine — re-touch contacts already paid for.
 *
 * Economics: acquisition is $0.09–0.17/contact. A resurrection touch is
 * ~$0.011 (SMS) or ~$0.000 (email). ~80% of wholesale contracts close on
 * follow-up day 31–180. This is the highest-ROI code in the system.
 *
 * MANDATORY INVARIANT: opted-out contacts are NEVER resurrected.
 * This is enforced at the query level (NOT EXISTS on compliance_records)
 * AND at the dispatchGate call — two independent layers.
 *
 * Sequences fire at 30/60/90/180 days for COLD and DEAL_NO_AGREEMENT leads.
 * Each sequence is idempotent via resurrection_sent_log's UNIQUE constraint
 * on (organization_id, lead_id, sequence_day).
 */
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { logEvent } from '@/app/api/utils/logger';

export interface ResurrectionSequence {
  day: number;
  channel: 'sms' | 'email';
  template: string;
}

export interface ResurrectionConfig {
  enabled: boolean;
  sequences: ResurrectionSequence[];
  targetStatuses: string[];
  monthlyMax: number;
}

const DEFAULT_SEQUENCES: ResurrectionSequence[] = [
  { day: 30, channel: 'email', template: "Just checking in — is {property_address} still something you might consider selling?" },
  { day: 60, channel: 'sms', template: "Hi {first_name}, we reached out about {property_address} a while back. Still have any interest in a cash offer?" },
  { day: 90, channel: 'email', template: "Following up on {property_address}. Our offer still stands if timing works better now." },
  { day: 180, channel: 'sms', template: "Hi {first_name}, last check-in on {property_address}. If you ever want a no-obligation cash offer, just reply here." },
];

const DEFAULT_CONFIG: ResurrectionConfig = {
  enabled: true,
  sequences: DEFAULT_SEQUENCES,
  targetStatuses: ['COLD', 'DEAL_NO_AGREEMENT'],
  monthlyMax: 10000,
};

export async function getResurrectionConfig(organizationId: string): Promise<ResurrectionConfig> {
  const rows = await sql`
    SELECT enabled, sequences, target_statuses, monthly_max
    FROM resurrection_campaign_config
    WHERE organization_id = ${organizationId}
    LIMIT 1
  `;
  if (rows.length === 0) return DEFAULT_CONFIG;
  const r = rows[0] as any;
  // Fix: the driver returns a plain array, not an object with .rows
  return {
    enabled: r.enabled ?? true,
    sequences: Array.isArray(r.sequences) ? r.sequences : DEFAULT_SEQUENCES,
    targetStatuses: Array.isArray(r.target_statuses) ? r.target_statuses : DEFAULT_CONFIG.targetStatuses,
    monthlyMax: r.monthly_max ?? DEFAULT_CONFIG.monthlyMax,
  };
}

function interpolate(template: string, lead: any): string {
  const meta = lead.metadata ?? {};
  return template
    .replace(/{first_name}/g, (lead.name ?? '').split(' ')[0] || 'there')
    .replace(/{property_address}/g, meta.property_address ?? 'your property')
    .replace(/{name}/g, lead.name ?? 'there');
}

/**
 * Run resurrection for one organization. Called by the scheduler cron.
 * Returns counts of sends queued and skipped.
 */
export async function runResurrection(organizationId: string): Promise<{
  queued: number;
  skipped: number;
  reason?: string;
}> {
  if (!(await isBetaFlagOn('resurrection'))) {
    return { queued: 0, skipped: 0, reason: 'flag_off' };
  }

  const config = await getResurrectionConfig(organizationId);
  if (!config.enabled) {
    return { queued: 0, skipped: 0, reason: 'disabled' };
  }

  // Monthly cap check
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [monthCount] = await sql`
    SELECT COUNT(*) as cnt FROM resurrection_sent_log
    WHERE organization_id = ${organizationId}
      AND created_at >= ${monthStart}
      AND status = 'sent'
  `;
  const sentThisMonth = Number((monthCount as any)?.cnt ?? 0);
  if (sentThisMonth >= config.monthlyMax) {
    return { queued: 0, skipped: 0, reason: 'monthly_max_reached' };
  }

  const now = new Date();
  let queued = 0;
  let skipped = 0;

  for (const seq of config.sequences) {
    const cutoffDate = new Date(now.getTime() - seq.day * 24 * 3600_000);
    const windowStart = new Date(cutoffDate.getTime() - 2 * 24 * 3600_000); // ±2 day window

    // Find eligible leads:
    // - correct status
    // - last contacted around seq.day days ago
    // - NOT opted out (enforced at query level — not just application code)
    // - NOT already sent this sequence day
    const leads = await sql`
      SELECT l.id, l.name, l.phone, l.email, l.status, l.metadata
      FROM leads l
      WHERE l.organization_id = ${organizationId}
        AND l.status = ANY(${config.targetStatuses})
        AND l.updated_at BETWEEN ${windowStart} AND ${cutoffDate}
        AND l.phone IS NOT NULL
        -- MANDATORY: opted-out contacts are NEVER resurrected
        AND NOT EXISTS (
          SELECT 1 FROM compliance_records cr
          WHERE cr.target = l.phone AND cr.type = 'opt-out'
        )
        AND (l.email IS NULL OR NOT EXISTS (
          SELECT 1 FROM compliance_records cr
          WHERE cr.target = LOWER(l.email) AND cr.type = 'opt-out'
        ))
        -- Idempotency: never re-send the same sequence day
        AND NOT EXISTS (
          SELECT 1 FROM resurrection_sent_log rsl
          WHERE rsl.organization_id = ${organizationId}
            AND rsl.lead_id = l.id
            AND rsl.sequence_day = ${seq.day}
        )
      LIMIT ${Math.min(500, config.monthlyMax - sentThisMonth - queued)}
    `;

    for (const lead of leads as any[]) {
      const text = interpolate(seq.template, lead);

      try {
        if (seq.channel === 'email' && lead.email) {
          await enqueueJob('send_email', {
            leadId: lead.id,
            to: lead.email,
            subject: 'Regarding your property',
            body: text,
            organizationId,
            source: 'resurrection',
          }, { dedupeKey: `resurrection:${organizationId}:${lead.id}:${seq.day}:email` });
        } else if (seq.channel === 'sms' && lead.phone) {
          await enqueueJob('send_message', {
            leadId: lead.id,
            to: lead.phone,
            text,
            organizationId,
            channel: 'sms',
            source: 'resurrection',
          }, { dedupeKey: `resurrection:${organizationId}:${lead.id}:${seq.day}:sms` });
        } else {
          skipped++;
          continue;
        }

        // Record in sent log (idempotent via UNIQUE constraint)
        await sql`
          INSERT INTO resurrection_sent_log
            (organization_id, lead_id, sequence_day, channel, message_template, status)
          VALUES
            (${organizationId}, ${lead.id}, ${seq.day}, ${seq.channel}, ${seq.template}, 'sent')
          ON CONFLICT (organization_id, lead_id, sequence_day) DO NOTHING
        `;
        queued++;
      } catch {
        skipped++;
      }
    }
  }

  await logEvent('resurrection_run', 'system', organizationId, { queued, skipped }, organizationId);
  return { queued, skipped };
}
