/**
 * channelCircuitBreaker — per-channel circuit breakers for email and mail.
 *
 * Extends the SMS gateway's existing CircuitBreaker pattern (gateway/circuit-breaker.ts)
 * to the email and mail channels. One channel failing does NOT block or crash
 * campaigns on other channels — graceful degradation, Phase 0B requirement.
 *
 * State: in-process singletons (same pattern as the SMS gateway). A restart
 * resets state, which is correct: a fresh process should probe the channel
 * rather than inherit a stale OPEN state from before the restart.
 *
 * Thresholds are conservative for email deliverability:
 *   - 3 consecutive failures → OPEN (same as SMS gateway default)
 *   - 30s recovery delay before HALF_OPEN probe
 *   - delivery rate < 85% over a 10-minute window → OPEN
 */
import { CircuitBreaker } from '@/app/api/gateway/circuit-breaker';

const EMAIL_BREAKER_CONFIG = {
  failureThreshold: 3,
  recoveryDelayMs: 30_000,
  deliveryRateThreshold: 0.85,
  halfOpenProbeTimeoutMs: 10_000,
  windowSizeMs: 10 * 60_000,
};

const MAIL_BREAKER_CONFIG = {
  failureThreshold: 3,
  recoveryDelayMs: 60_000,
  deliveryRateThreshold: 0.90,
  halfOpenProbeTimeoutMs: 15_000,
  windowSizeMs: 30 * 60_000,
};

let emailBreaker: CircuitBreaker | null = null;
let mailBreaker: CircuitBreaker | null = null;

export function getEmailCircuitBreaker(): CircuitBreaker {
  if (!emailBreaker) emailBreaker = new CircuitBreaker('email', EMAIL_BREAKER_CONFIG);
  return emailBreaker;
}

export function getMailCircuitBreaker(): CircuitBreaker {
  if (!mailBreaker) mailBreaker = new CircuitBreaker('mail', MAIL_BREAKER_CONFIG);
  return mailBreaker;
}

/** Reset both breakers — test helper only. */
export function __resetCircuitBreakers(): void {
  emailBreaker = null;
  mailBreaker = null;
}

export type ChannelBreakerStatus = {
  channel: string;
  state: string;
  failureCount: number;
  deliveryRate: number;
  timeSinceChangeMs: number;
};

export function getChannelBreakerStatuses(): ChannelBreakerStatus[] {
  return [
    { channel: 'email', ...getEmailCircuitBreaker().getStats() },
    { channel: 'mail', ...getMailCircuitBreaker().getStats() },
  ].map((s) => ({
    channel: s.channel,
    state: s.state,
    failureCount: s.failureCount,
    deliveryRate: s.deliveryRate,
    timeSinceChangeMs: s.timeSinceChange,
  }));
}
