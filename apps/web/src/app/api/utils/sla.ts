/**
 * SLA instrumentation — INT-1.
 *
 * Environment-agnostic latency tracking: logs reply_received → ai_dispatched
 * on every inbound, computes rolling P95, and provides a provider-aware ack-SMS
 * fallback so the prospect never sits in silence.
 *
 * INVARIANT: the prospect never sits in silence.
 *   - Anthropic: ack fires if AI hasn't dispatched within 45s of reply_received.
 *   - Ollama: ack fires immediately (50s/gen means ack should always precede).
 *
 * Prod is OWNER-BLOCKED until: always-on worker (Fly/Railway) polling jobs at
 * seconds-granularity + AI_PROVIDER=anthropic on the reply path.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { getAiConfig, type AiProvider } from '@/app/api/utils/ai-settings';
import { getGateway } from '@/app/api/utils/jobs';

export const ANTHROPIC_ACK_THRESHOLD_MS = 45_000;
export const OLLAMA_ACK_IMMEDIATE = true; // always ack before calling ollama

const ACK_SMS_BODY =
  "Thanks for your message. We're drafting a response and will reply shortly. — DealFlow AI";

/** Record the moment an inbound reply arrives (before any AI job is enqueued). */
export async function recordReplyReceived(
  conversationId: number,
  leadId: number
): Promise<number> {
  const [row] = await sql`
    INSERT INTO inbound_latency (conversation_id, lead_id, reply_received_at)
    VALUES (${conversationId}, ${leadId}, now())
    RETURNING id
  `;
  return row?.id ?? 0;
}

/** Record the moment the AI call is actually dispatched (job picks up ai_reply). */
export async function recordAIDispatched(
  conversationId: number,
  provider: AiProvider
): Promise<void> {
  await sql`
    UPDATE inbound_latency
    SET ai_dispatched_at = now(), provider = ${provider}
    WHERE id = (
      SELECT id FROM inbound_latency
      WHERE conversation_id = ${conversationId}
        AND ai_dispatched_at IS NULL
      ORDER BY reply_received_at DESC
      LIMIT 1
    )
  `;
}

/** Refresh the rolling P95 materialized view. Call after significant batch or on cron. */
export async function refreshP95(): Promise<void> {
  await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY inbound_latency_p95`;
}

/** Read the current rolling P95 (ms) and counts. Returns null if no data. */
export async function getRollingP95(): Promise<{
  p95Ms: number | null;
  completed: number;
  pending: number;
  latestInbound: Date | null;
  computedAt: Date | null;
} | null> {
  const [row] = await sql`SELECT * FROM inbound_latency_p95 LIMIT 1`;
  if (!row) return null;
  return {
    p95Ms: row.p95_ms != null ? parseFloat(row.p95_ms) : null,
    completed: parseInt(row.completed_count ?? '0', 10),
    pending: parseInt(row.pending_count ?? '0', 10),
    latestInbound: row.latest_inbound,
    computedAt: row.computed_at,
  };
}

/** Compute P95 directly from the table (no materialized view). Useful for tests. */
export async function computeP95Direct(windowHours = 24): Promise<number | null> {
  const [row] = await sql`
    SELECT percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (ai_dispatched_at - reply_received_at)) * 1000
    ) AS p95_ms
    FROM inbound_latency
    WHERE reply_received_at >= now() - ${windowHours + ' hours'}::interval
      AND ai_dispatched_at IS NOT NULL
  `;
  return row?.p95_ms != null ? parseFloat(row.p95_ms) : null;
}

/**
 * Should we send an ack SMS for this conversation?
 * Deterministic: checks elapsed time against provider threshold.
 */
export function shouldSendAck(
  provider: AiProvider,
  replyReceivedAt: Date,
  now: Date = new Date()
): boolean {
  const elapsedMs = now.getTime() - replyReceivedAt.getTime();
  if (provider === 'ollama') {
    // Ollama is ~50s/gen — ack should fire first every time.
    return true;
  }
  // Anthropic: ack if we've already waited past the threshold.
  return elapsedMs >= ANTHROPIC_ACK_THRESHOLD_MS;
}

/** True if an ack was already sent for this conversation. */
export async function wasAckSent(conversationId: number): Promise<boolean> {
  const [row] = await sql`
    SELECT 1 FROM inbound_latency
    WHERE conversation_id = ${conversationId} AND ack_sent_at IS NOT NULL
    LIMIT 1
  `;
  return !!row;
}

/** Mark ack as sent (idempotent). */
export async function markAckSent(conversationId: number): Promise<void> {
  await sql`
    UPDATE inbound_latency
    SET ack_sent_at = now()
    WHERE id = (
      SELECT id FROM inbound_latency
      WHERE conversation_id = ${conversationId}
        AND ack_sent_at IS NULL
      ORDER BY reply_received_at DESC
      LIMIT 1
    )
  `;
}

/** Send the ack SMS via the gateway. Fails open (logs error, doesn't throw). */
export async function sendAckSms(params: {
  leadId: number;
  conversationId: number;
  to: string;
}): Promise<void> {
  const { leadId, conversationId, to } = params;
  try {
    const gateway = await getGateway();
    const result = await gateway.send({
      leadId,
      to,
      text: ACK_SMS_BODY,
      conversationThread: `conv_${conversationId}`,
    });

    await logEvent('sla_ack_sent', 'conversation', String(conversationId), {
      leadId,
      to,
      status: result.status,
      provider: result.provider,
    });

    await markAckSent(conversationId);
  } catch (error: any) {
    await logEvent('sla_ack_failed', 'conversation', String(conversationId), {
      leadId,
      to,
      error: error?.message || 'unknown',
    });
    // Fails open: the invariant is "best effort" — a failed ack must not
    // block the AI reply path.
  }
}

/**
 * Provider-aware ack dispatch. Call at the start of the ai_reply job.
 * Resolves the active provider, checks timing, sends ack if warranted.
 */
export async function dispatchAckIfNeeded(params: {
  conversationId: number;
  leadId: number;
  to: string;
  now?: Date;
}): Promise<{ sent: boolean; provider: AiProvider; reason: string }> {
  const { conversationId, leadId, to, now = new Date() } = params;

  const cfg = await getAiConfig();
  const provider = cfg.provider;

  // Already acked?
  if (await wasAckSent(conversationId)) {
    return { sent: false, provider, reason: 'already_acked' };
  }

  // Find the reply_received_at for this conversation
  const [row] = await sql`
    SELECT reply_received_at FROM inbound_latency
    WHERE conversation_id = ${conversationId}
    ORDER BY reply_received_at DESC
    LIMIT 1
  `;
  if (!row?.reply_received_at) {
    return { sent: false, provider, reason: 'no_latency_row' };
  }

  if (!shouldSendAck(provider, row.reply_received_at, now)) {
    return {
      sent: false,
      provider,
      reason: `within_threshold_${provider}`,
    };
  }

  await sendAckSms({ leadId, conversationId, to });
  return { sent: true, provider, reason: `threshold_crossed_${provider}` };
}
