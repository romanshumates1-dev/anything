import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { detectHighRisk, orchestrateAIResponse } from '../../utils/ai-orchestrator';
import { checkConsent } from '../../utils/compliance';
import { enqueueJob } from '../../utils/jobs';
import { logEvent } from '../../utils/logger';
import { getOrganization } from '@/lib/organization-context';
import { authorizeAiRequest } from '@/app/api/utils/aiCreditGate';
import { providerFailureResponse } from '@/app/api/utils/providerFailureResponse';

const MAX_MESSAGE_LENGTH = 4000;
/**
 * Declared body size ceiling. The message itself is capped at 4KB, so a body
 * far larger than that is either an oversized payload or an attempted memory
 * exhaustion — rejected on the DECLARED length before a byte is parsed.
 * Chunked uploads without content-length fall through to the parsed checks.
 */
const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  // SECURITY: this endpoint triggers paid AI calls and outbound messaging.
  // It must never be reachable anonymously.
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const org = await getOrganization();
  if (!org) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  // Declared-size guard FIRST: a 4KB message cannot legitimately arrive in a
  // 64KB+ body, and parsing before rejecting hands the requester the memory
  // allocation they asked for.
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Request body too large' }, { status: 413 });
  }

  // A malformed body is a 400, not a 500 (and never reaches the credit gate).
  let body: {
    leadId?: unknown;
    message?: unknown;
    channel?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message } = body;
  const leadIdInput = body.leadId;
  const channelInput = body.channel ?? 'sms';

  // ---- Input validation ----
  if (!leadIdInput || typeof message !== 'string' || message.trim().length === 0) {
    return Response.json(
      { error: 'Lead ID and a non-empty message are required' },
      { status: 400 }
    );
  }
  if (channelInput !== 'sms' && channelInput !== 'email') {
    return Response.json({ error: 'Invalid channel' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return Response.json(
      { error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` },
      { status: 413 }
    );
  }

  // Narrowed by the checks above: a numeric id and a literal channel union.
  // Both still reach the DB as bound parameters (never interpolated).
  const leadId = Number(leadIdInput);
  if (!Number.isInteger(leadId) || leadId <= 0) {
    return Response.json({ error: 'Invalid lead id' }, { status: 400 });
  }
  const channel: 'sms' | 'email' = channelInput;

  // Set once the gate has charged; cleared the moment the charge becomes
  // legitimate (a draft the caller actually receives) or is compensated. The
  // outer handler uses it so a failure AFTER the provider call — a persist or
  // queue error — hands the credit back instead of billing for a draft the
  // customer never got.
  let releaseAiCredit: (() => Promise<void>) | null = null;

  try {
    // 1. Load lead (SECURITY: scoped to organization to prevent IDOR)
    const [lead] = await sql`SELECT * FROM leads WHERE id = ${leadId} AND organization_id = ${org.id} LIMIT 1`;
    if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });

    // 2. Compliance — a missing contact must NOT be treated as consent.
    const contact = channel === 'sms' ? lead.phone : lead.email;
    if (!contact) {
      return Response.json({ error: `Lead has no ${channel} contact on file` }, { status: 422 });
    }
    const hasConsent = await checkConsent(contact, channel);
    if (!hasConsent) {
      return Response.json({ error: 'Lead has opted out of communications' }, { status: 403 });
    }

    // 3. Get-or-create the conversation atomically (unique index on lead_id
    //    prevents the duplicate rows the previous SELECT-then-INSERT could create).
    const [conv] = await sql`
      INSERT INTO ai_conversations (lead_id, channel, history)
      VALUES (${leadId}, ${channel}, '[]'::jsonb)
      ON CONFLICT (lead_id) DO UPDATE SET last_message_at = NOW()
      RETURNING *
    `;

    // 4. Append the inbound message atomically to avoid lost updates under
    //    concurrent messages for the same lead.
    const [appended] = await sql`
      UPDATE ai_conversations
      SET history = history || ${JSON.stringify([{ role: 'user', content: message }])}::jsonb,
          last_message_at = NOW()
      WHERE id = ${conv.id}
        AND lead_id IN (
          SELECT id FROM leads WHERE organization_id = ${org.id}
        )
      RETURNING history
    `;
    const history = appended.history || [];

    // 5. Server-side AI credit gate.
    //
    // PLACEMENT IS LOAD-BEARING:
    //  - AFTER validation + consent (steps 1-2), so a malformed request or an
    //    opted-out contact is never charged; and
    //  - BEFORE `orchestrateAIResponse`, so no provider call happens on denial.
    //
    // This route was previously ungated while every other AI entry point
    // (templates/generate, outreach/call-queue/brief, analytics/ai-recommendations)
    // was gated, so an authenticated user could drive unlimited paid provider
    // calls through it. The gate restores that invariant.
    //
    // `requestId` makes a retried submission idempotent, so a double-tap or a
    // network retry cannot be charged twice for the same message.
    const authorization = await authorizeAiRequest(org.id, {
      requestId: `conversations:message:${leadId}:${message.length}:${history.length}`,
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
    releaseAiCredit = authorization.release;

    // 6. Orchestrate the AI response (consumes the credit taken above).
    let decision;
    try {
      decision = await orchestrateAIResponse(leadId, history);
    } catch (aiError) {
      // The credit is paid back when the provider work fails, so an outage
      // cannot silently consume the customer's included or purchased credits.
      let creditReleased = false;
      try {
        await authorization.release();
        creditReleased = true;
        // Compensated here; the outer handler must not release a second time.
        releaseAiCredit = null;
      } catch (releaseError) {
        console.error('[conversations/message] credit release failed', releaseError);
      }
      // NOT a rethrow: `orchestrateAIResponse` rethrows everything it catches,
      // so the old `throw` dropped the caller into the outer handler and the
      // user saw an opaque "Internal Server Error" 500 for what was really a
      // billing/credential outage upstream. Provider failure => 502 + hint.
      return providerFailureResponse(aiError, {
        context: 'conversations/message',
        creditReleased,
      });
    }

    // 7. Server-side human-in-the-loop enforcement. The model's own flag is a
    //    hint; risky topics (offers, contracts, assignments, pricing) ALWAYS
    //    require a human before anything is sent.
    const riskFlag = detectHighRisk(message) || detectHighRisk(decision.response_text);
    const requiresHuman = decision.requires_human || riskFlag;

    // 8. Persist the AI draft + review state atomically.
    await sql`
      UPDATE ai_conversations
      SET history = history || ${JSON.stringify([{ role: 'assistant', content: decision.response_text }])}::jsonb,
          confidence_score = ${decision.confidence_score},
          requires_human = ${requiresHuman},
          status = ${requiresHuman ? 'needs_review' : 'active'},
          last_message_at = NOW()
      WHERE id = ${conv.id}
        AND lead_id IN (
          SELECT id FROM leads WHERE organization_id = ${org.id}
        )
    `;

    // 9. Only auto-send when no human approval is required. Otherwise the draft
    //    waits for review — we never auto-send offers/contracts.
    let queued = false;
    if (!requiresHuman) {
      await enqueueJob('send_message', {
        leadId,
        channel,
        to: contact,
        text: decision.response_text,
      });
      queued = true;
    }

    await logEvent(
      'ai_message_processed',
      'conversation',
      conv.id.toString(),
      {
        requiresHuman,
        riskFlag,
        confidence: decision.confidence_score,
        queued,
      },
      session.user.id
    );

    // The caller is getting the draft, so the charge stands: clear the
    // compensation pointer before the response leaves the handler.
    releaseAiCredit = null;

    return Response.json({
      response: decision.response_text,
      requiresHuman,
      confidence: decision.confidence_score,
      queued,
    });
  } catch (error: any) {
    // The provider ran, so the inner handler did not fire — but the request
    // still produced nothing the customer can use. Hand the credit back.
    if (releaseAiCredit) {
      try {
        await releaseAiCredit();
      } catch (releaseError) {
        console.error('[conversations/message] credit release failed', releaseError);
      }
    }
    console.error('POST /api/conversations/message error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
