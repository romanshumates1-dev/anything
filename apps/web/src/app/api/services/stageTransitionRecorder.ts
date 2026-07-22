/**
 * Phase P4 — Stage transition recorder.
 *
 * Records every state-machine transition in the stage_transitions table
 * for funnel analytics. Called at every transition point in the system.
 */
import sql from '@/app/api/utils/sql';

export interface StageTransition {
  leadId: number;
  fromStage: string | null;
  toStage: string;
  campaignId?: string;
  profileId?: string;
  channel?: string;
  backfilled?: boolean;
}

/**
 * Record a stage transition. This is called at every state-machine transition
 * point in the system (lead import, campaign launch, inbound reply, AI reply,
 * approval, negotiation, contract signing, etc.).
 */
export async function recordStageTransition(transition: StageTransition): Promise<void> {
  try {
    await sql`
      INSERT INTO stage_transitions (lead_id, from_stage, to_stage, campaign_id, profile_id, channel, backfilled)
      VALUES (
        ${transition.leadId},
        ${transition.fromStage || null},
        ${transition.toStage},
        ${transition.campaignId || null},
        ${transition.profileId || null},
        ${transition.channel || null},
        ${transition.backfilled || false}
      )
    `;
  } catch (error) {
    // Non-critical — analytics should never block the main flow
    console.error('[stageTransitionRecorder] Failed to record transition', error);
  }
}

/**
 * Record the SAME stage transition for many leads in one round trip (used by
 * bulk lead creation, e.g. CSV import — up to MAX_IMPORT_ROWS/INSERT_CHUNK_SIZE
 * rows per call). Calling recordStageTransition() once per row would be one
 * network round trip per lead; this is one INSERT for the whole chunk instead.
 * Best-effort, same as recordStageTransition: never throws, never blocks the
 * caller's real business operation.
 */
export async function recordStageTransitionsBulk(
  leadIds: number[],
  toStage: string,
  opts?: { fromStage?: string | null; campaignId?: string; channel?: string }
): Promise<void> {
  if (!leadIds || leadIds.length === 0) return;
  try {
    await sql`
      INSERT INTO stage_transitions (lead_id, from_stage, to_stage, campaign_id, channel)
      SELECT unnest(${leadIds}::bigint[]), ${opts?.fromStage || null}, ${toStage}, ${opts?.campaignId || null}, ${opts?.channel || null}
    `;
  } catch (error) {
    console.error('[stageTransitionRecorder] Failed to record bulk transitions', error);
  }
}

/**
 * Resolve a lead's numeric id by phone number. Several transition points
 * (campaign_contacts, inbound SMS) don't carry a real lead_id in scope —
 * campaign_contacts.seller_lead_id/buyer_lead_id are never populated by any
 * current write path — so phone is the only reliable join key back to
 * `leads`, matching the pattern already used in
 * approvals/[id]/route.ts and sms/inbound/route.ts. Best-effort: returns
 * null (never throws) so a lookup miss never blocks the caller.
 */
export async function resolveLeadIdByPhone(phone: string | null | undefined): Promise<number | null> {
  if (!phone) return null;
  try {
    const [lead] = await sql`SELECT id FROM leads WHERE phone = ${phone} LIMIT 1`;
    return lead?.id ?? null;
  } catch (error) {
    console.error('[stageTransitionRecorder] Failed to resolve lead by phone', error);
    return null;
  }
}

/**
 * Backfill stage transitions from audit_logs for existing leads.
 * This is a best-effort operation; transitions that can't be determined
 * from audit logs are skipped.
 */
export async function backfillStageTransitions(): Promise<number> {
  try {
    // Backfill from audit_logs where we can determine stage transitions
    const result = await sql`
      WITH audit_transitions AS (
        SELECT
          (payload->>'leadId')::bigint AS lead_id,
          CASE
            WHEN action = 'lead_created' THEN NULL
            WHEN action = 'lead_imported' THEN NULL
            WHEN action = 'campaign_launched' THEN 'NEW'
            WHEN action = 'inbound_reply_received' THEN 'ENGAGED'
            WHEN action = 'ai_reply_sent' THEN 'ENGAGED'
            WHEN action = 'owner_range_approved' THEN 'NEGOTIATING'
            WHEN action = 'negotiation_agreed' THEN 'NEGOTIATING'
            WHEN action = 'contract_generated' THEN 'NEGOTIATING'
            WHEN action = 'contract_signed' THEN 'SIGNED'
            WHEN action = 'contract_assigned' THEN 'ASSIGNED'
            ELSE NULL
          END AS from_stage,
          CASE
            WHEN action = 'lead_created' THEN 'NEW'
            WHEN action = 'lead_imported' THEN 'NEW'
            WHEN action = 'campaign_launched' THEN 'CONTACTED'
            WHEN action = 'inbound_reply_received' THEN 'ENGAGED'
            WHEN action = 'ai_reply_sent' THEN 'ENGAGED'
            WHEN action = 'owner_range_approved' THEN 'NEGOTIATING'
            WHEN action = 'negotiation_agreed' THEN 'NEGOTIATING'
            WHEN action = 'contract_generated' THEN 'NEGOTIATING'
            WHEN action = 'contract_signed' THEN 'SIGNED'
            WHEN action = 'contract_assigned' THEN 'ASSIGNED'
            ELSE NULL
          END AS to_stage,
          created_at AS occurred_at,
          payload->>'campaignId' AS campaign_id,
          payload->>'profileId' AS profile_id,
          CASE
            WHEN action LIKE 'inbound_%' THEN 'inbound'
            WHEN action LIKE 'ai_%' THEN 'sms'
            WHEN action LIKE 'contract_%' THEN 'system'
            ELSE 'system'
          END AS channel
        FROM audit_logs
        WHERE action IN (
          'lead_created', 'lead_imported', 'campaign_launched',
          'inbound_reply_received', 'ai_reply_sent',
          'owner_range_approved', 'negotiation_agreed',
          'contract_generated', 'contract_signed', 'contract_assigned'
        )
        AND NOT EXISTS (
          SELECT 1 FROM stage_transitions st
          WHERE st.lead_id = (payload->>'leadId')::bigint
            AND st.occurred_at = created_at
        )
      )
      INSERT INTO stage_transitions (lead_id, from_stage, to_stage, occurred_at, campaign_id, profile_id, channel, backfilled)
      SELECT lead_id, from_stage, to_stage, occurred_at, campaign_id, profile_id, channel, true
      FROM audit_transitions
      WHERE lead_id IS NOT NULL AND to_stage IS NOT NULL
    `;

    return result.length || 0;
  } catch (error) {
    console.error('[stageTransitionRecorder] Backfill failed', error);
    return 0;
  }
}