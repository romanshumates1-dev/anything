/**
 * Sanitize a third-party provider error before it reaches a client.
 *
 * WHY
 * ---
 * Integration "test connection" screens must tell an admin WHY their setup
 * failed, but raw SDK/Twilio/AWS error text is not safe to echo: Twilio embeds
 * the destination phone number and account identifiers, and AWS credential
 * errors can name the account. Those routes returned `error.message` verbatim
 * while the rest of the codebase standardized on `safeErrorResponse`.
 *
 * The pattern is not new - `outreach/verify/email/dns` already does exactly
 * this, using `.message?.includes(...)` to select a CANNED safe string. This
 * module generalizes it so every integration-test route behaves the same way.
 *
 * The full error is still logged server-side, so nothing is lost for debugging;
 * only the RESPONSE is sanitized.
 */

/** Classify a provider error into a message that is safe to show a tenant admin. */
export function sanitizeProviderError(
  error: unknown,
  provider: string
): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const text = raw.toLowerCase();

  // Ordered most-specific first: a credential problem is more useful to the
  // admin than the generic "couldn't connect".
  if (
    text.includes('credential') ||
    text.includes('unauthorized') ||
    text.includes('authentication') ||
    text.includes('auth') ||
    text.includes('permission denied') ||
    text.includes('accessdenied') ||
    text.includes('invalid api key') ||
    text.includes('api key')
  ) {
    return `${provider} rejected the credentials - check the API key/secret and account permissions`;
  }

  if (
    text.includes('from') && text.includes('number') ||
    text.includes('not a valid') ||
    text.includes('unverified') ||
    text.includes('21614') || // Twilio: unverified number
    text.includes('21211') // Twilio: invalid To number
  ) {
    return `${provider} rejected the destination number - check the phone number and its verification status`;
  }

  if (text.includes('timeout') || text.includes('timed out') || text.includes('etimedout')) {
    return `${provider} did not respond in time - check the host/region and any firewall rules`;
  }

  if (text.includes('not found') || text.includes('does not exist') || text.includes('404')) {
    return `${provider} could not find the requested resource - check the account, region and identifiers`;
  }

  if (text.includes('quota') || text.includes('limit') || text.includes('throttl')) {
    return `${provider} rejected the request for quota/limit reasons - check the account limits`;
  }

  // Deliberately generic. The raw text is logged, never returned.
  return `Could not connect to ${provider} - see server logs for details`;
}

/** Log the real error once, at the point it is caught. */
export function logProviderError(context: string, error: unknown): void {
  console.error(`[${context}] provider call failed`, error);
}
