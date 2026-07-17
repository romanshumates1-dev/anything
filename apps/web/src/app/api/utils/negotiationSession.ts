/**
 * Phase A — bounded-negotiation session flow (thin I/O around the pure engine).
 *
 * Preconditions to START a session (ALL, enforced here server-side):
 *   1. beta flag `boundedNegotiation` ON
 *   2. an owner-approved range for THIS lead (approvedMin/Max passed in by the
 *      route from the owner's approval record)
 *   3. assignability passed (or THIN-DEAL typed override confirmed upstream)
 * Absent any one → no session exists and the escalation invariant runs
 * byte-for-byte unchanged.
 */
import { randomUUID } from 'node:crypto';
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import {
  computeNextOffer,
  counterAcceptable,
  injectOffer,
  OFFER_SLOT,
  type NegotiationSide,
} from './negotiationEngine';

export interface StartSessionInput {
  organizationId: string;
  leadId: number;
  side: NegotiationSide;
  openerCents: number;
  clampCents: number;
  approvedMinCents: number;
  approvedMaxCents: number;
  /** Owner confirmed the range (route verifies the approval record + any
   *  thin-deal typed override before calling). */
  ownerApproved: boolean;
  contractId?: string;
}

export async function startSession(input: StartSessionInput): Promise<{ sessionId: string } | { error: string }> {
  if (!(await isBetaFlagOn('boundedNegotiation'))) return { error: 'boundedNegotiation flag is off' };
  if (!input.ownerApproved) return { error: 'no owner-approved range for this lead' };
  if (!(input.approvedMinCents > 0 && input.approvedMaxCents >= input.approvedMinCents)) {
    return { error: 'approved range invalid' };
  }

  const id = randomUUID();
  try {
    await sql`
      INSERT INTO negotiation_sessions
        (id, organization_id, lead_id, side, opener_cents, clamp_cents, approved_min_cents, approved_max_cents, contract_id)
      VALUES (${id}, ${input.organizationId}, ${input.leadId}, ${input.side},
              ${input.openerCents}, ${input.clampCents}, ${input.approvedMinCents}, ${input.approvedMaxCents}, ${input.contractId ?? null})
    `;
  } catch {
    return { error: 'an active session already exists for this lead/side' };
  }
  await logEvent('negotiation_session_started', 'lead', String(input.leadId), { sessionId: id, side: input.side }, input.organizationId);
  return { sessionId: id };
}

/** Parse a prospect counter: digits, $-prefixed, or k-suffixed. Word-amounts and
 *  anything ambiguous → null → ESCALATE (never guess a number). */
