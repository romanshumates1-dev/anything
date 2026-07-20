import { requireAdmin } from '@/app/api/utils/authz';
import { pauseSession } from '@/app/api/utils/negotiationSession';

/** Phase A — owner pause / take-over: instantly reverts the lead to escalation
 *  mode and cancels queued (unsent) offer jobs for the session. Deliberately
 *  NOT flag-gated: pausing must always work, even if the flag was flipped off
 *  mid-negotiation. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  const { id } = await props.params;
  const result = await pauseSession(id);
  return Response.json({ paused: true, cancelledJobs: result.cancelled });
}
