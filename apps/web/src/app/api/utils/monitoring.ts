/**
 * Error monitoring seam (Gap G-6).
 *
 * A single choke point for "something went wrong on a server path" so ops has
 * one place to see failures. Dependency-free by design: it always logs a
 * structured line, and — if MONITORING_WEBHOOK_URL is set — best-effort POSTs
 * the event to that URL (a Slack/Sentry-webhook/HTTP collector). No vendor SDK,
 * so nothing new to install; swapping in a real APM later is a one-file change.
 *
 * Never throws: monitoring must not be able to break the path it observes.
 */
export interface ErrorContext {
  /** Where it happened, e.g. 'billing.webhook' or 'jobs.processNextJob'. */
  scope: string;
  /** Any structured extra (ids, status), no secrets. */
  meta?: Record<string, unknown>;
}

export async function reportError(err: unknown, context: ErrorContext): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // 1. Always log a structured line (picked up by the platform's log drain).
  console.error(`[monitor] ${context.scope}: ${message}`, {
    scope: context.scope,
    meta: context.meta,
  });

  // 2. Best-effort external notification.
  const url = process.env.MONITORING_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'dealflow-web',
        scope: context.scope,
        message,
        stack: stack?.split('\n').slice(0, 5).join('\n'),
        meta: context.meta,
        env: process.env.NODE_ENV,
      }),
    });
  } catch (e) {
    // Never let the monitor break the caller.
    console.error('[monitor] failed to POST to MONITORING_WEBHOOK_URL', (e as Error).message);
  }
}
