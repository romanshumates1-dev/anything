/**
 * smsGuards — Phase 12 cost floor + throughput guards.
 *
 * 1. SINGLE-SEGMENT ENFORCEMENT
 *    GSM-7 charset detection (unicode drops limit to 70), authoritative
 *    character counter, hard-flag >160 GSM-7 / >70 unicode. GSM-7 sanitizer
 *    replaces common unicode lookalikes with their ASCII equivalents so a
 *    template author's smart-quote doesn't silently split a message.
 *
 * 2. DUPLICATE-SEND DETECTOR
 *    Before any send, check whether the same (phone, text hash, campaign)
 *    combination was already dispatched within a dedup window (default 24h).
 *    Prevents double-sends on job-runner restart or retry storms.
 *
 * 3. THROUGHPUT GUARDS
 *    - A2P MPS cap: warn at 80% of assigned MPS, hard-stop at 100%
 *    - T-Mobile brand daily cap: configurable, warn at 80%
 *    - Auto-pause on opt-out rate >3%/campaign-day or delivery rate <85%
 *
 * All thresholds are env-configurable so the owner can tune without a deploy.
 */
import sql from '@/app/api/utils/sql';
import { createHash } from 'node:crypto';

// ─── 1. SINGLE-SEGMENT ENFORCEMENT ──────────────────────────────────────────

/**
 * GSM-7 basic character set (the 128 chars that fit in 7 bits).
 * A message containing ONLY these characters uses 160-char segments.
 * Any character outside this set forces UCS-2 encoding → 70-char segments.
 */
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
);

/** GSM-7 extended characters (counted as 2 chars each). */
const GSM7_EXTENDED = new Set('{}\\[~]|€^');

export type SegmentAnalysis = {
  encoding: 'gsm7' | 'ucs2';
  charCount: number;
  /** Effective character count (extended chars count as 2). */
  effectiveCount: number;
  segmentLimit: number;
  segments: number;
  overLimit: boolean;
  reason?: string;
};

