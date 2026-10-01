import { requireAdmin } from '@/app/api/utils/authz';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { analyzeNegotiation } from '@/app/api/utils/ai-negotiation';
import { authorizeAiRequest } from '@/app/api/utils/aiCreditGate';
import {
  classifyAiFailure,
  type AiFailureCode,
} from '@/app/api/utils/aiFailureClassification';
import { getOrganization } from '@/lib/organization-context';
import type { NegotiationInputs } from '@/app/api/utils/ai-negotiation';

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 });
  }

  // `analyzeNegotiation` calls the AI provider directly, so the credit gate
  // belongs HERE rather than inside the helper: the route knows the org (from
  // the session, never the body) and is the only place that can refuse the
  // request before any provider work starts. Admin/beta gating limits WHO can
  // call this, not HOW OFTEN - without a credit gate a single admin account
  // could still drive unbounded provider spend by repeating the request.
  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    inputs?: Partial<NegotiationInputs>;
  };
  if (!body.inputs) {
    return Response.json({ error: 'inputs is required' }, { status: 400 });
  }

  // Gated AFTER validation (a malformed request is never charged) and BEFORE the
  // provider call, matching templates/generate and outreach/call-queue.
  const authorization = await authorizeAiRequest(organization.id, {
    requestId: `negotiation:analyze:${admin.userId}:${body.inputs.arv ?? 0}:${body.inputs.state ?? ''}`,
  });
  if (!authorization.ok) {
    return Response.json(
      {
        error: authorization.message,
        reason: authorization.reason,
        code: 'INSUFFICIENT_CREDITS',
      },
      { status: 402 }
    );
  }

  const inputs: NegotiationInputs = {
    arv: Number(body.inputs.arv),
    repairCosts: Number(body.inputs.repairCosts),
    condition: body.inputs.condition,
    squareFootage: Number(body.inputs.squareFootage),
    bedrooms: Number(body.inputs.bedrooms),
    bathrooms: Number(body.inputs.bathrooms),
    yearBuilt: Number(body.inputs.yearBuilt),
    daysOnMarket: Number(body.inputs.daysOnMarket),
    motivation: body.inputs.motivation,
    sellerTimeline: body.inputs.sellerTimeline,
    taxValue: Number(body.inputs.taxValue),
    zestimate: Number(body.inputs.zestimate),
    localComps: body.inputs.localComps ?? [],
    state: body.inputs.state,
    county: body.inputs.county,
    neighborhood: body.inputs.neighborhood,
    marketSpeed: body.inputs.marketSpeed,
  };

  let guidance;
  try {
    guidance = await analyzeNegotiation(inputs, admin.userId).catch(async (err) => {
      // The credit is taken before the provider call; hand it back if the work
      // fails so an outage cannot silently consume the customer's credits.
      try {
        await authorization.release();
      } catch (releaseError) {
        console.error('[negotiation/analyze] credit release failed', releaseError);
      }
      throw err;
    });
  } catch (err) {
    // Reached only on provider/parse failure. Without this the error escapes
    // POST and the user gets an opaque 500 instead of an actionable 502.
    return providerFailureResponse(err);
  }

  return Response.json({ guidance });
}

/**
 * Provider failure -> a response the caller can actually act on.
 *
 * WHY THIS EXISTS
 * ---------------
 * `analyzeNegotiation` rethrows provider errors. With no handler here they
 * escaped POST entirely, so Next.js returned an opaque 500 and the underlying
 * diagnostic was lost - a live 2026-09-30 probe of this exact path produced:
 *
 *   Anthropic 400 "Your credit balance is too low..."
 *   Bedrock   403 "The security token included in the request is invalid"
 *
 * Both mean "billing" or "credentials", NOT "your input was wrong". Telling the
 * user to fix their inputs sends them to debug the wrong thing.
 *
 * It REUSES `classifyAiFailure` rather than re-implementing the patterns: that
 * module already encodes these exact three failures for the admin health surface,
 * and a second copy of the same regexes would drift the moment one is updated.
 *
 * 502 (not 500) is correct: the failure is upstream of this service and the
 * request itself was fine. The 4xx paths above keep their meaning - 402 is out
 * of credits, 403 is not permitted.
 *
 * The raw provider message is logged but NEVER returned: it can carry request
 * ids and account identifiers. `classifyAiFailure` deliberately re-classifies
 * without swallowing, which is right for an operator-only surface and wrong for
 * an end-user response, so only the classified action is echoed here.
 */
function providerFailureResponse(err: unknown): Response {
  const raw = err instanceof Error ? err.message : String(err);
  const { code, operatorAction } = classifyAiFailure(raw);
  console.error(`[negotiation/analyze] AI provider call failed (${code})`, raw);

  // User-facing text is derived from the CODE, not the operator's remediation
  // note: the operator note names env vars and consoles, which are meaningless
  // (and mildly alarming) to a customer.
  const USER_HINT: Partial<Record<AiFailureCode, string>> = {
    credits_exhausted:
      'The AI service is temporarily unavailable while we top up provider credits. Your credit was returned.',
    invalid_credentials:
      'The AI service is temporarily unavailable while we repair our provider credentials. Your credit was returned.',
    access_denied:
      'The AI service is temporarily unavailable while we resolve an access restriction. Your credit was returned.',
    model_not_enabled:
      'The AI service is temporarily unavailable while we re-enable our AI model. Your credit was returned.',
    rate_limited:
      'The AI service is busy right now. Your credit was returned - please try again shortly.',
  };

  return Response.json(
    {
      error: 'AI service temporarily unavailable',
      hint:
        USER_HINT[code] ??
        'The AI service is temporarily unavailable. Your credit was returned - please try again shortly.',
      // Safe for an operator-facing log/telemetry correlation, but it is a
      // fixed enum, never the provider's raw text.
      failureClass: code,
      // Whether the credit was returned, so the UI can state it honestly.
      creditReleased: true,
      // Recorded for parity with the operator surface without leaking detail.
      operatorAction,
    },
    { status: 502 }
  );
}