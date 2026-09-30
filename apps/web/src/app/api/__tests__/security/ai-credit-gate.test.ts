/**
 * AI CREDIT GATE RATCHET (2026-09-30).
 *
 * Every route that can reach a paid AI provider on a user-triggered request
 * must pass through `authorizeAiRequest` BEFORE the provider call. That gate is
 * what enforces the plan's monthly allowance, the 25%-of-monthly weekly cap and
 * the 20%-of-weekly daily cap, while leaving PURCHASED credits uncapped.
 *
 * The class of bug this prevents is not hypothetical: POST
 * /api/conversations/message reached `orchestrateAIResponse` on every accepted
 * message while every other AI entry point was gated, so one authenticated
 * account could drive unmetered provider spend. Nothing failed; the spend just
 * did not appear against any plan.
 *
 * SCOPE, stated honestly: this is a static ratchet over API route files. It
 * proves each route file references the gate; it cannot prove the gate is
 * positioned before the provider call at runtime, which the per-route tests in
 * ai-adversarial.test.ts and the aiCreditGate suite cover behaviourally.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { scanSource, readSource, SRC_ROOT } from './_sourceScan';

const SRC = SRC_ROOT;

/** Utilities that legitimately call a provider without a per-request charge. */
const NON_ROUTING_ALLOWLIST = [
  // Shared dispatch layer + provider clients: they are what the gate guards,
  // not consumers of it.
  'app/api/utils/ai-provider.ts',
  'app/api/utils/ai-settings.ts',
  'app/api/utils/ai-negotiation.ts',
  'app/api/utils/ai-orchestrator.ts',
  'app/api/utils/anthropic-client.ts',
  'app/api/utils/bedrock-client.ts',
  'app/api/utils/ollama-client.ts',
  'app/api/utils/ai-negotiation-types.ts',
  // Health/observability probes deliberately make a real, tiny provider call to
  // report truthful status. They are operator-facing and rate-limited, not a
  // customer spend path.
  'app/api/system/ai-status/route.ts',
  'app/api/system/health/route.ts',
  'app/api/utils/pipeline-health-engine.ts',
  'app/api/utils/evalHarness.ts',
];

/**
 * Batch/background engines reached from job handlers, not from a user's HTTP
 * request.
 *
 * `negotiationProcessor` was REMOVED from this list on 2026-09-30: it now gates
 * its own AI calls (extractPriceFromMessage / generateNegotiationProse) and
 * degrades to the deterministic regex/template paths on exhaustion, so
 * automated negotiation is metered without ever stalling a live deal.
 */
const NON_USER_TRIGGERED_ALLOWLIST = [
  'app/api/utils/buyerPipelineEngine.ts',
  'app/api/utils/callSchedulingEngine.ts',
  'app/api/utils/campaignEngine.ts',
  'app/api/utils/simplifierEngine.ts',
  'app/api/utils/socialMediaEngine.ts',
  'app/api/utils/spamDetectionEngine.ts',
];

/**
 * Routes that reach a provider INDIRECTLY but are already correctly metered,
 * because the helper they call performs the gate itself.
 *
 * Kept as an explicit, documented exemption rather than left to inference: a
 * reviewer who deletes the gate from `brief.ts` should be forced to notice this
 * line instead of quietly opening a spend leak.
 */
const SELF_METERED_ALLOWLIST = [
  // brief.ts calls authorizeAiRequest() before the provider call and releases
  // on failure, so every brief generated through this route is already charged.
  'app/api/outreach/call-queue/route.ts',
];

/**
 * Metered by PLAN ALLOWANCE rather than by credit debit, and deliberately so.
 *
 * The support assistant is a support surface, not a product feature a customer
 * buys more of. Charging AI credits to ask "how do I import leads" would punish
 * exactly the user who is stuck and least able to pay, and would read as a bug
 * to anyone who hit it.
 *
 * It is NOT unmetered: `POST /api/support/chat` calls
 * `checkRateLimit(..., 'ai_request')`, which resolves through the caller's own
 * plan to `ai_request_allowance` with BOTH a daily and a weekly window. A
 * support-hammering account is therefore capped by its plan exactly like a
 * credit-metered route - it simply is not debited.
 *
 * FLAGGED FOR THE PRODUCT OWNER: if support is ever expected to be a
 * meaningful AI cost centre, add `authorizeAiRequest` here deliberately and
 * surface the charge in the UI. Do not let it become unbounded by accident.
 */
