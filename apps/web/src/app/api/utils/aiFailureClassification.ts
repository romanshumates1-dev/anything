/**
 * Classify a provider failure into a REMEDIATION the operator can act on.
 *
 * WHY THIS EXISTS (2026-09-30): /api/system/ai-status faithfully reported the
 * raw provider error, which is honest but not actionable. A real probe of the
 * deployed configuration returned:
 *
 *   Anthropic: HTTP 400 "Your credit balance is too low to access the Anthropic
 *              API. Please go to Plans & Billing to upgrade or purchase credits."
 *   Bedrock:   HTTP 403 "The security token included in the request is invalid."
 *
 * Both mean "AI is dead", and both need a DIFFERENT fix: add credit to the
 * Anthropic account versus rotate/repair the AWS credentials. An operator
 * reading a raw SDK string has to know that distinction themselves; the health
 * surface is exactly where that translation belongs.
 *
 * This RE-CLASSIFIES, it does not swallow: the raw provider text is still
 * returned as `detail`, so nothing is hidden from an operator debugging this.
 *
 * Note the Anthropic case specifically: a depleted account returns HTTP 400,
 * NOT 401/402. Treating 400 as a generic "bad request" is what makes an empty
 * account look like a code bug instead of a billing problem.
 */
export type AiFailureCode =
  | 'credits_exhausted'
  | 'invalid_credentials'
  | 'access_denied'
  | 'model_not_enabled'
  | 'rate_limited'
  | 'not_configured'
  | 'unreachable'
  | 'unknown';

export interface AiFailureClassification {
  code: AiFailureCode;
  /** One line: what the operator must actually do. */
  operatorAction: string;
  /** Whether retrying unchanged could ever succeed. */
  retryable: boolean;
}

const CLASSIFIERS: Array<{
  match: RegExp;
  code: AiFailureCode;
  operatorAction: string;
  retryable: boolean;
}> = [
  {
    // Anthropic returns 400 (not 402) with this exact wording when the account
    // is out of credit. The key AUTHENTICATED successfully - it is the account
    // that is empty, so the fix is billing, not a credential rotation.
    match: /credit balance is too low|purchase credits|insufficient_quota|upgrade or purchase|billing/i,
    code: 'credits_exhausted',
    operatorAction:
      'Provider account is authenticated but out of credit. Add funds/credits to the provider account (Anthropic: Plans & Billing). The API key is valid - do not rotate it.',
    retryable: false,
  },
  {
    match: /security token included in the request is invalid|UnrecognizedClientException|InvalidClientTokenId|IncompleteSignature/i,
    code: 'invalid_credentials',
    operatorAction:
      'AWS rejected the access key or secret. Regenerate the IAM access key, update AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, and confirm the region matches the enabled model.',
    retryable: false,
  },
  {
    match: /AccessDenied|not authorized to perform|UnauthorizedOperation|is not authorized/i,
    code: 'access_denied',
    operatorAction:
      'The AWS identity is valid but lacks bedrock:InvokeModel. Attach an IAM policy allowing InvokeModel on the chosen model, then retry.',
    retryable: false,
  },
  {
    match: /not enabled|model_not_found|ValidationException/i,
    code: 'model_not_enabled',
    operatorAction:
      'Credentials and region are fine but the model id is wrong or not enabled. Confirm the exact model id for this region and enable model access in Bedrock.',
    retryable: false,
  },
  {
    match: /rate[_ -]?limit|too many requests|\b429\b/i,
    code: 'rate_limited',
    operatorAction: 'Throttled by the provider. Retry with backoff; no credential change is needed.',
    retryable: true,
  },
  {
    match: /invalid.*api[_ -]?key|authentication_error|\b401\b/i,
    code: 'invalid_credentials',
    operatorAction: 'The provider rejected the API key. Replace it and restart the deployment.',
    retryable: false,
  },
  {
    match: /ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT|not reachable|timed out|network/i,
    code: 'unreachable',
    operatorAction:
      'The provider endpoint could not be reached. Check network egress and, for Ollama, that `ollama serve` is running.',
    retryable: true,
  },
];

/** Best-effort classification. Never throws; an unrecognised error says so. */
export function classifyAiFailure(rawMessage: string | null | undefined): AiFailureClassification {
  const msg = rawMessage ?? '';

  for (const c of CLASSIFIERS) {
    if (c.match.test(msg)) {
      return { code: c.code, operatorAction: c.operatorAction, retryable: c.retryable };
    }
  }

  return {
    code: 'unknown',
    operatorAction:
      'Unrecognised provider failure. Read `detail` for the raw provider message and check the provider status page.',
    retryable: false,
  };
}

/** For the "selected provider is not configured at all" case. */
export function classifyAiNotConfigured(what: string): AiFailureClassification {
  return {
    code: 'not_configured',
    operatorAction: `${what} is not configured. Set the required environment variables and restart the deployment.`,
    retryable: false,
  };
}