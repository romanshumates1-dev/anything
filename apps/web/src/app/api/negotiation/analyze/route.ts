import { requireAdmin } from '@/app/api/utils/authz';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { analyzeNegotiation } from '@/app/api/utils/ai-negotiation';
import { authorizeAiRequest } from '@/app/api/utils/aiCreditGate';
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

  const guidance = await analyzeNegotiation(inputs, admin.userId).catch(async (err) => {
    // The credit is taken before the provider call; hand it back if the work
    // fails so an outage cannot silently consume the customer's credits.
    try {
      await authorization.release();
    } catch (releaseError) {
      console.error('[negotiation/analyze] credit release failed', releaseError);
    }
    throw err;
  });
  return Response.json({ guidance });
}