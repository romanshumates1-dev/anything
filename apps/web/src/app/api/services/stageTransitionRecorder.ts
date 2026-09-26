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

/**
 * STRICT, tenant-scoped lead resolution.
 *
 * TENANT ISOLATION INVARIANT: a phone number is NOT a tenant-unique key. The same person
 * can be a lead in several organizations, so resolving by phone alone can hand a caller
 * another tenant's lead id. `organizationId` is therefore REQUIRED, not optional: making
 * it required is what forces every call site to state its tenant explicitly instead of
 * silently inheriting global resolution.
 *
 * Returns null when no lead matches. It never returns another organization's lead.
 */
export async function resolveLeadIdByPhone(
  phone: string | null | undefined,
  organizationId: string
): Promise<string | null> {
  if (!organizationId) {
    // Fail closed rather than degrade to an unscoped global lookup.
    console.error('[STAGE-TRANSITION] resolveLeadIdByPhone called without an organization; refusing to resolve');
    return null;
  }
  // Short-circuit for null/empty phone - never hit the DB
  if (!phone || typeof phone !== 'string' || phone.trim() === '') {
    return null;
  }

  try {
    const [lead] = await sql`
      SELECT id FROM leads
      WHERE phone = ${phone}
        AND organization_id = ${organizationId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    return lead?.id || null;
  } catch {
    return null;
  }
}

/**
 * GLOBAL, ambiguity-safe lead resolution - for provider webhooks with no authenticated
 * tenant context (Twilio inbound SMS, AWS SNS).
 *
 * WHY THIS EXISTS RATHER THAN SCOPING: the TCPA opt-out gate intentionally suppresses a
 * number platform-wide, because a person sending STOP must be unsubscribed everywhere and
 * over-suppression can only prevent sending - it never exposes data or moves money. That
 * suppression is deliberately cross-tenant.
 *
 * The defect this replaces was an ASYMMETRY: suppression was global and correct, while
 * funnel attribution used `resolveLeadIdByPhone(from)` and therefore picked ONE arbitrary
 * tenant via `ORDER BY updated_at DESC`. A STOP arriving on org A's number could write a
 * closed-lost stage transition onto org B's lead.
 *
 * INVARIANT: this returns EVERY lead matching the number so attribution is symmetric with
 * the global suppression. It never selects a single arbitrary tenant. Callers must treat
 * the result as a set and must not assume a single tenant.
 */
export async function resolveLeadIdsByPhoneGlobal(
  phone: string | null | undefined
): Promise<string[]> {
  if (!phone || typeof phone !== 'string' || phone.trim() === '') {
    return [];
  }

  try {
    const rows = await sql`
      SELECT id FROM leads
      WHERE phone = ${phone}
      ORDER BY updated_at DESC
    `;
    return (rows ?? []).map((r: Record<string, unknown>) => String(r.id));
  } catch {
    return [];
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