export function parseCounterCents(text: string): number | null {
  const m = text.match(/\$?\s?([\d,]+(?:\.\d+)?)\s*([kK])?\b/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const dollars = m[2] ? n * 1000 : n;
  if (dollars < 1000) return null; // "call me at 3" is not a price
  return Math.round(dollars * 100);
}

export type RoundResult =
  | { outcome: 'agreed'; counterCents: number }
  | { outcome: 'offer_queued'; offerCents: number; round: number; jobId: string | null }
  | { outcome: 'walked_away' }
  | { outcome: 'escalated'; reason: string }
  | { outcome: 'inactive'; reason: string };

/**
 * Advance one round: parse the counter → agreed / next offer / walk-away.
 * Restart-safe: the outbound is enqueued with dedupe `negoffer:{session}:{round}`
 * — a crashed-and-restarted worker collapses onto the same job row.
 * The prose template comes from the caller (LLM output containing the {OFFER}
 * slot); we inject the computed figure AFTER generation.
 */
export async function advanceRound(sessionId: string, counterText: string | null, proseTemplate: string): Promise<RoundResult> {
  if (!(await isBetaFlagOn('boundedNegotiation'))) return { outcome: 'inactive', reason: 'flag_off' };

  const [s] = await sql`SELECT * FROM negotiation_sessions WHERE id = ${sessionId}`;
  if (!s) return { outcome: 'inactive', reason: 'no_session' };
  if (s.status !== 'active') return { outcome: 'inactive', reason: `status:${s.status}` };

  // 1. Counter handling.
  if (counterText != null) {
    const counter = parseCounterCents(counterText);
    if (counter == null) {
      await pauseSession(sessionId, 'unparseable_counter');
      await sql`
        INSERT INTO human_approvals (id, organization_id, type, context, status)
        VALUES (${randomUUID()}, ${s.organization_id}, 'NEGOTIATION_UNPARSEABLE',
                ${JSON.stringify({ sessionId, leadId: s.lead_id, counterText: counterText.slice(0, 200) })}, 'PENDING')
      `;
      return { outcome: 'escalated', reason: 'unparseable counter — owner review' };
    }
    await sql`UPDATE negotiation_sessions SET last_counter_cents = ${counter}, updated_at = now() WHERE id = ${sessionId}`;

    if (counterAcceptable(s.side, counter, Number(s.clamp_cents))) {
      await sql`UPDATE negotiation_sessions SET status = 'agreed', updated_at = now() WHERE id = ${sessionId}`;
      await sql`
        INSERT INTO human_approvals (id, organization_id, type, context, status)
        VALUES (${randomUUID()}, ${s.organization_id}, 'NEGOTIATION_AGREED',
                ${JSON.stringify({ sessionId, leadId: s.lead_id, agreedCents: counter })}, 'PENDING')
      `;
      await logEvent('negotiation_agreed', 'lead', String(s.lead_id), { sessionId, agreedCents: counter }, s.organization_id);
      return { outcome: 'agreed', counterCents: counter };
    }
  }

  // 2. Compute the next figure (pure — the model never chooses it).
  const nextRound = Number(s.round);
  const next = computeNextOffer({
    side: s.side,
    openerCents: Number(s.opener_cents),
    clampCents: Number(s.clamp_cents),
    round: nextRound,
    lastOfferCents: s.last_offer_cents != null ? Number(s.last_offer_cents) : undefined,
  });

  if (next.kind === 'walk_away') {
    await sql`UPDATE negotiation_sessions SET status = 'walked_away', updated_at = now() WHERE id = ${sessionId}`;
    await sql`
      INSERT INTO human_approvals (id, organization_id, type, context, status)
      VALUES (${randomUUID()}, ${s.organization_id}, 'NEGOTIATION_WALKAWAY',
              ${JSON.stringify({ sessionId, leadId: s.lead_id })}, 'PENDING')
    `;
    await logEvent('negotiation_walked_away', 'lead', String(s.lead_id), { sessionId }, s.organization_id);
    return { outcome: 'walked_away' };
  }

  // 3. Inject the figure into the slot AFTER generation, then enqueue through
  //    the normal send path (gateway → dispatchGate incl. the numeric guard).
  const text = injectOffer(proseTemplate.includes(OFFER_SLOT) ? proseTemplate : `${proseTemplate} ${OFFER_SLOT}`, next.offerCents);
  const [lead] = await sql`SELECT phone FROM leads WHERE id = ${s.lead_id}`;
  if (!lead?.phone) return { outcome: 'inactive', reason: 'lead_has_no_phone' };

  const jobId = await enqueueJob(
    'send_message',
    {
      leadId: s.lead_id,
      to: lead.phone,
      text,
      channel: 'sms',
      organizationId: s.organization_id,
      boundedNegotiation: {
        computedOfferCents: next.offerCents,
        approvedMinCents: Number(s.approved_min_cents),
        approvedMaxCents: Number(s.approved_max_cents),
        sessionId,
      },
    },
    { dedupeKey: `negoffer:${sessionId}:${nextRound}` }
  );

  await sql`
    UPDATE negotiation_sessions
    SET round = ${nextRound + 1}, last_offer_cents = ${next.offerCents}, updated_at = now()
    WHERE id = ${sessionId}
  `;
  await logEvent('negotiation_offer_queued', 'lead', String(s.lead_id), { sessionId, round: nextRound, offerCents: next.offerCents }, s.organization_id);
  return { outcome: 'offer_queued', offerCents: next.offerCents, round: nextRound, jobId: jobId as string | null };
}

/** Owner pause / take-over: instantly reverts the lead to escalation mode and
 *  CANCELS any queued (unsent) offer jobs for this session. */
export async function pauseSession(sessionId: string, reason = 'owner_pause'): Promise<{ cancelled: number }> {
  await sql`UPDATE negotiation_sessions SET status = 'paused', updated_at = now() WHERE id = ${sessionId}`;
  const cancelled = await sql`
    UPDATE jobs SET status = 'cancelled', updated_at = now()
    WHERE type = 'send_message'
      AND status IN ('pending','failed')
      AND dedupe_key LIKE ${'negoffer:' + sessionId + ':%'}
    RETURNING id
  `;
  await logEvent('negotiation_paused', 'negotiation', sessionId, { reason, cancelledJobs: cancelled.length });
  return { cancelled: cancelled.length };
}
