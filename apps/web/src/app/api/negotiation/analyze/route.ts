import { requireAdmin } from '@/app/api/utils/authz';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { analyzeNegotiation } from '@/app/api/utils/ai-negotiation';
import type { NegotiationInputs } from '@/app/api/utils/ai-negotiation';

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    inputs?: Partial<NegotiationInputs>;
  };
  if (!body.inputs) {
    return Response.json({ error: 'inputs is required' }, { status: 400 });
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

  const guidance = await analyzeNegotiation(inputs, admin.userId);
  return Response.json({ guidance });
}