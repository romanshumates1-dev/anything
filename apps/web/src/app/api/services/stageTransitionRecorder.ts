/**
 * Stage Transition Recorder
 *
 * Records lead stage transitions for analytics and pipeline tracking.
 */

import sql from '@/app/api/utils/sql';

export interface StageTransition {
  leadId: string | number;
  fromStage: string | null;
  toStage: string;
  channel?: string;
  campaignId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordStageTransition(transition: StageTransition): Promise<void> {
  const { leadId, fromStage, toStage, channel, metadata } = transition;

  try {
    await sql`
      INSERT INTO stage_transitions (
        id, lead_id, from_stage, to_stage, lead_type, metadata, created_at
      ) VALUES (
        ${crypto.randomUUID()},
        ${leadId},
        ${fromStage},
        ${toStage},
        'seller',
        ${JSON.stringify({ channel, ...metadata })},
        NOW()
      )
    `;

    await sql`
      UPDATE leads SET status = ${toStage}, updated_at = NOW()
      WHERE id = ${leadId}
    `;
  } catch (error) {
    console.error('[STAGE-TRANSITION] Failed to record:', error);
  }
}

export async function resolveLeadIdByPhone(phone: string | null | undefined): Promise<string | null> {
  // Short-circuit for null/empty phone - never hit the DB
  if (!phone || typeof phone !== 'string' || phone.trim() === '') {
    return null;
  }

  try {
    const [lead] = await sql`
      SELECT id FROM leads WHERE phone = ${phone} ORDER BY updated_at DESC LIMIT 1
    `;
    return lead?.id || null;
  } catch {
    return null;
  }
}

export async function recordStageTransitionsBulk(
  leadIds: Array<string | number>,
  toStage: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  // No-op for empty list (no wasted round trip)
  if (!leadIds.length) return;

  try {
    // Single-query bulk insert using JSON array unpacking
    const metaJson = JSON.stringify(metadata || {});
    const idsJson = JSON.stringify(leadIds.map(String));

    await sql`
      INSERT INTO stage_transitions (id, lead_id, from_stage, to_stage, lead_type, metadata, created_at)
      SELECT
        gen_random_uuid(),
        lead_id::text,
        NULL,
        ${toStage},
        'seller',
        ${metaJson}::jsonb,
        NOW()
      FROM jsonb_array_elements_text(${idsJson}::jsonb) AS lead_id
    `;
  } catch (error) {
    console.error('[STAGE-TRANSITION] Failed to record:', error);
    // Best-effort, never throws
  }
}
