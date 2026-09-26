/**
 * A single place to turn an unknown thrown value into a response that is safe to send
 * to a client, while keeping the real error in the server log.
 *
 * Dozens of routes did `Response.json({ error: error.message })`. On a payment, credit
 * or contract route that can leak driver text, SQL fragments, upstream provider payloads
 * or internal identifiers to an unauthenticated caller. `safeErrorResponse` logs the
 * detail and returns a generic message plus a correlation id the operator can look up.
 *
 * Returns a `NextResponse` so it can be returned directly from handlers that declare a
 * `NextResponse` return type.
 */
import { NextResponse } from 'next/server';

export interface SafeErrorOptions {
  /** Log prefix, e.g. '[payments/buyer-payment]'. */
  context: string;
  /** HTTP status to return. Default 500. */
  status?: number;
  /** Generic client-facing message. Default 'Internal Server Error'. */
  message?: string;
  /** Extra non-sensitive fields to include in the response body. */
  extra?: Record<string, unknown>;
  /** Optional error code for the client, e.g. 'PAYMENT_FAILED'. */
  code?: string;
}

/** Stable-ish id to correlate a client report with a server log line. */
function correlationId(): string {
  try {
    return `err_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return 'err_unavailable';
  }
}

export function safeErrorResponse(error: unknown, opts: SafeErrorOptions): NextResponse {
  const { context, status = 500, message = 'Internal Server Error', extra = {}, code } = opts;
  const ref = correlationId();

  // The full error goes to the server log only — never to the client.
  console.error(`${context} [${ref}]`, error);

  return NextResponse.json(
    {
      error: message,
      ...(code ? { code } : {}),
      reference: ref,
      ...extra,
    },
    { status }
  );
}
