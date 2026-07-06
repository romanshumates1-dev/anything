import sql from '@/app/api/utils/sql';
import { SMSGateway } from '@/app/api/gateway/sms-gateway';
import { TwilioAdapter } from '@/app/api/gateway/providers';
import { sendMessage } from './messaging';
import { detectHighRisk, orchestrateAIResponse } from './ai-orchestrator';

export async function enqueueJob(
  type: string,
  payload: Record<string, any>,
  options: { runAt?: Date; maxAttempts?: number; dedupeKey?: string | null } = {}
) {
  const { runAt = new Date(), maxAttempts = 3, dedupeKey = null } = options;

  // Idempotent enqueue: when a dedupeKey is supplied, a duplicate (same key)
  // is silently skipped via the partial unique index uniq_jobs_dedupe_key.
  if (dedupeKey) {
    const rows = await sql`
    INSERT INTO jobs (type, payload, run_at, max_attempts, dedupe_key)
      VALUES (${type}, ${JSON.stringify(payload)}, ${runAt}, ${maxAttempts}, ${dedupeKey})
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  }

  const [job] = await sql`
    INSERT INTO jobs (type, payload, run_at, max_attempts)
    VALUES (${type}, ${JSON.stringify(payload)}, ${runAt}, ${maxAttempts})
    RETURNING id
  `;

  return job.id;
}

let smsGateway: SMSGateway | null = null;

export async function getGateway(): Promise<SMSGateway> {
  if (!smsGateway) {
      smsGateway = new SMSGateway({
        primaryProvider: new TwilioAdapter(
          process.env.TWILIO_ACCOUNT_SID || '',
          process.env.TWILIO_AUTH_TOKEN || '',
          process.env.TWILIO_FROM_NUMBER || undefined,
          process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
        ),
        complianceCheckEnabled: true,
        idempotencyEnabled: true,
        testModeAllowedPhones: new Set(['+15551234567', '+15559876543']),
      });
  }
  return smsGateway;
}

export async function processNextJob() {
  const now = new Date();

  // Select and lock a pending job
  const [job] = await sql`
    UPDATE jobs
    SET status = 'processing', 
        locked_until = ${new Date(Date.now() + 5 * 60 * 1000)}, -- lock for 5 mins
        attempts = attempts + 1,
        updated_at = ${now}
    WHERE id = (
      SELECT id 
      FROM jobs 
      WHERE status IN ('pending', 'failed')
      AND attempts < max_attempts
      AND run_at <= ${now}
      AND (locked_until IS NULL OR locked_until <= ${now})
      ORDER BY run_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  if (!job) return null;

  try {
    // Dispatch based on job type. Every handler must produce an observable
    // side effect; a job can only be marked completed after its handler runs.
    switch (job.type) {
      case 'send_message': {
        const payload: any = job.payload;
        if (payload.channel === 'sms') {
          const gateway = await getGateway();
          const result = await gateway.send({
            leadId: payload.leadId,
            to: payload.to,
            text: payload.text,
            campaignLeadId: payload.campaignLeadId,
            conversationThread: `campaign_${String(payload.campaignLeadId)}`,
            campaignId: payload.campaignId,
            organizationId: payload.organizationId,
            contactId: payload.contactId,
          });
          // Log gateway result for auditability
          await sql`
            INSERT INTO message_events (id, organization_id, campaign_id, contact_id, direction, status, provider, metadata)
            VALUES (${result.messageUuid}, ${payload.organizationId}, ${payload.campaignId}, ${payload.contactId}, 'outbound', ${result.status}, ${result.provider}, ${JSON.stringify({ gatewayStatus: result.status, providerMessageId: result.providerId, errorMessage: result.errorMessage }) })
            ON CONFLICT (id) DO NOTHING
          `;
          if (result.status !== 'dispatched') {
            throw new Error(result.errorMessage || 'gateway_dispatch_failed');
          }
        } else {
          await sendMessage(payload);
        }
        break;
      }
      case 'ai_reply': {
        // pause-AI: draft an AI reply for an inbound message. This NEVER
        // auto-sends — the draft is persisted with a review flag so a human
        // approves before anything goes out. Enqueued by the inbound SMS
        // handler only when the lead is not paused.
        const payload: any = job.payload;
        const [conv] = await sql`
          SELECT * FROM ai_conversations WHERE lead_id = ${payload.leadId} LIMIT 1
        `;
        if (conv) {
          const history = conv.history || [];
          const lastUser = [...history].reverse().find((m: any) => m.role === 'user');
          const decision = await orchestrateAIResponse(payload.leadId, history);
          const riskFlag =
            detectHighRisk(lastUser?.content || '') || detectHighRisk(decision.response_text);
          const requiresHuman = decision.requires_human || riskFlag;
          await sql`
            UPDATE ai_conversations
            SET history = history || ${JSON.stringify([{ role: 'assistant', content: decision.response_text }])}::jsonb,
                confidence_score = ${decision.confidence_score},
                requires_human = ${requiresHuman},
                status = ${requiresHuman ? 'needs_review' : 'active'},
                last_message_at = NOW()
            WHERE id = ${conv.id}
          `;
        }
        break;
      }
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await sql`
      UPDATE jobs 
      SET status = 'completed', updated_at = ${new Date()} 
      WHERE id = ${job.id}
    `;
    return { success: true, jobId: job.id, type: job.type };
  } catch (error: any) {
    // Move to dead-letter once we've exhausted all attempts, otherwise allow retry.
    const isDead = job.attempts >= job.max_attempts;
    await sql`
      UPDATE jobs 
      SET status = ${isDead ? 'dead' : 'failed'}, 
          error_message = ${error.message},
          updated_at = ${new Date()},
          locked_until = NULL
      WHERE id = ${job.id}
    `;
    throw error;
  }
}

/**
 * Drain up to `limit` pending jobs. Stops early when the queue is empty.
 * Returns the number of jobs that were processed.
 */
export async function drainJobs(limit = 25) {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    let result;
    try {
      result = await processNextJob();
    } catch {
      // processNextJob already recorded the failure/dead-letter transition in
      // the DB before re-throwing. Count it as handled and keep draining so one
      // bad job can't block the rest of the queue.
      processed++;
      continue;
    }
    if (!result) break;
    processed++;
  }
  return processed;
}
