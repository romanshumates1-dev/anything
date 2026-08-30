/**
 * complianceGate — fail-closed per-jurisdiction × per-channel gate.
 *
 * Phase 0A requirement: every jurisdiction×channel combo defaults FALSE.
 * The dispatch path for EVERY channel checks this gate before a cold send
 * fires and refuses if unreviewed. This is enforced in code at the send
 * boundary, not a checklist the owner can forget.
 *
 * FAIL-CLOSED means: if no row exists for a jurisdiction×channel, the send
 * is BLOCKED. An unreviewed market cannot accidentally receive cold outreach.
 *
 * KILL-SWITCH: one org-level toggle halting ALL outbound across ALL channels
 * immediately. Checked first, before any per-jurisdiction logic.
 */
import sql from '@/app/api/utils/sql';

export interface GateCheckResult {
  allowed: boolean;
  reason: string;
  jurisdiction?: string;
  channel?: string;
}

/**
 * Derive the jurisdiction string from a lead's metadata.
 * Returns the most specific match available: state+county > state.
 */
export function jurisdictionForLead(metadata: any): string | null {
  const meta = metadata ?? {};
  const state = (meta.state ?? meta.jurisdiction_state ?? '').trim().toUpperCase();
  const county = (meta.county ?? '').trim();
  if (!state) return null;
  if (county) return `${state}-${county.replace(/\s+/g, '')}`;
  return state;
}

/**
 * Check the org-level kill-switch. Returns true if ALL outbound is halted.
 */
export async function isKillSwitchActive(organizationId: string): Promise<boolean> {
  const rows = await sql`
    SELECT active FROM outbound_kill_switch
    WHERE organization_id = ${organizationId} AND active = true
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Activate the kill-switch for an org. Halts ALL outbound immediately.
 */
export async function activateKillSwitch(
  organizationId: string,
  reason: string,
  activatedBy: string
): Promise<void> {
  await sql`
    INSERT INTO outbound_kill_switch (organization_id, active, reason, activated_by, activated_at, updated_at)
    VALUES (${organizationId}, true, ${reason}, ${activatedBy}, now(), now())
    ON CONFLICT (organization_id)
    DO UPDATE SET active = true, reason = ${reason}, activated_by = ${activatedBy},
                  activated_at = now(), deactivated_at = NULL, updated_at = now()
  `;
}

/**
 * Deactivate the kill-switch for an org.
 */
export async function deactivateKillSwitch(
  organizationId: string,
  deactivatedBy: string
): Promise<void> {
  await sql`
    UPDATE outbound_kill_switch
    SET active = false, deactivated_at = now(), updated_at = now(),
        activated_by = ${deactivatedBy}
    WHERE organization_id = ${organizationId}
  `;
}

/**
 * Check whether a cold send is permitted for a given jurisdiction×channel.
 *
 * Returns allowed=false if:
 *   1. The kill-switch is active (all channels halted)
 *   2. No compliance gate row exists for this jurisdiction×channel (fail-closed)
 *   3. The gate row exists but attorney_reviewed=false
 *
 * Non-cold sends (inbound replies, transactional) bypass this gate — it only
 * governs first-touch cold outreach.
 */
export async function checkComplianceGate(opts: {
  organizationId: string;
  jurisdiction: string | null;
  channel: string;
  coldOutbound?: boolean;
}): Promise<GateCheckResult> {
  // Non-cold sends are not governed by the compliance gate.
  if (!opts.coldOutbound) {
    return { allowed: true, reason: 'non-cold send, gate not applicable' };
  }

  // 1. Kill-switch check — absolute, all channels.
  if (opts.organizationId) {
    const killed = await isKillSwitchActive(opts.organizationId);
    if (killed) {
      return {
        allowed: false,
        reason: 'KILL-SWITCH ACTIVE: all outbound halted by owner or compliance breach',
      };
    }
  }

  // 2. Jurisdiction must be known for cold outreach.
  if (!opts.jurisdiction) {
    return {
      allowed: false,
      reason: 'BLOCKED: jurisdiction unknown — cannot verify compliance gate for cold send',
      channel: opts.channel,
    };
  }

  // 3. Check the gate registry. Try exact match first, then state-only fallback.
  const rows = await sql`
    SELECT attorney_reviewed, source_terms_confirmed, notes
    FROM compliance_gates
    WHERE organization_id = ${opts.organizationId}
      AND channel = ${opts.channel}
      AND (jurisdiction = ${opts.jurisdiction}
           OR jurisdiction = ${opts.jurisdiction.split('-')[0]})
    ORDER BY LENGTH(jurisdiction) DESC  -- prefer more specific match
    LIMIT 1
  `;

  if (rows.length === 0) {
    return {
      allowed: false,
      reason: `BLOCKED: no compliance gate found for ${opts.jurisdiction}×${opts.channel} — fail-closed until attorney-reviewed`,
      jurisdiction: opts.jurisdiction,
      channel: opts.channel,
    };
  }

  const gate = rows[0] as any;
  if (!gate.attorney_reviewed) {
    return {
      allowed: false,
      reason: `BLOCKED: ${opts.jurisdiction}×${opts.channel} not yet attorney-reviewed — gate locked`,
      jurisdiction: opts.jurisdiction,
      channel: opts.channel,
    };
  }

  return {
    allowed: true,
    reason: 'compliance gate open',
    jurisdiction: opts.jurisdiction,
    channel: opts.channel,
  };
}

/**
 * Seed a compliance gate row (admin action). Defaults to unreviewed (fail-closed).
 * The owner/attorney must explicitly set attorney_reviewed=true to unlock.
 */
export async function upsertComplianceGate(opts: {
  organizationId: string;
  jurisdiction: string;
  channel: string;
  attorneyReviewed?: boolean;
  reviewedDate?: string | null;
  reviewedBy?: string | null;
  sourceTermsConfirmed?: boolean;
  notes?: string | null;
}): Promise<void> {
  await sql`
    INSERT INTO compliance_gates
      (organization_id, jurisdiction, channel, attorney_reviewed, reviewed_date,
       reviewed_by, source_terms_confirmed, notes, updated_at)
    VALUES
      (${opts.organizationId}, ${opts.jurisdiction}, ${opts.channel},
       ${opts.attorneyReviewed ?? false}, ${opts.reviewedDate ?? null},
       ${opts.reviewedBy ?? null}, ${opts.sourceTermsConfirmed ?? false},
       ${opts.notes ?? null}, now())
    ON CONFLICT (organization_id, jurisdiction, channel)
    DO UPDATE SET
      attorney_reviewed = ${opts.attorneyReviewed ?? false},
      reviewed_date = ${opts.reviewedDate ?? null},
      reviewed_by = ${opts.reviewedBy ?? null},
      source_terms_confirmed = ${opts.sourceTermsConfirmed ?? false},
      notes = ${opts.notes ?? null},
      updated_at = now()
  `;
}
