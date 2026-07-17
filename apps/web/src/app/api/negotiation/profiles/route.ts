import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { listProfiles, createProfile, validateProfileInput, type ProfileInput } from '@/app/api/utils/negotiationProfiles';

/** Phase N — negotiation profiles (admin, flag-gated). GET list; POST create. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 });
  }
  return Response.json({ profiles: await listProfiles() });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  if (!(await isBetaFlagOn('negotiationProfiles'))) {
    return Response.json({ error: 'negotiationProfiles beta flag is off' }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Partial<ProfileInput>;
  const err = validateProfileInput(body);
  if (err) return Response.json({ error: err }, { status: 400 });

  const profile = await createProfile(body as ProfileInput);
  await logEvent('negotiation_profile_created', 'app_setting', profile.id, { name: profile.name }, admin.userId);
  return Response.json({ profile }, { status: 201 });
}
