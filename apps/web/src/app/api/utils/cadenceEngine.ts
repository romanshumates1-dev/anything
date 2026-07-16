/**
 * INT-4 — Cadence Engine
 *
 * Replaces the polling-based followUpScheduler with a job-queue-driven approach.
 * Each follow-up step is a `cadence_step` job row with run_at + dedupe_key.
 *
 * Design:
 * - When a campaign contact is first sent (opening), schedule follow-up 1
 * - When a cadence_step job fires, send the message and schedule the next step
 * - Reply or DNC opt-out cancels all pending steps for that contact
 * - dispatchGate is called at send time (not schedule time) for fresh compliance
 * - dedupe_key prevents duplicate steps: `cadence:{contactId}:{sequenceOrder}`
 */
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { dispatchGate } from '@/app/api/utils/dispatchGate';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { logEvent } from '@/app/api/utils/logger';

export type CadencePayload = {
  contactId: string;
  campaignId: string;
  organizationId: string;
  phone: string;
  sequenceOrder: number;
  templateId: string;
  body: string;
};

/**
 * Schedule the next cadence step for a contact.
 * Called after the opening send or after each follow-up send.
 * Returns the job id or null if no next step / flag off / error.
 */
export async function scheduleNextStep(
  contactId: string,
  campaignId: string,
  organizationId: string
): Promise<string | null> {
  // Beta flag guard: cadenceEngine must be ON
  if (!(await isBetaFlagOn('cadenceEngine'))) {
    return null;
  }

  // Find the contact and its current follow-up count
  const [contact] = await sql`
    SELECT cc.*, oc.direction, oc.organization_id
    FROM campaign_contacts cc
    JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
    WHERE cc.id = ${contactId}
  `;
  if (!contact) return null;

  const nextOrder = (contact.follow_ups_sent ?? 0) + 1;

  // Find the template for the next step
  const [template] = await sql`
    SELECT * FROM campaign_message_templates
    WHERE campaign_id = ${campaignId}
      AND kind = 'FOLLOW_UP'
      AND sequence_order = ${nextOrder}
      AND is_active = true
    ORDER BY sequence_order ASC
    LIMIT 1
  `;
  if (!template) return null; // no more follow-ups configured

  const runAt = new Date(Date.now() + (template.delay_hours ?? 24) * 3600_000);
  const dedupeKey = `cadence:${contactId}:${nextOrder}`;

  const jobId = await enqueueJob(
    'cadence_step',
    {
      contactId,
      campaignId,
      organizationId: organizationId || contact.organization_id,
      phone: contact.phone,
      sequenceOrder: nextOrder,
      templateId: template.id,
      body: template.body,
    },
    { runAt, dedupeKey }
  );

  return jobId;
}

/**
 * Cancel all pending cadence steps for a contact.
 * Called on reply (inbound) or DNC opt-out.
 */
export async function cancelCadence(contactId: string): Promise<void> {
  await sql`
    UPDATE jobs
    SET status = 'cancelled', updated_at = now()
    WHERE type = 'cadence_step'
      AND status IN ('pending', 'failed')
      AND payload->>'contactId' = ${contactId}
  `;
}

/**
 * Process a cadence_step job.
 * This is called by the job processor (jobs.ts) when a cadence_step job fires.
 */
export async function processCadenceStep(payload: CadencePayload): Promise<{
  sent: boolean;
  reason: string;
  nextJobId?: string | null;
}> {
  // Beta flag guard at send time (not schedule time)
  if (!(await isBetaFlagOn('cadenceEngine'))) {
    return { sent: false, reason: 'flag_off' };
  }

  // Re-fetch contact state — it may have changed since scheduling
  const [contact] = await sql`
    SELECT * FROM campaign_contacts WHERE id = ${payload.contactId}
  `;
  if (!contact) {
    return { sent: false, reason: 'contact_deleted' };
  }
  if (contact.status === 'OPTED_OUT' || contact.opted_out_at) {
    return { sent: false, reason: 'opted_out' };
  }
  if (contact.last_reply_at) {
    return { sent: false, reason: 'replied' };
  }

  // dispatchGate at send time for fresh compliance
  const gate = await dispatchGate({
    phone: payload.phone,
    channel: 'sms',
    betaFlag: 'cadenceEngine',
    isCadenceStep: true,
  });
  if (!gate.allow) {
    // Reschedule at retryAt if provided, otherwise let the job fail for retry
    if (gate.retryAt) {
      const dedupeKey = `cadence:${payload.contactId}:${payload.sequenceOrder}`;
      await enqueueJob('cadence_step', payload, {
        runAt: gate.retryAt,
        dedupeKey,
      });
    }
    return { sent: false, reason: `gate:${gate.code}` };
  }

  // Enqueue the actual send_message job (which goes through the gateway)
  await enqueueJob('send_message', {
    leadId: contact.seller_lead_id || contact.buyer_lead_id,
    to: payload.phone,
    text: payload.body,
    campaignId: payload.campaignId,
    organizationId: payload.organizationId,
    contactId: payload.contactId,
    channel: 'sms',
  });

  // Update contact state
  await sql`
    UPDATE campaign_contacts
    SET status = 'FOLLOWED_UP',
        follow_ups_sent = follow_ups_sent + 1,
        last_message_at = now(),
        updated_at = now()
    WHERE id = ${payload.contactId}
  `;

  // Schedule the next step
  const nextJobId = await scheduleNextStep(
    payload.contactId,
    payload.campaignId,
    payload.organizationId
  );

  await logEvent(
    'cadence_step_sent',
    'campaign_contact',
    payload.contactId,
    { campaignId: payload.campaignId, sequenceOrder: payload.sequenceOrder },
    payload.organizationId
  );

  return { sent: true, reason: 'sent', nextJobId };
}
