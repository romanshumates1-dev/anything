/**
 * Guard for DEVELOPMENT-ONLY routes that can move money or forge signatures.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Three endpoints - `payments/mock-checkout`, `payments/mock-checkout/complete`,
 * and `esign/mock-sign` - were guarded by `NODE_ENV === 'production'` and
 * nothing else. `payments/mock-checkout/complete` is the serious one: it takes
 * a caller-supplied `pi` and `contractId` from a form body and runs
 *
 *     UPDATE payments_ledger SET status = 'paid' ... WHERE stripe_payment_intent_id = ?
 *
 * with NO session, NO admin check and NO secret. A single environment
 * variable being wrong - NODE_ENV unset, a staging box serving real customers,
 * a `next start` launched without it - turns that into unauthenticated payment
 * fraud. `esign/mock-sign` is the same shape: it forges a 'signed' webhook
 * event against `/api/esign/webhook`, which would mark arbitrary contracts as
 * signed.
 *
 * `NODE_ENV` alone is not a security boundary. This repository already says so
 * in `lib/organization-context.ts`: "SECURITY: Never rely on NODE_ENV alone as
 * it could be misconfigured", and it pairs the env check with a shared secret
 * compared in constant time. This module applies that SAME established pattern
 * to the dev-only routes, so the two halves of the codebase cannot drift.
 *
 * DEFENCE IN DEPTH
 * A dev route now requires ALL of:
 *   1. NODE_ENV to not be 'production'  (the cheap, primary gate)
 *   2. LOCAL_DEV_SECRET to be configured  (fail closed if unset)
 *   3. a matching `x-local-dev` header     (constant-time compared)
 * So a misconfigured NODE_ENV alone is no longer sufficient, and a leaked URL
 * is not enough either.
 */
import { timingSafeSecretEqual } from './secretCompare';

/**
 * @returns a 404 Response when the request must not be served, otherwise null.
 *          Returning null means "safe to continue" - callers must handle it.
 */
export function devOnlyGuard(request: Request): Response | null {
  // Primary gate: an ALLOW-LIST, not a block-list.
  //
  // The original code was `if (NODE_ENV === 'production') return 404`, which
  // permits 'staging', 'preview', 'test' and - the dangerous one - an UNSET
  // NODE_ENV. A staging box serving real customers, or a `next start` launched
  // without it, is exactly the deployment that must never expose a payment
  // bypass. Only an explicit 'development' may proceed; everything else,
  // including an unset or misspelt value, is refused.
  if (process.env.NODE_ENV !== 'development') {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fail CLOSED when no secret is configured. Defaulting to "allow" here would
  // reproduce the original vulnerability whenever the deploy forgets the var.
  const devSecret = process.env.LOCAL_DEV_SECRET;
  if (!devSecret) {
    console.error(
      '[devOnlyGuard] LOCAL_DEV_SECRET is unset; refusing a development-only route'
    );
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!timingSafeSecretEqual(request.headers.get('x-local-dev'), devSecret)) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}
