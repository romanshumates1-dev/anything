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
import { getVoiceGateway } from '@/app/api/gateway/voice-gateway';

export type CadencePayload = {
  contactId: string;
  campaignId: string;
  organizationId: string;
  phone: string;
  sequenceOrder: number;
  templateId: string;
  body: string;
};

/** Consent basis attached to campaign sends when the owner attested the list
 *  (outreach_campaigns.consent_confirmed_at). Required by the gate for voice/RVM. */
export const CONSENT_BASIS_ATTESTED = 'manual-list-attested';

export type VoicePayload = {
  contactId: string;
  campaignId: string;
  organizationId: string;
  phone: string;
  leadId: number | string | null;
  consentBasis: string | null;
};

/**
 * Queue the OPENING send for every fresh contact of a campaign (the T+0 step —
 * this is what STARTS the ladder; scheduleNextStep then advances it after each
 * successful send). Flag-gated: with cadenceEngine OFF this is a no-op, so
 * starting a campaign behaves exactly as it did pre-INT-4 (status flip only).
 * Dedupe `open:{campaignId}:{contactId}` is at-most-once EVER — a relaunch can
 * never resend an opening, even after the original job completed.
 */
export async function dispatchOpenings(
  campaignId: string,
  organizationId: string
): Promise<{ queued: number; reason?: string }> {
  if (!(await isBetaFlagOn('cadenceEngine'))) {
    return { queued: 0, reason: 'flag_off' };
  }

  const [campaign] = await sql`
    SELECT * FROM outreach_campaigns
    WHERE id = ${campaignId} AND organization_id = ${organizationId}
  `;
  if (!campaign) return { queued: 0, reason: 'campaign_not_found' };

  const [opening] = await sql`
    SELECT * FROM campaign_message_templates
    WHERE campaign_id = ${campaignId} AND kind = 'OPENING' AND is_active = true
    ORDER BY sequence_order ASC
    LIMIT 1
  `;
  if (!opening) return { queued: 0, reason: 'no_opening_template' };

  const consentBasis = campaign.consent_confirmed_at ? CONSENT_BASIS_ATTESTED : null;

  const contacts = await sql`
    SELECT * FROM campaign_contacts
    WHERE campaign_id = ${campaignId}
      AND COALESCE(follow_ups_sent, 0) = 0
      AND status <> 'OPTED_OUT'
      AND opted_out_at IS NULL
      AND last_reply_at IS NULL
  `;

  let queued = 0;
  let i = 0;
  for (const c of contacts) {
    const jobId = await enqueueJob(
      'send_message',
      {
        leadId: c.seller_lead_id || c.buyer_lead_id,
        to: c.phone,
        text: opening.body,
        campaignId,
        organizationId,
        contactId: c.id,
        channel: 'sms',
        isOpening: true,
        consentBasis,
      },
      // 2s spacing is pacing, not compliance — the gate + pool caps enforce
      // the real limits at transmit time.
      { runAt: new Date(Date.now() + i * 2000), dedupeKey: `open:${campaignId}:${c.id}` }
    );
    if (jobId) queued++;
    i++;
  }

  await logEvent('cadence_openings_queued', 'campaign', campaignId, { queued }, organizationId);
  return { queued };
}

/**
 * Schedule the T+60s voice escalation after a successful OPENING send.
 * voiceEscalation flag OFF (the default) → no job, zero events.
 */
export async function scheduleVoiceStep(payload: VoicePayload): Promise<string | null> {
  if (!(await isBetaFlagOn('voiceEscalation'))) return null;
  return enqueueJob('voice_call', payload, {
    runAt: new Date(Date.now() + 60_000),
    dedupeKey: `voice:${payload.contactId}:1`,
  });
}

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
      channel: template.channel || 'sms',
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
    WHERE type IN ('cadence_step', 'voice_call')
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
  /** Set on time-based gate denials: jobs.ts defers THE SAME job row to this
   *  instant. Never re-enqueue with the in-flight dedupe key — the unique
   *  index spans processing/completed rows, so the insert silently no-ops and
   *  the step is lost (bug #12, found live against the real index). */
  deferAt?: Date;
  gateCode?: string;
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

  // Resolve channel from the template (defaults to 'sms' for pre-migration rows)
  const templateChannel: string = (payload as any).channel || 'sms';

  // dispatchGate at send time for fresh compliance
  // FIX: Map 'call' to 'voice' instead of 'sms' to enforce voice consent requirements.
  // Voice calls require prior express consent under TCPA, different from SMS.
  const gate = await dispatchGate({
    phone: templateChannel === 'sms' || templateChannel === 'call' ? payload.phone : '',
    email: templateChannel === 'email' ? ((payload as any).email || '') : undefined,
    channel: templateChannel === 'call' ? 'voice' : templateChannel as any,
    betaFlag: 'cadenceEngine',
    isCadenceStep: true,
    // Pass consent basis for voice channel
    consentBasis: templateChannel === 'call' ? CONSENT_BASIS_ATTESTED : undefined,
  });
  if (!gate.allow) {
    return { sent: false, reason: `gate:${gate.code}`, gateCode: gate.code, deferAt: gate.retryAt };
  }

  if (templateChannel === 'email') {
    const leadId = contact.seller_lead_id || contact.buyer_lead_id;
    const [lead] = await sql`SELECT email FROM leads WHERE id = ${leadId} LIMIT 1`;
    const email = lead?.email || (payload as any).email;
    if (!email) {
      return { sent: false, reason: 'no_email_for_lead' };
    }
    await enqueueJob('send_email', {
      leadId,
      to: email,
      subject: (payload as any).subject || 'Regarding your property',
      body: payload.body,
      campaignId: payload.campaignId,
      organizationId: payload.organizationId,
      contactId: payload.contactId,
    });
  } else if (templateChannel === 'call') {
    await sql`
      INSERT INTO call_attempts (organization_id, lead_id, outcome, notes, attempt_number)
      VALUES (
        ${payload.organizationId},
        ${contact.seller_lead_id || contact.buyer_lead_id},
        'scheduled',
        ${`Cadence step ${payload.sequenceOrder}: ${payload.body.slice(0, 200)}`},
        0
      )
    `;
  } else {
    await enqueueJob('send_message', {
      leadId: contact.seller_lead_id || contact.buyer_lead_id,
      to: payload.phone,
      text: payload.body,
      campaignId: payload.campaignId,
      organizationId: payload.organizationId,
      contactId: payload.contactId,
      channel: 'sms',
    });
  }

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

