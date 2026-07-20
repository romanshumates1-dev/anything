import sql from '@/app/api/utils/sql';
import { SMSGateway } from '@/app/api/gateway/sms-gateway';
import { TwilioAdapter } from '@/app/api/gateway/providers';
import { MockSmsProvider, simulateDeliveryProgression } from '@/app/api/gateway/mock-provider';
import { DbIdempotencyStore } from '@/app/api/gateway/sms-idempotency-store';
import { meterSmsSend } from './entitlement';
import { isMockSmsMode } from './sms-mode';
import { twilioStatusCallbackUrl } from './twilio-webhook';
import { sendMessage } from './messaging';
import { detectHighRisk, orchestrateAIResponse } from './ai-orchestrator';
import { getTwilioConfig } from './twilio-adapter';
import { recordAIDispatched, dispatchAckIfNeeded } from './sla';
import { processCadenceStep, processVoiceStep, scheduleNextStep, scheduleVoiceStep } from './cadenceEngine';
import type { DenyCode } from './dispatchGate';

/**
 * P2.0-W: what to do with a job whose send was denied by dispatchGate.
 * - Time-based denials (quiet hours / send window) are DEFERRED: the job goes
 *   back to pending at the gate's retryAt with its attempt refunded — being
 *   held for compliance is not a failure and must not burn retries or
 *   dead-letter the send.
 * - Absolute denials (DNC / flag off / no consent) COMPLETE the job as
 *   suppressed: retrying cannot change the outcome, and a dead-letter would
 *   read as an error when the system did exactly the right thing.
 */
const DEFERRABLE: ReadonlySet<DenyCode> = new Set(['QUIET_HOURS', 'OUTSIDE_WINDOW'] as DenyCode[]);

