import { requireAdmin } from '@/app/api/utils/authz';
import { logEvent } from '@/app/api/utils/logger';
import { getBetaFlags, setBetaFlags, BETA_FLAG_KEYS, type BetaFlags } from '@/app/api/utils/betaFlags';

/**
 * Beta integration flags (admin). GET current; PATCH a partial toggle.
 * Toggling is live (no restart) — the flag cache is busted on write, so
 * /api/system/health reflects it well under 1s.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  return Response.json({ flags: await getBetaFlags(), keys: BETA_FLAG_KEYS });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<BetaFlags> = {};
  for (const k of BETA_FLAG_KEYS) if (typeof body[k] === 'boolean') patch[k] = body[k] as boolean;

  if (Object.keys(patch).length === 0) {
    return Response.json(
      { error: `Provide at least one boolean flag: ${BETA_FLAG_KEYS.join(', ')}` },
      { status: 400 }
    );
  }

  const flags = await setBetaFlags(patch, admin.userId);
  // Every flag change is an auditable Event Log entry.
  await logEvent('beta_flag_changed', 'app_setting', 'beta_flags', { changed: patch, flags }, admin.userId);
  return Response.json({ flags });
}