/**
 * Process a voice_call job — the ladder's T+60s escalation step.
 * Same freshness re-checks as an SMS step; the compliance gate itself runs
 * INSIDE VoiceGateway.call (at the dial hop). Same-row deferral contract as
 * processCadenceStep: never re-enqueue an in-flight dedupe key.
 */
export async function processVoiceStep(payload: VoicePayload): Promise<{
  dialed: boolean;
  reason: string;
  deferAt?: Date;
  gateCode?: string;
}> {
  if (!(await isBetaFlagOn('voiceEscalation'))) {
    return { dialed: false, reason: 'flag_off' };
  }

  const [contact] = await sql`
    SELECT * FROM campaign_contacts WHERE id = ${payload.contactId}
  `;
  if (!contact) return { dialed: false, reason: 'contact_deleted' };
  if (contact.status === 'OPTED_OUT' || contact.opted_out_at) {
    return { dialed: false, reason: 'opted_out' };
  }
  if (contact.last_reply_at) return { dialed: false, reason: 'replied' };

  const gateway = getVoiceGateway();
  const record = await gateway.call({
    leadId: payload.leadId ?? 0,
    to: payload.phone,
    channel: 'voice',
    campaignId: payload.campaignId,
    organizationId: payload.organizationId,
    contactId: payload.contactId,
    consentBasis: payload.consentBasis ?? undefined,
  });

  if (record.gateCode) {
    return {
      dialed: false,
      reason: `gate:${record.gateCode}`,
      gateCode: record.gateCode,
      deferAt: record.retryAt,
    };
  }
  if (record.status === 'failed') {
    return { dialed: false, reason: record.errorMessage || 'provider_failed' };
  }

  // Outcome → state machine. Voice intents take the EXACT transitions SMS
  // replies already use (owner: never invent voice-specific states):
  //  - answered + transcript ⇒ the sms/inbound transitions verbatim —
  //    conversation history append, requires_human=true, needs_review, and
  //    the ladder halts (last_reply_at + cancelCadence). Price-bearing
  //    transcripts therefore land in the SAME human-review queue as price
  //    texts; the AI never answers a number on any channel.
  //  - voicemail ⇒ the no-numbers script was dropped; ladder continues.
  //  - no_answer ⇒ nothing; ladder continues.
  if (record.outcome === 'answered' && record.transcript) {
    if (payload.leadId) {
      const [conv] = await sql`
        INSERT INTO ai_conversations (lead_id, channel, history)
        VALUES (${payload.leadId}, 'voice', '[]'::jsonb)
        ON CONFLICT (lead_id) DO UPDATE SET last_message_at = NOW()
        RETURNING *
      `;
      await sql`
        UPDATE ai_conversations
        SET history = history || ${JSON.stringify([{ role: 'user', content: record.transcript }])}::jsonb,
            requires_human = true,
            status = 'needs_review',
            last_message_at = NOW()
        WHERE id = ${conv.id}
      `;
    }
    await sql`
      UPDATE campaign_contacts
      SET last_reply_at = now(), updated_at = now()
      WHERE id = ${payload.contactId}
    `;
    await cancelCadence(payload.contactId);
  }

  await logEvent(
    'cadence_voice_step',
    'campaign_contact',
    payload.contactId,
    {
      campaignId: payload.campaignId,
      callUuid: record.callUuid,
      status: record.status,
      outcome: record.outcome,
      answered: record.outcome === 'answered',
    },
    payload.organizationId
  );

  return { dialed: true, reason: record.outcome ?? record.status };
}
