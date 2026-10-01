/**
 * Unit tests for the SHARED provider-failure responder.
 *
 * Three routes now funnel provider outages through this one function
 * (negotiation/analyze, templates/generate, conversations/message). These
 * tests pin the contract all three depend on:
 *   - always 502 (upstream failure, not caller error),
 *   - a classifiable code, never the raw provider text,
 *   - an honest credit sentence (true/false changes the wording),
 *   - operatorAction and raw message never in the payload.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { providerFailureResponse } from '../providerFailureResponse';

const ANTHROPIC_CREDITS =
  'Anthropic API error [400]: {"type":"error","error":{"type":"invalid_request_error",' +
  '"message":"Your credit balance is too low to access the Anthropic API."},' +
  '"request_id":"req_011CfadwajxjUYuFaFnsBPcJ"}';

const BEDROCK_TOKEN =
  'Bedrock error [403] for model us.anthropic.claude-haiku-4-5-20251001-v1:0 - check: ' +
  '1) model is enabled in Bedrock console: The security token included in the request is invalid.';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('providerFailureResponse', () => {
  it('returns 502 for every classification', () => {
    for (const raw of [ANTHROPIC_CREDITS, BEDROCK_TOKEN, 'kaboom']) {
      const res = providerFailureResponse(new Error(raw), {
        context: 'test/route',
        creditReleased: true,
      });
      expect(res.status).toBe(502);
    }
  });

  it('never echoes raw provider text (request ids, model names) to the caller', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const raw of [ANTHROPIC_CREDITS, BEDROCK_TOKEN]) {
      const res = providerFailureResponse(new Error(raw), {
        context: 'test/route',
        creditReleased: true,
      });
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain('req_011CfadwajxjUYuFaFnsBPcJ');
      expect(text).not.toContain('us.anthropic.claude');
      expect(text).not.toContain('Plans & Billing');
    }
    // The raw text must still reach the server log for the operator.
    expect(spy).toHaveBeenCalled();
  });

  it('does NOT include operatorAction in the payload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = providerFailureResponse(new Error(BEDROCK_TOKEN), {
      context: 'test/route',
      creditReleased: true,
    });
    const body = await res.json();
    expect(body.operatorAction).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/ANTHROPIC_API_KEY|AWS_|env var/i);
  });

  it('states the credit WAS returned only when release succeeded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await (
      providerFailureResponse(new Error('x'), {
        context: 't',
        creditReleased: true,
      })
    ).json();
    expect(ok.creditReleased).toBe(true);
    expect(ok.hint).toMatch(/credit was returned/i);

    const failed = await (
      providerFailureResponse(new Error('x'), {
        context: 't',
        creditReleased: false,
      })
    ).json();
    expect(failed.creditReleased).toBe(false);
    expect(failed.hint).toMatch(/could not be returned/i);
    expect(failed.hint).not.toMatch(/credit was returned/i);
  });

  it('blames the service, not the caller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = await (
      providerFailureResponse(new Error(BEDROCK_TOKEN), {
        context: 't',
        creditReleased: true,
      })
    ).json();
    expect(body.error).toBe('AI service temporarily unavailable');
    expect(body.hint).toMatch(/temporarily unavailable/i);
    expect(body.hint.toLowerCase()).not.toMatch(/invalid input|check your|bad request/);
  });
});
