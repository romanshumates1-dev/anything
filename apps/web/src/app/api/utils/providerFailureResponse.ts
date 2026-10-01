/**
 * Provider failure -> a response the caller can actually act on.
 *
 * WHY THIS EXISTS (2026-09-30)
 * ----------------------------
 * `negotiation/analyze` used to have NO handler around its provider call, so
 * provider errors escaped POST entirely and Next.js returned an opaque 500 -
 * a live probe of that exact path produced:
 *
 *   Anthropic 400 "Your credit balance is too low..."
 *   Bedrock   403 "The security token included in the request is invalid"
 *
 * Both mean "billing" or "credentials", NOT "your input was wrong". Telling
 * the user to fix their input sends them to debug the wrong thing. The same
 * defect existed in `templates/generate` (generic 500 "Failed to generate")
 * and `conversations/message` (generic "Internal Server Error"), so the
 * handler lives HERE once instead of being copied per route - a second copy
 * of the classification wiring would drift the moment one is updated.
 *
 * It REUSES `classifyAiFailure` rather than re-implementing the patterns: that
 * module already encodes these failures for the admin health surface
 * (/api/system/ai-status), which keeps returning the raw `detail` to operators.
 *
 * 502 (not 500) is correct: the failure is upstream of this service and the
 * request itself was fine. The 4xx paths keep their meaning - 402 is out of
 * credits, 403 is not permitted, 400 is bad input.
 *
 * WHAT NEVER LEAVES THE SERVER
 * ----------------------------
 * The raw provider message is logged but NEVER returned: it carries request
 * ids, model names and account identifiers. The user-facing text is derived
 * from the classified CODE only. `operatorAction` (which names env vars and
 * consoles) is deliberately NOT in the payload either - it is meaningless and
 * mildly alarming to a customer, and operators get it from `ai-status` plus
 * the server log line this function writes.
 */
import {
  classifyAiFailure,
  type AiFailureCode,
} from './aiFailureClassification';

export interface ProviderFailureOptions {
  /** Route label for the server log line, e.g. 'negotiation/analyze'. */
  context: string;
  /**
   * Whether the credit consumed before the provider call was successfully
   * handed back. The caller passes the REAL outcome: if `release()` itself
   * failed, saying "your credit was returned" would be a lie.
   */
  creditReleased: boolean;
}

const USER_HINT: Partial<Record<AiFailureCode, string>> = {
  credits_exhausted:
    'The AI service is temporarily unavailable while we top up provider credits.',
  invalid_credentials:
    'The AI service is temporarily unavailable while we repair our provider credentials.',
  access_denied:
    'The AI service is temporarily unavailable while we resolve an access restriction.',
  model_not_enabled:
    'The AI service is temporarily unavailable while we re-enable our AI model.',
  rate_limited: 'The AI service is busy right now - please try again shortly.',
};

export function providerFailureResponse(
  err: unknown,
  { context, creditReleased }: ProviderFailureOptions
): Response {
  const raw = err instanceof Error ? err.message : String(err);
  const { code } = classifyAiFailure(raw);
  console.error(`[${context}] AI provider call failed (${code})`, raw);

  const base =
    USER_HINT[code] ?? 'The AI service is temporarily unavailable.';
  const creditSentence = creditReleased
    ? ' Your credit was returned.'
    : ' The credit used for this request could not be returned automatically - please contact support if your balance looks wrong.';

  return Response.json(
    {
      error: 'AI service temporarily unavailable',
      hint: `${base}${creditSentence}`,
      // Safe for telemetry correlation: a fixed enum, never the provider's
      // raw text.
      failureClass: code,
      // Whether the credit was returned, so the UI can state it honestly.
      creditReleased,
    },
    { status: 502 }
  );
}