export function analyzeSegments(text: string): SegmentAnalysis {
  let effectiveCount = 0;
  let isGsm7 = true;

  for (const ch of text) {
    if (GSM7_BASIC.has(ch)) {
      effectiveCount += 1;
    } else if (GSM7_EXTENDED.has(ch)) {
      effectiveCount += 2; // escape + char
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (!isGsm7) {
    // UCS-2: count actual Unicode code points
    const codePoints = [...text].length;
    const segmentLimit = 70;
    const segments = Math.ceil(codePoints / segmentLimit);
    return {
      encoding: 'ucs2',
      charCount: codePoints,
      effectiveCount: codePoints,
      segmentLimit,
      segments,
      overLimit: codePoints > segmentLimit,
      reason: codePoints > segmentLimit
        ? `UCS-2 encoding (unicode chars present): ${codePoints} chars > ${segmentLimit} limit → ${segments} segments`
        : undefined,
    };
  }

  const segmentLimit = 160;
  const segments = Math.ceil(effectiveCount / segmentLimit);
  return {
    encoding: 'gsm7',
    charCount: text.length,
    effectiveCount,
    segmentLimit,
    segments,
    overLimit: effectiveCount > segmentLimit,
    reason: effectiveCount > segmentLimit
      ? `GSM-7: ${effectiveCount} effective chars > ${segmentLimit} limit → ${segments} segments`
      : undefined,
  };
}

/**
 * Replace common unicode lookalikes with their GSM-7 ASCII equivalents.
 * Idempotent — safe to call multiple times.
 */
export function sanitizeToGsm7(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"') // smart double quotes
    .replace(/[\u2013\u2014\u2015]/g, '-')                   // em/en dash
    .replace(/\u2026/g, '...')                                // ellipsis
    .replace(/\u00A0/g, ' ')                                  // non-breaking space
    .replace(/\u2022/g, '*')                                  // bullet
    .replace(/[\u2190-\u21FF]/g, '')                          // arrows (drop)
    .replace(/[\u2600-\u26FF\u2700-\u27BF]/g, '');            // misc symbols (drop)
}

// ─── 2. DUPLICATE-SEND DETECTOR ─────────────────────────────────────────────

const DEDUP_WINDOW_MS = 24 * 3600_000; // 24 hours

function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Returns true if this (phone, textHash, campaignId) was already sent within
 * the dedup window. Checks message_events for a matching outbound row.
 */
export async function isDuplicateSend(opts: {
  phone: string;
  text: string;
  campaignId?: string | null;
}): Promise<boolean> {
  const hash = textHash(opts.text);
  const since = new Date(Date.now() - DEDUP_WINDOW_MS);

  const rows = await sql`
    SELECT 1 FROM message_events
    WHERE direction = 'outbound'
      AND metadata->>'textHash' = ${hash}
      AND (
        contact_id::text IN (
          SELECT id::text FROM leads WHERE phone = ${opts.phone} LIMIT 10
        )
        OR metadata->>'to' = ${opts.phone}
      )
      AND created_at > ${since}
      ${opts.campaignId ? sql`AND campaign_id = ${opts.campaignId}` : sql``}
    LIMIT 1
  `;
  return rows.length > 0;
}

// ─── 3. THROUGHPUT GUARDS ────────────────────────────────────────────────────

const MPS_CAP = Number(process.env.A2P_MPS_CAP) || 10;
const TMOBILE_DAILY_CAP = Number(process.env.TMOBILE_DAILY_CAP) || 2000;
const OPT_OUT_PAUSE_PCT = Number(process.env.OPT_OUT_PAUSE_PCT) || 3.0;
const DELIVERY_PAUSE_PCT = Number(process.env.DELIVERY_PAUSE_PCT) || 85.0;

export type ThroughputStatus = {
  mps: { current: number; cap: number; warn: boolean; blocked: boolean };
  dailyCap: { sent: number; cap: number; warn: boolean; blocked: boolean };
  optOutRate: { rate: number; threshold: number; paused: boolean };
  deliveryRate: { rate: number; threshold: number; paused: boolean };
  canSend: boolean;
  reason?: string;
};

export async function checkThroughput(organizationId: string): Promise<ThroughputStatus> {
  const now = new Date();
  const windowStart1s = new Date(now.getTime() - 1000);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const [mpsRow] = await sql`
    SELECT COUNT(*)::int AS cnt FROM message_events
    WHERE direction = 'outbound'
      AND created_at > ${windowStart1s}
      AND campaign_id IN (
        SELECT id FROM outreach_campaigns WHERE organization_id = ${organizationId}
      )
  `;
  const currentMps = (mpsRow as any)?.cnt ?? 0;

  const [dailyRow] = await sql`
    SELECT COUNT(*)::int AS sent FROM message_events
    WHERE direction = 'outbound'
      AND created_at > ${dayStart}
      AND campaign_id IN (
        SELECT id FROM outreach_campaigns WHERE organization_id = ${organizationId}
      )
  `;
  const sentToday = (dailyRow as any)?.sent ?? 0;

  // Opt-out rate over last 1000 sends
  const [rateRow] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'opt_out')::float AS opt_outs,
      COUNT(*)::float AS total
    FROM message_events
    WHERE direction = 'outbound'
      AND created_at > now() - interval '24 hours'
      AND campaign_id IN (
        SELECT id FROM outreach_campaigns WHERE organization_id = ${organizationId}
      )
  `;
  const optOuts = (rateRow as any)?.opt_outs ?? 0;
  const total = (rateRow as any)?.total ?? 0;
  const optOutRate = total > 0 ? (optOuts / total) * 100 : 0;

  // Delivery rate over last 24h
  const [delivRow] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'delivered')::float AS delivered,
      COUNT(*) FILTER (WHERE status IN ('delivered', 'failed', 'undelivered'))::float AS attempted
    FROM message_events
    WHERE direction = 'outbound'
      AND created_at > now() - interval '24 hours'
      AND campaign_id IN (
        SELECT id FROM outreach_campaigns WHERE organization_id = ${organizationId}
      )
  `;
  const delivered = (delivRow as any)?.delivered ?? 0;
  const attempted = (delivRow as any)?.attempted ?? 0;
  const deliveryRate = attempted > 0 ? (delivered / attempted) * 100 : 100;

  const mpsBlocked = currentMps >= MPS_CAP;
  const mpsWarn = currentMps >= MPS_CAP * 0.8;
  const dailyBlocked = sentToday >= TMOBILE_DAILY_CAP;
  const dailyWarn = sentToday >= TMOBILE_DAILY_CAP * 0.8;
  const optOutPaused = total >= 100 && optOutRate > OPT_OUT_PAUSE_PCT;
  const deliveryPaused = attempted >= 50 && deliveryRate < DELIVERY_PAUSE_PCT;

  const canSend = !mpsBlocked && !dailyBlocked && !optOutPaused && !deliveryPaused;
  let reason: string | undefined;
  if (mpsBlocked) reason = `A2P MPS cap reached (${currentMps}/${MPS_CAP}/s)`;
  else if (dailyBlocked) reason = `T-Mobile daily cap reached (${sentToday}/${TMOBILE_DAILY_CAP})`;
  else if (optOutPaused) reason = `Opt-out rate ${optOutRate.toFixed(1)}% > ${OPT_OUT_PAUSE_PCT}% threshold — auto-paused`;
  else if (deliveryPaused) reason = `Delivery rate ${deliveryRate.toFixed(1)}% < ${DELIVERY_PAUSE_PCT}% threshold — auto-paused`;

  return {
    mps: { current: currentMps, cap: MPS_CAP, warn: mpsWarn, blocked: mpsBlocked },
    dailyCap: { sent: sentToday, cap: TMOBILE_DAILY_CAP, warn: dailyWarn, blocked: dailyBlocked },
    optOutRate: { rate: optOutRate, threshold: OPT_OUT_PAUSE_PCT, paused: optOutPaused },
    deliveryRate: { rate: deliveryRate, threshold: DELIVERY_PAUSE_PCT, paused: deliveryPaused },
    canSend,
    reason,
  };
}
