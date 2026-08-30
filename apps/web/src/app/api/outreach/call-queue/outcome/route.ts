import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import { registerOptOut } from '@/app/api/utils/compliance';
import { recordStageTransition } from '@/app/api/services/stageTransitionRecorder';
import { enqueueJob } from '@/app/api/utils/jobs';

/**
 * POST /api/outreach/call-queue/outcome — log the result of a MANUAL call and
 * push the lead into the same pipeline states every other channel uses.
 *
 * One-click outcome logging is what makes the manual channel converge with
 * email and mail: an "interested" call produces the same CONTACTED/ENGAGED
 * stage transition an emailed reply would, so the funnel counts a human
 * conversation identically.
 *
 * "do_not_call" routes through registerOptOut, NOT a local flag, so a verbal
 * "never call me again" fans out across every channel — the caller should not
 * have to also remember to stop the postcards. This is the single most
 * important outcome to get right: it is the one the prospect will remember.
 *
 * Body: { leadId, outcome, notes? }
 */

/** Outcome -> funnel stage. Only outcomes that MOVE the funnel map to a stage. */
const OUTCOME_STAGE: Record<string, string | null> = {
  interested: 'ENGAGED',
  callback: 'CONTACTED',
  not_interested: 'CLOSED_LOST',
  do_not_call: 'CLOSED_LOST',
  no_answer: null, // reached nobody — no funnel movement
  wrong_number: null,
  voicemail: null,
};

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  try {
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const b = (await request.json().catch(() => ({}))) as {
      leadId?: unknown;
      outcome?: unknown;
      notes?: unknown;
    };

    const leadId = Number(b.leadId);
    const outcome = typeof b.outcome === 'string' ? b.outcome : '';
    const notes = typeof b.notes === 'string' ? b.notes.slice(0, 2000) : null;

    // Number(null) === 0 and Number(undefined) === NaN, so check the raw
    // value explicitly before the integer test.
    if (b.leadId == null || !Number.isInteger(leadId)) {
      return Response.json({ error: 'leadId is required' }, { status: 400 });
    }
    if (!(outcome in OUTCOME_STAGE)) {
      return Response.json(
        { error: 'invalid outcome', allowed: Object.keys(OUTCOME_STAGE) },
        { status: 400 }
      );
    }

    // Org-scoped: a caller must not be able to log an outcome against another
    // tenant's lead by guessing an id.
    const [lead] = await sql`
      SELECT id, phone FROM leads
      WHERE id = ${leadId} AND organization_id = ${organization.id}
      LIMIT 1
    `;
    if (!lead) {
      return Response.json({ error: 'Lead not found' }, { status: 404 });
    }

    // A verbal do-not-call is a real opt-out. Fan it out before anything else,
    // so a failure later in this handler cannot leave the person reachable.
    if (outcome === 'do_not_call' && lead.phone) {
      await registerOptOut(lead.phone, 'sms', {
        reason: 'verbal_do_not_call',
        source: 'manual_call',
      });
    }

    // Record the attempt in call_attempts for tracking + cadence awareness
    const retryable = ['no_answer', 'voicemail', 'callback'].includes(outcome);
    const nextAttemptAt = retryable
      ? new Date(Date.now() + (outcome === 'callback' ? 4 : 24) * 3600_000)
      : null;

    const [prevAttempt] = await sql`
      SELECT MAX(attempt_number) as max_num FROM call_attempts
      WHERE lead_id = ${leadId} AND organization_id = ${organization.id}
    `;
    const attemptNumber = ((prevAttempt?.max_num) ?? 0) + 1;

    await sql`
      INSERT INTO call_attempts (organization_id, lead_id, outcome, notes, attempt_number, next_attempt_at)
      VALUES (${organization.id}, ${leadId}, ${outcome}, ${notes}, ${attemptNumber}, ${nextAttemptAt})
    `;

    const stage = OUTCOME_STAGE[outcome];
    if (stage) {
      await recordStageTransition({
        leadId: lead.id,
        fromStage: null,
        toStage: stage as any,
        channel: 'voice',
      });
    }

    await logEvent('manual_call_outcome', 'lead', String(lead.id), {
      outcome,
      stage,
      attemptNumber,
      hasNotes: Boolean(notes),
    });

    // Phase 3: `interested` outcome — trigger the AI negotiation chain.
    // This is the same path an inbound SMS reply takes: upsert a conversation
    // and enqueue an ai_reply job. The AI negotiator then handles the lead
    // identically regardless of which channel surfaced the interest.
    let negotiationJobId: string | null = null;
    if (outcome === 'interested') {
      const callNote = notes ? `[Call note: ${notes}]` : '[Marked interested via manual call]';
      const [conv] = await sql`
        INSERT INTO ai_conversations (lead_id, channel, history)
        VALUES (${lead.id}, 'voice', '[]'::jsonb)
        ON CONFLICT (lead_id) DO UPDATE SET last_message_at = NOW()
        RETURNING *
      `;
      await sql`
        UPDATE ai_conversations
        SET history = history || ${JSON.stringify([{ role: 'user', content: callNote }])}::jsonb,
            status = 'needs_review',
            requires_human = true,
            last_message_at = NOW()
        WHERE id = ${conv.id}
      `;
      negotiationJobId = await enqueueJob('ai_reply', {
        leadId: lead.id,
        conversationId: conv.id,
        channel: 'voice',
      }, { dedupeKey: `call_interested:${lead.id}:${attemptNumber}` });
    }

    return Response.json({
      status: 'logged',
      leadId: lead.id,
      outcome,
      stage,
      attemptNumber,
      nextAttemptAt,
      suppressed: outcome === 'do_not_call',
      negotiationJobId,
    });
  } catch (error: any) {
    console.error('POST /api/outreach/call-queue/outcome error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
