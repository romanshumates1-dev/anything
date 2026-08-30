/**
 * Ghost Error Sweep API
 *
 * GET  - Run sweep without auto-fix (read-only health check)
 * POST - Run sweep WITH auto-fix (requires admin)
 *
 * Run before launching campaigns to ensure clean system state.
 */

import { requireAdmin } from '@/app/api/utils/authz';
import { runGhostErrorSweep, isSystemHealthyForCampaigns } from '@/app/api/utils/ghostErrorSweep';

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const url = new URL(request.url);
  const quickCheck = url.searchParams.get('quick') === 'true';

  if (quickCheck) {
    const health = await isSystemHealthyForCampaigns();
    return Response.json({
      healthy: health.healthy,
      blockers: health.blockers,
      timestamp: new Date().toISOString(),
    });
  }

  const result = await runGhostErrorSweep(false);
  return Response.json(result);
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const body = await request.json().catch(() => ({}));
  const autoFix = body.autoFix !== false; // default true for POST

  const result = await runGhostErrorSweep(autoFix);
  return Response.json(result);
}
