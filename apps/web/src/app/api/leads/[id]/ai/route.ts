import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../../../utils/logger';

/**
 * Toggle (or explicitly set) the pause-AI flag for a lead. When paused, the
 * inbound SMS handler will NOT enqueue an automatic AI reply for this lead.
 *
 * POST /api/leads/[id]/ai
 *   body (optional): { paused: boolean }  — when omitted, the flag is toggled.
 * Returns: { leadId, aiPaused }
 *
 * Ghost-feature note (verification sprint 2026-07): the inbox UI already calls
 * this route; it did not exist until now (404).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const leadId = params.id;
  if (!leadId) {
    return Response.json({ error: 'Lead ID is required' }, { status: 400 });
  }

  // Body is optional; a bare toggle sends no body.
  let explicit: boolean | undefined;
  try {
    const body = await request.json();
    if (typeof body?.paused === 'boolean') explicit = body.paused;
  } catch {
    // no/invalid body -> toggle
  }

  const [lead] = await sql`SELECT id, ai_paused FROM leads WHERE id = ${leadId} LIMIT 1`;
  if (!lead) {
    return Response.json({ error: 'Lead not found' }, { status: 404 });
  }

  const next = explicit !== undefined ? explicit : !lead.ai_paused;

  await sql`UPDATE leads SET ai_paused = ${next} WHERE id = ${leadId}`;

  await logEvent('ai_pause_toggled', 'lead', String(leadId), { aiPaused: next }, session.user.id);

  return Response.json({ leadId, aiPaused: next });
}