const SUPPORT_SURFACE_ALLOWLIST = ['app/api/support/chat/route.ts'];

const GATE = 'authorizeAiRequest';
/**
 * How a route can reach a paid provider.
 *
 * DIRECT: the route itself calls a provider client.
 *
 * INDIRECT (the case the first version of this ratchet MISSED): the route calls
 * a shared engine that calls the provider. `conversations/message` only ever
 * named `orchestrateAIResponse`, so a direct-only pattern scored it clean even
 * after its gate was deleted - verified by probe, and the reason both lists are
 * matched here. A gate that cannot see indirect AI is not a gate.
 */
const DIRECT_PROVIDER_CALLS = [
  /callAI\s*\(/,
  /callAnthropic\s*\(/,
  /callBedrock\s*\(/,
  /callOllama\s*\(/,
];

/** Shared engines/helpers that reach a provider on the caller's behalf. */
const INDIRECT_AI_ENTRYPOINTS = [
  /orchestrateAIResponse\s*\(/,
  /analyzeNegotiation\s*\(/,
  /generateCallBrief\s*\(/,
  /getOrGenerateBrief\s*\(/,
  /generateTemplate|generateMessageTemplate\s*\(/,
  /AiRecommendations|aiRecommendations\s*\(/,
  /runNegotiation|processNegotiation\s*\(/,
  /scoreAndEnrich|generateLeadScore\s*\(/,
];

describe('AI credit gate ratchet', () => {
  it('every route that reaches an AI provider is gated', () => {
    const offenders: string[] = [];
    const files = scanSource(SRC);

    // Vacuous-pass guard: a scan that collapsed would report zero offenders
    // forever and the ratchet would be worthless.
    expect(files.length, 'source scan collapsed - guard would pass vacuously')
      .toBeGreaterThan(600);

    for (const file of files) {
      const rel = file.replace(process.cwd(), '').replace(/\\/g, '/');
      if (!rel.endsWith('route.ts')) continue;
      if (NON_ROUTING_ALLOWLIST.some((a) => rel.endsWith(a))) continue;
      if (NON_USER_TRIGGERED_ALLOWLIST.some((a) => rel.endsWith(a))) continue;
      if (SUPPORT_SURFACE_ALLOWLIST.some((a) => rel.endsWith(a))) continue;
      if (SELF_METERED_ALLOWLIST.some((a) => rel.endsWith(a))) continue;

      const text = readSource(file);
      // A route reaches the provider either directly or through a shared engine.
      const reachesProvider =
        DIRECT_PROVIDER_CALLS.some((re) => re.test(text)) ||
        INDIRECT_AI_ENTRYPOINTS.some((re) => re.test(text));
      if (!reachesProvider) continue;

      if (!text.includes(GATE)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
  }, 30_000);

  it('the inbox conversation route is actually gated (regression anchor)', () => {
    // Named explicitly so that removing the gate from THIS route is caught even
    // if the generic ratchet above is later weakened by an allowlist edit.
    const text = readSource(join(SRC, 'app/api/conversations/message/route.ts'));
    expect(text).toContain(GATE);
    expect(text).toContain('INSUFFICIENT_CREDITS');
    // And it must hand the credit back when the provider fails.
    expect(text).toMatch(/release/);
  }, 30_000);

  it('automated negotiation is metered (regression anchor)', () => {
    // Background negotiation is money-critical, so this is anchored by name:
    // it must stay metered AND must keep its deterministic fallbacks, because
    // those are what stop an exhausted plan from stalling a live deal.
    const text = readSource(join(SRC, 'app/api/utils/negotiationProcessor.ts'));
    expect(text).toContain(GATE);
    // Exhaustion must degrade, never throw the job away.
    expect(text).toContain('ai_credits_exhausted');
    expect(text).toContain('fallbackTemplate');
  }, 30_000);
});
