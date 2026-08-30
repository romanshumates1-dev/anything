import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { getOrganization } from '@/lib/organization-context';
import { getProfile, updateProfile, validateProfileInput, type ProfileInput } from '@/app/api/utils/negotiationProfiles';

async function guard() {
  const admin = await requireAdmin();
  if (!admin.ok) return { block: admin.response as Response, userId: '', orgId: '' };
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return { block: Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 }), userId: '', orgId: '' };
  }
  const organization = await getOrganization();
  if (!organization) {
    return { block: Response.json({ error: 'No organization found' }, { status: 403 }), userId: '', orgId: '' };
  }
  return { block: null, userId: admin.userId, orgId: organization.id };
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.block) return g.block;
  const { id } = await props.params;
  const profile = await getProfile(id, g.orgId);
  if (!profile) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ profile });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.block) return g.block;
  const { id } = await props.params;
  const body = (await request.json().catch(() => ({}))) as Partial<ProfileInput>;
  const err = validateProfileInput({ name: body.name ?? 'x', ...body });
  if (err && err !== 'name is required') return Response.json({ error: err }, { status: 400 });

  const profile = await updateProfile(id, g.orgId, body);
  if (!profile) return Response.json({ error: 'Not found' }, { status: 404 });
  await logEvent('negotiation_profile_updated', 'app_setting', id, { changed: Object.keys(body) }, g.userId);
  return Response.json({ profile });
}