async function handleGateDenial(
  jobId: number | string,
  code: DenyCode,
  retryAt: Date | undefined,
  jobType = 'send_message'
): Promise<{ success: true; jobId: number | string; type: string; gate: DenyCode }> {
  if (DEFERRABLE.has(code)) {
    const runAt = retryAt ?? new Date(Date.now() + 60 * 60 * 1000);
    await sql`
      UPDATE jobs
      SET status = 'pending', run_at = ${runAt}, locked_until = NULL,
          attempts = GREATEST(attempts - 1, 0),
          error_message = ${'deferred:' + code},
          updated_at = ${new Date()}
      WHERE id = ${jobId}
    `;
  } else {
    await sql`
      UPDATE jobs
      SET status = 'completed', error_message = ${'suppressed:' + code},
          updated_at = ${new Date()}
      WHERE id = ${jobId}
    `;
  }
  return { success: true, jobId, type: jobType, gate: code };
}

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
      // SMS_MODE=mock injects the MockSmsProvider into the SAME gateway, so the
      // real gateway path (circuit breakers, idempotency, dispatchGate,
      // message_events) is exercised at zero cost. Otherwise the real Twilio
      // adapter (twilio_test vs live differ only by credentials).
      const primaryProvider = isMockSmsMode()
        ? new MockSmsProvider()
        : new TwilioAdapter(
            process.env.TWILIO_ACCOUNT_SID || '',
            process.env.TWILIO_AUTH_TOKEN || '',
            process.env.TWILIO_FROM_NUMBER || undefined,
            process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
          );
      smsGateway = new SMSGateway({
        primaryProvider,
        complianceCheckEnabled: true,
        idempotencyEnabled: true,
        // G-3: durable idempotency so dedup survives restarts / multiple workers.
        idempotencyStore: new DbIdempotencyStore(),
        // test-mode enforcement is DB-driven (test_phone_numbers table in sms-gateway.ts)
        // — no hardcoded allowlist here.
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
        // Route SMS through the Twilio gateway only when Twilio is actually
        // configured. With no provider, fall back to the provider-agnostic
        // sendMessage seam (which simulates delivery when SMS_PROVIDER_URL is
        // unset) — otherwise a deploy without Twilio env silently dead-letters
        // every send instead of using the documented mock path.
        if (payload.channel === 'sms' && (getTwilioConfig() || process.env.SMS_MODE === 'mock')) {
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
          // Mock mode: fire the simulated delivery progression (queued→sent→
          // delivered) at the REAL /api/sms/status route so message_events
          // advances exactly as it would with Twilio. Best-effort and only when
          // a base URL is configured (skipped in unit tests / no-server envs).
          if (result.status === 'dispatched' && result.providerId && isMockSmsMode() && twilioStatusCallbackUrl()) {
            void simulateDeliveryProgression({ sid: result.providerId, to: payload.to }).catch((e) =>
              console.warn('[jobs] mock delivery simulation failed', e?.message)
            );
          }
          if (result.gateCode) {
            // Gate denial is not a provider failure — defer or suppress.
            return await handleGateDenial(job.id, result.gateCode, result.retryAt);
          }
          if (result.status !== 'dispatched') {
            throw new Error(result.errorMessage || 'gateway_dispatch_failed');
          }
          // G-5: meter the ACTUAL segments sent against the billing user's plan.
          // Best-effort — a metering error must never fail an already-sent SMS.
          if (payload.billingUserId) {
            await meterSmsSend(payload.billingUserId, String(payload.text ?? ''), {
              messageSid: result.providerId,
            }).catch((e) => console.warn('[jobs] meterSmsSend failed', e?.message));
          }
        } else {
          const fallback = await sendMessage(payload);
          if (fallback.status === 'suppressed' && (fallback as any).gateCode) {
            return await handleGateDenial(job.id, (fallback as any).gateCode, (fallback as any).retryAt);
          }
          if (fallback.status === 'sent' && payload.billingUserId) {
            await meterSmsSend(payload.billingUserId, String(payload.text ?? '')).catch((e) =>
              console.warn('[jobs] meterSmsSend failed', e?.message)
            );
          }
        }
        // INT-4: a successful outbound send is what starts (or advances) the
        // cadence ladder. scheduleNextStep is flag-gated and dedupe-keyed, so
        // calling it after EVERY send is idempotent — without this call the
        // ladder never begins (found: zero runtime callers at b7dd43e).
        if (payload.contactId && payload.campaignId) {
          await scheduleNextStep(payload.contactId, payload.campaignId, payload.organizationId);
          // Ladder T+60s: voice escalation after the OPENING send only.
          // scheduleVoiceStep is voiceEscalation-flag-gated (default OFF).
          if (payload.isOpening) {
            await scheduleVoiceStep({
              contactId: payload.contactId,
              campaignId: payload.campaignId,
              organizationId: payload.organizationId,
              phone: payload.to,
              leadId: payload.leadId ?? null,
              consentBasis: payload.consentBasis ?? null,
            });
          }
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
          // INT-1: SLA latency tracking — record AI dispatch start
          await recordAIDispatched(payload.conversationId, process.env.AI_PROVIDER as any || 'anthropic');

          // INT-1: provider-aware ack-SMS fallback (prospect never sits in silence)
          const [lead] = await sql`SELECT phone FROM leads WHERE id = ${payload.leadId} LIMIT 1`;
          if (lead?.phone) {
            await dispatchAckIfNeeded({
              conversationId: payload.conversationId,
              leadId: payload.leadId,
              to: lead.phone,
            });
          }

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
      case 'cadence_step': {
        const payload: any = job.payload;
        const step = await processCadenceStep(payload);
        // Same-row deferral: a time-gated step moves THIS job's run_at. It must
        // never re-enqueue its own dedupe key (silently no-ops -> step lost).
        if (step.gateCode) {
          return await handleGateDenial(job.id, step.gateCode as DenyCode, step.deferAt, 'cadence_step');
        }
        break;
      }
      case 'voice_call': {
        const payload: any = job.payload;
        const call = await processVoiceStep(payload);
        if (call.gateCode) {
          return await handleGateDenial(job.id, call.gateCode as DenyCode, call.deferAt, 'voice_call');
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
