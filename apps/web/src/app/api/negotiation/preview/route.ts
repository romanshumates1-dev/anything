import { requireAdmin } from '@/app/api/utils/authz';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { getProfile } from '@/app/api/utils/negotiationProfiles';
import { computeValuation, type ValuationInputs } from '@/app/api/utils/valuationEngine';

/**
 * Phase N — live formula preview for the profile editor. Returns the OWNER-only
 * suggested min/max + confidence + trace for a sample property. Never emits a
 * prospect-facing number; this is a calculator for the owner UI.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { profileId?: string; inputs?: Partial<ValuationInputs> };
  if (!body.profileId) return Response.json({ error: 'profileId is required' }, { status: 400 });

  const profile = await getProfile(body.profileId);
  if (!profile) return Response.json({ error: 'profile not found' }, { status: 404 });

  const inputs: ValuationInputs = {
    arv: Number(body.inputs?.arv ?? 0),
    sqft: Number(body.inputs?.sqft ?? 0),
    conditionTier: (body.inputs?.conditionTier as any) ?? 'moderate',
    bigTicketFlags: Array.isArray(body.inputs?.bigTicketFlags) ? body.inputs!.bigTicketFlags! : [],
    hasAvm: Boolean(body.inputs?.hasAvm),
    compsCount: Number(body.inputs?.compsCount ?? 0),
    manualRepairs: body.inputs?.manualRepairs != null ? Number(body.inputs.manualRepairs) : undefined,
  };

  return Response.json({ valuation: computeValuation(inputs, profile) });
}
