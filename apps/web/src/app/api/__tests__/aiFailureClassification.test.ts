/**
 * AI FAILURE CLASSIFICATION — the operator-facing translation layer.
 *
 * These tests pin the CLASSIFICATION of the two real failures observed against
 * the deployed configuration on 2026-09-30. Both returned HTTP-level failures
 * that a naive reader would misdiagnose:
 *
 *   - Anthropic 400 "credit balance is too low" looks like a malformed request.
 *     It is not: the key AUTHENTICATED, and the account is simply empty. The
 *     correct action is billing, and rotating the key would be pure waste.
 *   - Bedrock 403 "security token included in the request is invalid" looks
 *     like an auth problem that a different key would fix, and here it does -
 *     but it is a DIFFERENT fix from the Anthropic case, and both were failing
 *     at the same time.
 *
 * Getting these two conflated is how an outage stays broken for days.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyAiFailure,
  classifyAiNotConfigured,
// The module lives at src/app/api/utils/. From src/app/api/__tests__/ that is
// exactly one level up - `../utils/...`. Both `./utils/...` (resolves inside
// __tests__) and `../...` (resolves to src/app/api/) are wrong, and an
// unresolvable import here does not fail the run: the file silently collects
// ZERO tests and the suite stays green.
} from '../utils/aiFailureClassification';

describe('classifyAiFailure', () => {
  it('classifies the REAL Anthropic out-of-credit error as billing, not a bad key', () => {
    // Verbatim from the live probe. Note HTTP 400.
    const raw =
      'Anthropic API error [400]: {"type":"error","error":{"type":"invalid_request_error",' +
      '"message":"Your credit balance is too low to access the Anthropic API. Please go to ' +
      'Plans & Billing to upgrade or purchase credits."},"request_id":"req_abc"}';

    const c = classifyAiFailure(raw);

    expect(c.code).toBe('credits_exhausted');
    // The decisive part: the action must NOT be "rotate the API key".
    expect(c.operatorAction).toMatch(/do not rotate it/i);
    expect(c.retryable).toBe(false);
  });

  it('classifies the REAL Bedrock invalid-token error as a credential problem', () => {
    const raw =
      'Bedrock error [403] for model us.anthropic.claude-haiku-4-5-20251001-v1:0 — ' +
      'check: 1) model is enabled in Bedrock console, 2) region matches, 3) IAM has ' +
      'bedrock:InvokeModel permission: The security token included in the request is invalid.';

    const c = classifyAiFailure(raw);

    expect(c.code).toBe('invalid_credentials');
    expect(c.operatorAction).toMatch(/AWS_ACCESS_KEY_ID/);
    expect(c.retryable).toBe(false);
  });

  it('distinguishes the two live failures from each other', () => {
    // This is the whole point: both mean "AI dead", and they need DIFFERENT fixes.
    const anthropic = classifyAiFailure('Your credit balance is too low to access the Anthropic API.');
    const bedrock = classifyAiFailure('The security token included in the request is invalid.');
    expect(anthropic.code).not.toBe(bedrock.code);
    expect(anthropic.operatorAction).not.toBe(bedrock.operatorAction);
  });

  it('maps AccessDenied to an IAM policy fix, not a key rotation', () => {
    const c = classifyAiFailure(
      'Bedrock error [403]: User is not authorized to perform: bedrock:InvokeModel'
    );
    expect(c.code).toBe('access_denied');
    expect(c.operatorAction).toMatch(/InvokeModel/);
    // The credential is fine here; telling someone to regenerate the key would
    // be actively misleading.
    expect(c.operatorAction).not.toMatch(/Regenerate the IAM access key/i);
  });

  it('maps a not-enabled model to a model/region fix', () => {
    const c = classifyAiFailure(
      'The provided model identifier is invalid or the model is not enabled: us.anthropic.claude-x'
    );
    expect(c.code).toBe('model_not_enabled');
    expect(c.operatorAction).toMatch(/enable model access/i);
  });

  it('marks throttling and network errors RETRYABLE, unlike credential errors', () => {
    expect(classifyAiFailure('rate_limit_error: Too many requests').retryable).toBe(true);
    expect(classifyAiFailure('429 slow down').retryable).toBe(true);
    expect(classifyAiFailure('ECONNREFUSED 127.0.0.1:11434').retryable).toBe(true);
    expect(classifyAiFailure('fetch failed').retryable).toBe(true);

    // Non-retryable: retrying unchanged can never succeed.
    expect(classifyAiFailure('invalid x-api-key').retryable).toBe(false);
    expect(classifyAiFailure('credit balance is too low').retryable).toBe(false);
  });

  it('maps a generic 401 to a key problem', () => {
    const c = classifyAiFailure('401 Unauthorized: invalid api key');
    expect(c.code).toBe('invalid_credentials');
    expect(c.operatorAction).toMatch(/Replace it/i);
  });

  it('never throws and admits when it does not recognise the error', () => {
    const c = classifyAiFailure('the flurble wozzles');
    expect(c.code).toBe('unknown');
    expect(c.operatorAction).toMatch(/status page/i);
    // An unknown error must NOT be presented as retryable - that invites a
    // pointless retry loop against a deterministic failure.
    expect(c.retryable).toBe(false);
  });

  it('handles null/undefined/empty without throwing', () => {
    expect(() => classifyAiFailure(null)).not.toThrow();
    expect(classifyAiFailure(undefined).code).toBe('unknown');
    expect(classifyAiFailure('').code).toBe('unknown');
  });

  it('classifies a missing configuration distinctly from a failure', () => {
    const c = classifyAiNotConfigured('Bedrock');
    expect(c.code).toBe('not_configured');
    expect(c.operatorAction).toContain('Bedrock');
    expect(c.retryable).toBe(false);
  });
});