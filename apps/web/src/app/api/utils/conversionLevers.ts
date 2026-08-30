/**
 * conversionLevers — Phase 6 free conversion improvements.
 *
 * Three independent levers, each a pure function or a thin DB wrapper:
 *
 * 1. SPEED-TO-RANGE REMINDERS
 *    Instrument range-request → owner-reply latency. Escalating reminders at
 *    15min / 1hr / 3hr to OWNER_NUMBER. A stale request (>3hr) is flagged.
 *    Reported against outcomes so the owner can see whether slow replies
 *    correlate with lost deals.
 *
 * 2. RECENCY DECAY in lead scoring
 *    Age-decay per record_type (configurable half-life). A fresh probate
 *    outranks a stale one. Surfaced in the "why" string on the lead card.
 *    Half-lives (days): probate=90, tax_delinquent=180, code_violation=60,
 *    absentee=365, vacant=120, default=180.
 *
 * 3. SEND-TIME TARGETING
 *    Inside the legal window (8am–9pm lead-local), prefer the hours where
 *    replies actually cluster. Default priors: 10–11am and 2–4pm (the existing
 *    send windows). Once real data accrues, the observed reply histogram
 *    replaces the prior — but only when n≥30 per hour bucket (same discipline
 *    as the debrief's INSUFFICIENT DATA label).
 */
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';

// ─── 1. SPEED-TO-RANGE REMINDERS ────────────────────────────────────────────

const REMINDER_SCHEDULE_MS = [15 * 60_000, 60 * 60_000, 3 * 60 * 60_000]; // 15min, 1hr, 3hr

/**
 * Schedule escalating owner reminders for a pending range request.
 * Called when a range request is created (ownerRangeRequest.ts).
 * Idempotent via dedupe keys.
 */
export async function scheduleRangeReminders(opts: {
  requestId: string;
  organizationId: string;
  leadId: number;
  propertyAddress: string;
}): Promise<void> {
  for (let i = 0; i < REMINDER_SCHEDULE_MS.length; i++) {
    const delayMs = REMINDER_SCHEDULE_MS[i];
    const label = ['15min', '1hr', '3hr'][i];
    await enqueueJob(
      'send_owner_notification',
      {
        organizationId: opts.organizationId,
        message: `⏰ Range request pending (${label}): lead #${opts.leadId} at ${opts.propertyAddress}. Reply needed to keep negotiation moving.`,
        requestId: opts.requestId,
        reminderLevel: label,
      },
      {
        runAt: new Date(Date.now() + delayMs),
        dedupeKey: `range_reminder:${opts.requestId}:${label}`,
      }
    );
  }
}

/**
 * Cancel pending range reminders once the owner replies.
 * Called when owner_range_requests.status flips to ANSWERED.
 */
export async function cancelRangeReminders(requestId: string): Promise<void> {
  await sql`
    UPDATE jobs
    SET status = 'cancelled', updated_at = now()
    WHERE type = 'send_owner_notification'
      AND status IN ('pending', 'failed')
      AND payload->>'requestId' = ${requestId}
  `;
}

/**
 * Measure range-request → owner-reply latency and log it.
 * Called when owner_range_requests.status flips to ANSWERED.
 */
export async function recordRangeLatency(opts: {
  requestId: string;
  organizationId: string;
  leadId: number;
  requestedAt: Date;
  answeredAt: Date;
}): Promise<{ latencyMs: number; latencyMinutes: number }> {
  const latencyMs = opts.answeredAt.getTime() - opts.requestedAt.getTime();
  const latencyMinutes = Math.round(latencyMs / 60_000);
  await logEvent('range_request_answered', 'negotiation', opts.requestId, {
    leadId: opts.leadId,
    latencyMs,
    latencyMinutes,
    stale: latencyMinutes > 180,
  }, opts.organizationId);
  return { latencyMs, latencyMinutes };
}

// ─── 2. RECENCY DECAY ────────────────────────────────────────────────────────

/** Half-life in days per distress signal type. */
export const RECENCY_HALF_LIVES: Record<string, number> = {
  probate: 90,
  tax_delinquent: 180,
  code_violation: 60,
  absentee: 365,
  vacant: 120,
  foreclosure: 45,
  default: 180,
};

/**
 * Apply exponential decay to a base score given the record's age.
 *
 * score(t) = baseScore × 2^(−t / halfLife)
 *
 * A record at exactly its half-life retains 50% of its base score.
 * A record at 2× its half-life retains 25%. This is the standard
 * radioactive-decay model — simple, monotone, and has no arbitrary cliff.
 */
export function applyRecencyDecay(opts: {
  baseScore: number;
  recordType: string;
  recordedAt: Date;
  now?: Date;
}): { decayedScore: number; ageDays: number; halfLifeDays: number; retentionFraction: number; why: string } {
  const now = opts.now ?? new Date();
  const ageDays = (now.getTime() - opts.recordedAt.getTime()) / 86_400_000;
  const halfLife = RECENCY_HALF_LIVES[opts.recordType] ?? RECENCY_HALF_LIVES.default;
  const retentionFraction = Math.pow(2, -ageDays / halfLife);
  const decayedScore = Math.round(opts.baseScore * retentionFraction * 10) / 10;
  const why = `${opts.recordType} signal is ${Math.round(ageDays)}d old (half-life ${halfLife}d) → ${Math.round(retentionFraction * 100)}% retained`;
  return { decayedScore, ageDays, halfLifeDays: halfLife, retentionFraction, why };
}

// ─── 3. SEND-TIME TARGETING ──────────────────────────────────────────────────

const MIN_N_FOR_OBSERVED = 30; // same discipline as debrief INSUFFICIENT DATA

/**
 * Return the best send hour (0–23) for a given timezone, based on observed
 * reply data when n≥30, otherwise the prior (10am or 2pm, whichever is next).
 *
 * Returns { hour, basis: 'observed'|'prior', n, note }.
 */
export async function bestSendHour(opts: {
  timezone: string;
  organizationId: string;
  now?: Date;
}): Promise<{ hour: number; basis: 'observed' | 'prior'; n: number; note: string }> {
  // Query reply histogram: hour of day (lead-local) vs reply count
  const rows = await sql`
    SELECT
      EXTRACT(HOUR FROM (me.created_at AT TIME ZONE ${opts.timezone}))::int AS hour,
      COUNT(*)::int AS n
    FROM message_events me
    JOIN leads l ON l.id::text = me.contact_id::text
    WHERE me.direction = 'inbound'
      AND l.organization_id = ${opts.organizationId}
      AND me.created_at > now() - interval '90 days'
    GROUP BY 1
    ORDER BY n DESC
  `;

  // Filter to legal window (8–21) and find the best hour with n≥30
  const legal = (rows as any[]).filter((r) => r.hour >= 8 && r.hour < 21 && r.n >= MIN_N_FOR_OBSERVED);
  if (legal.length > 0) {
    const best = legal[0];
    return {
      hour: best.hour,
      basis: 'observed',
      n: best.n,
      note: `Best observed reply hour: ${best.hour}:00 (n=${best.n})`,
    };
  }

  // Fall back to prior: next send window (10–11am or 2–4pm)
  const now = opts.now ?? new Date();
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: opts.timezone, hour: 'numeric', hour12: false });
  const localHour = parseInt(fmt.format(now), 10);
  const priorHour = localHour < 10 ? 10 : localHour < 14 ? 14 : 10; // next window or tomorrow's 10am
  const totalN = (rows as any[]).reduce((s: number, r: any) => s + r.n, 0);
  return {
    hour: priorHour,
    basis: 'prior',
    n: totalN,
    note: `INSUFFICIENT DATA (n=${totalN}, need ${MIN_N_FOR_OBSERVED}/hour) — using prior send window`,
  };
}
