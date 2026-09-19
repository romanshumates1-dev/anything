import sql from '@/app/api/utils/sql';
import { SMSGateway } from '@/app/api/gateway/sms-gateway';
import { TwilioAdapter } from '@/app/api/gateway/providers';
import { sendMessage } from './messaging';
import { detectHighRisk, orchestrateAIResponse } from './ai-orchestrator';
import { getTwilioConfig } from './twilio-adapter';
import { recordAIDispatched, dispatchAckIfNeeded } from './sla';
import { processCadenceStep, processVoiceStep, scheduleNextStep, scheduleVoiceStep } from './cadenceEngine';
import { processInspectionUrgency } from './inspectionClock';
import type { DenyCode } from './dispatchGate';
import { deductCreditsForAction, refundCredits } from './credits';
import { getSubscriptionStatus } from './subscriptionGuard';

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
      smsGateway = new SMSGateway({
        primaryProvider: new TwilioAdapter(
          process.env.TWILIO_ACCOUNT_SID || '',
          process.env.TWILIO_AUTH_TOKEN || '',
          process.env.TWILIO_FROM_NUMBER || undefined,
          process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
        ),
        complianceCheckEnabled: true,
        idempotencyEnabled: true,
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
        // Phase 12: throughput guard — check MPS cap, daily cap, opt-out/delivery auto-pause
        if (payload.organizationId && payload.channel === 'sms') {
          const { checkThroughput } = await import('./smsGuards');
          const throughput = await checkThroughput(payload.organizationId);
          if (!throughput.canSend) {
            // Defer 60s for rate limits, 5min for auto-pause conditions
            const deferMs = throughput.mps.blocked ? 60_000 : 5 * 60_000;
            await sql`
              UPDATE jobs SET status = 'pending', run_at = ${new Date(Date.now() + deferMs)},
                locked_until = NULL, attempts = GREATEST(attempts - 1, 0),
                error_message = ${'deferred:throughput:' + (throughput.reason ?? 'cap')},
                updated_at = ${new Date()}
              WHERE id = ${job.id}
            `;
            return { success: true, jobId: job.id, type: job.type, gate: 'FLAG_OFF' as DenyCode };
          }
        }
        // Phase 12: duplicate-send detector
        if (payload.to && payload.text) {
          const { isDuplicateSend } = await import('./smsGuards');
          if (await isDuplicateSend({ phone: payload.to, text: payload.text, campaignId: payload.campaignId })) {
            await sql`UPDATE jobs SET status = 'completed', error_message = 'suppressed:duplicate_send', updated_at = ${new Date()} WHERE id = ${job.id}`;
            return { success: true, jobId: job.id, type: job.type, gate: 'DNC' as DenyCode };
          }
        }

        // Credit deduction for SMS/Email sends
        // Deduct BEFORE sending to ensure we have credits available
        let creditDeducted = 0;
        if (payload.organizationId) {
          const subscription = await getSubscriptionStatus(payload.organizationId);
          const tier = subscription?.tier || 'free';
          const action = payload.channel === 'sms' ? 'SMS_SEND' : 'EMAIL_SEND';

          const deduction = await deductCreditsForAction(
            payload.organizationId,
            action as any,
            tier,
            `${action}: ${payload.to}`,
            { jobId: job.id, leadId: payload.leadId, campaignId: payload.campaignId }
          );

          if (!deduction.success) {
            // Insufficient credits - complete job as credit_exhausted
            await sql`
              UPDATE jobs
              SET status = 'completed',
                  error_message = 'suppressed:insufficient_credits',
                  updated_at = ${new Date()}
              WHERE id = ${job.id}
            `;
            return {
              success: false,
              jobId: job.id,
              type: job.type,
              error: 'insufficient_credits',
              balance: deduction.remainingBalance,
            };
          }
          creditDeducted = deduction.deducted;

          // Store deducted amount and transaction ID in payload for exact refund on dead-letter
          await sql`
            UPDATE jobs
            SET payload = payload || ${JSON.stringify({ _creditDeducted: deduction.deducted, _creditTransactionId: deduction.transactionId })}::jsonb
            WHERE id = ${job.id}
          `;
        }

        // Route SMS through the Twilio gateway only when Twilio is actually
        // configured. With no provider, fall back to the provider-agnostic
        // sendMessage seam (which simulates delivery when SMS_PROVIDER_URL is
        // unset) — otherwise a deploy without Twilio env silently dead-letters
        // every send instead of using the documented mock path.
        if (payload.channel === 'sms' && getTwilioConfig()) {
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
            // Phase A: numeric-guard context rides with bounded-mode sends.
            boundedNegotiation: payload.boundedNegotiation,
          });
          // Log gateway result for auditability. provider_message_id (the
          // Twilio MessageSid) is now a real column, not just buried in
          // metadata — the status-callback receiver (BREAKAGE_TABLE #33)
          // correlates inbound delivery updates back to this row by it.
          await sql`
            INSERT INTO message_events (id, organization_id, campaign_id, contact_id, direction, status, provider, provider_message_id, metadata)
            VALUES (${result.messageUuid}, ${payload.organizationId}, ${payload.campaignId}, ${payload.contactId}, 'outbound', ${result.status}, ${result.provider}, ${result.providerId ?? null}, ${JSON.stringify({ gatewayStatus: result.status, errorMessage: result.errorMessage }) })
            ON CONFLICT (id) DO NOTHING
          `;
          if (result.gateCode) {
            // Gate denial is not a provider failure — defer or suppress.
            return await handleGateDenial(job.id, result.gateCode, result.retryAt);
          }
          if (result.status !== 'dispatched') {
            throw new Error(result.errorMessage || 'gateway_dispatch_failed');
          }
        } else {
          const fallback = await sendMessage(payload);
          if (fallback.status === 'suppressed' && (fallback as any).gateCode) {
            return await handleGateDenial(job.id, (fallback as any).gateCode, (fallback as any).retryAt);
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
        // Record stage transition: NEW → CONTACTED (funnel analytics fix)
        if (payload.leadId && payload.isOpening) {
          const { recordStageTransition } = await import('@/app/api/services/stageTransitionRecorder');
          await recordStageTransition({
            leadId: payload.leadId,
            fromStage: 'NEW',
            toStage: 'CONTACTED',
            channel: payload.channel || 'sms',
            campaignId: payload.campaignId,
          }).catch(() => {}); // Best-effort, never block send
        }
        break;
      }
      case 'send_email': {
        const ep: any = job.payload;
        const { canSendEmail, recordEmailSend } = await import('./emailWarmup');
        const allowance = await canSendEmail(ep.organizationId);
        if (!allowance.allowed) {
          // Properly defer: reset to pending with future run_at, unlock, refund attempt
          await sql`
            UPDATE jobs
            SET status = 'pending',
                run_at = ${new Date(Date.now() + 12 * 3600_000)},
                locked_until = NULL,
                attempts = GREATEST(attempts - 1, 0),
                error_message = ${'deferred:warmup:' + (allowance.reason || 'limit')},
                updated_at = NOW()
            WHERE id = ${job.id}
          `;
          return { success: true, jobId: job.id, type: 'send_email', deferred: true, reason: allowance.reason };
        }

        // Credit deduction for email sends
        if (ep.organizationId) {
          const subscription = await getSubscriptionStatus(ep.organizationId);
          const tier = subscription?.tier || 'free';
          const emailDeduction = await deductCreditsForAction(
            ep.organizationId,
            'EMAIL_SEND',
            tier,
            `Email to: ${ep.to}`,
            { jobId: job.id, leadId: ep.leadId, campaignId: ep.campaignId }
          );
          if (!emailDeduction.success) {
            await sql`
              UPDATE jobs SET status = 'completed', error_message = 'suppressed:insufficient_credits',
                updated_at = ${new Date()} WHERE id = ${job.id}
            `;
            return { success: false, jobId: job.id, type: 'send_email', error: 'insufficient_credits' };
          }

          // Store deducted amount and transaction ID in payload for exact refund on dead-letter
          await sql`
            UPDATE jobs
            SET payload = payload || ${JSON.stringify({ _creditDeducted: emailDeduction.deducted, _creditTransactionId: emailDeduction.transactionId })}::jsonb
            WHERE id = ${job.id}
          `;
        }

        const { sendEmail, withCanSpamFooter } = await import('./emailDriver');
        const emailBody = withCanSpamFooter(ep.body || ep.text || '', {
          unsubscribeUrl: ep.unsubscribeUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/unsubscribe?t=${encodeURIComponent(ep.to)}`,
          postalAddress: ep.postalAddress || process.env.POSTAL_ADDRESS || '',
        });
        const result = await sendEmail({
          to: ep.to,
          subject: ep.subject || 'Regarding your property',
          body: emailBody,
          unsubscribeUrl: ep.unsubscribeUrl || `${process.env.NEXT_PUBLIC_APP_URL || ''}/api/unsubscribe?t=${encodeURIComponent(ep.to)}`,
          postalAddress: ep.postalAddress || process.env.POSTAL_ADDRESS || '',
          organizationId: ep.organizationId,
          campaignId: ep.campaignId,
          contactId: ep.contactId,
          leadId: ep.leadId,
          coldOutbound: true,
        });
        if (result.status === 'dispatched') {
          await recordEmailSend(ep.organizationId);
        }
        if (result.status === 'suppressed') {
          return await handleGateDenial(job.id, result.gateCode, undefined, 'send_email');
        }
        if (result.status === 'blocked' || result.status === 'failed') {
          throw new Error(result.status === 'blocked' ? result.reason : result.errorMessage);
        }
        if (ep.contactId && ep.campaignId) {
          await scheduleNextStep(ep.contactId, ep.campaignId, ep.organizationId);
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
          // Credit deduction for AI request
          if (payload.organizationId) {
            const subscription = await getSubscriptionStatus(payload.organizationId);
            const tier = subscription?.tier || 'free';
            const aiDeduction = await deductCreditsForAction(
              payload.organizationId,
              'AI_REQUEST',
              tier,
              `AI reply draft for lead ${payload.leadId}`,
              { jobId: job.id, leadId: payload.leadId, conversationId: payload.conversationId }
            );
            if (!aiDeduction.success) {
              // Insufficient credits - complete job as credit_exhausted
              await sql`
                UPDATE jobs SET status = 'completed', error_message = 'suppressed:insufficient_credits_ai',
                  updated_at = ${new Date()} WHERE id = ${job.id}
              `;
              return { success: false, jobId: job.id, type: job.type, error: 'insufficient_credits' };
            }
          }

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
      case 'inspection_urgency': {
        // Phase V-R: day-3 / day-N−2 unassigned-contract notifications.
        // Exactly-once via dedupe keys at enqueue; fresh state check at fire time.
        await processInspectionUrgency(job.payload as any);
        break;
      }
      case 'send_owner_notification': {
        const ownerNumber = process.env.OWNER_NUMBER;
        if (!ownerNumber) {
          console.error('[jobs] OWNER_NUMBER not set, cannot send notification.');
          // Mark as completed to not retry this.
          await sql`UPDATE jobs SET status = 'completed', error_message = 'OWNER_NUMBER not set' WHERE id = ${job.id}`;
          return { success: true, jobId: job.id, type: job.type, gate: 'FLAG_OFF' };
        }
        const payload: any = job.payload;
        const gateway = await getGateway();
        await gateway.send({
          to: ownerNumber,
          text: payload.message,
          leadId: 'owner-notification', // Placeholder for logs
          transactional: true,
          organizationId: payload.organizationId,
        });
        break;
      }
      case 'vip_window_expired': {
        // [REVENUE OPTIMIZATION] Notify non-VIP buyers after VIP exclusivity window expires
        // This job is scheduled when VIP buyers are notified and fires after 2 hours
        const payload: any = job.payload;
        const { notifyNonVipBuyers } = await import('./vipWindowHandler');
        await notifyNonVipBuyers(payload.dealId, payload.organizationId);
        break;
      }
      case 'stalled_conversation_recovery': {
        // [REVENUE OPTIMIZATION] Re-engage conversations that went cold mid-negotiation
        // Targets leads that replied but then stopped responding (48-168h threshold)
        const payload: any = job.payload;
        const { queueStalledReengagement } = await import('./stalledConversationEngine');
        await queueStalledReengagement(payload.organizationId);
        break;
      }
      case 'stalled_recovery_all': {
        // System-wide stalled conversation recovery (called by cron)
        const { runStalledRecoveryAll } = await import('./stalledConversationEngine');
        await runStalledRecoveryAll();
        break;
      }
      case 'send_pipeline_sms': {
        // [Item 0] AWS SNS SMS for pipeline outreach
        const payload: any = job.payload;
        const { sendPipelineSMS } = await import('./smsOutreachEngine');
        const result = await sendPipelineSMS(payload);
        if (!result.success) {
          if (result.status === 'opted_out' || result.status === 'invalid_number') {
            // Don't retry these - mark as complete with suppression note
            await sql`UPDATE jobs SET status = 'completed', error_message = ${'suppressed:' + result.status}, updated_at = ${new Date()} WHERE id = ${job.id}`;
            return { success: true, jobId: job.id, type: job.type, gate: 'DNC' as DenyCode };
          }
          throw new Error(result.errorMessage || 'SMS send failed');
        }
        break;
      }
      case 'notify_call_request': {
        // [Item 2] Notify owner of scheduled call request
        const payload: any = job.payload;
        const { notifyOwnerOfCallRequest } = await import('./callSchedulingEngine');
        // Get the call record
        const [call] = await sql`SELECT * FROM scheduled_calls WHERE id = ${payload.callId}`;
        if (call) {
          await notifyOwnerOfCallRequest({
            id: call.id,
            leadId: call.lead_id,
            organizationId: call.organization_id,
            context: call.context,
            reason: call.reason,
            status: call.status,
            ownerNotified: call.owner_notified,
            leadPhone: call.lead_phone,
            leadEmail: call.lead_email,
            leadName: call.lead_name,
            propertyAddress: call.property_address,
            createdAt: call.created_at,
          });
        }
        break;
      }
      case 'send_social_response': {
        // [Item 3] Send response via social media platform
        const payload: any = job.payload;
        const { sendSocialMessage } = await import('./socialMediaEngine');
        const result = await sendSocialMessage(
          payload.organizationId,
          payload.platform,
          payload.platformUserId,
          payload.message
        );
        if (!result.success) {
          throw new Error(result.error || 'Social media send failed');
        }
        break;
      }
      case 'recycle_prospects': {
        // [Item 6] Recycle past campaign prospects to new campaign
        const payload: any = job.payload;
        const { findRecyclableProspects, recycleProspectsToCampaign } = await import('./prospectRecyclingEngine');
        const prospects = await findRecyclableProspects(payload.organizationId, payload.config);
        if (prospects.length > 0) {
          await recycleProspectsToCampaign(
            payload.organizationId,
            payload.campaignId,
            prospects.map(p => p.leadId)
          );
        }
        break;
      }
      case 'match_buyers_auto': {
        // AUTO-TRIGGER: When seller signs purchase agreement, match and notify buyers
        // This closes the gap between seller signing → buyer notification (was manual, now automatic)
        const payload: any = job.payload;
        const { matchAndNotifyBuyers } = await import('./buyerMatchEngine');
        const result = await matchAndNotifyBuyers({
          dealId: payload.dealId,
          organizationId: payload.organizationId,
          propertyAddress: payload.propertyAddress,
          purchasePrice: payload.purchasePrice,
          notifyBuyers: payload.notifyBuyers ?? true,
        });
        console.log(`[match_buyers_auto] Deal ${payload.dealId}: ${result.matchedCount} buyers matched, ${result.notifiedCount} notified`);
        break;
      }
      case 'discover_buyers_auto': {
        // AUTO-DISCOVERY: Find new buyer leads from public records when not enough existing matches
        // Triggered by buyerMatchEngine when < 5 matches or no VIP buyers
        const payload: any = job.payload;
        const { discoverBuyersForDeal } = await import('./buyerDiscoveryEngine');
        const result = await discoverBuyersForDeal({
          dealId: payload.dealId,
          organizationId: payload.organizationId,
          propertyZip: payload.propertyZip,
          propertyCounty: payload.propertyCounty,
          propertyState: payload.propertyState,
          priceRange: payload.priceRange,
          propertyType: payload.propertyType,
          limit: payload.limit || 50,
        });
        console.log(`[discover_buyers_auto] Deal ${payload.dealId}: ${result.discovered} discovered, ${result.added} added, ${result.outreachQueued} outreach queued`);
        break;
      }
      case 'buyer_outreach_new': {
        // Outreach to newly discovered buyer leads
        const payload: any = job.payload;
        const { sendEmailAuto } = await import('./emailProviders');
        const { sendPipelineSMS } = await import('./smsOutreachEngine');

        // Send intro email to discovered buyer
        if (payload.buyerEmail) {
          await sendEmailAuto(payload.organizationId, {
            to: payload.buyerEmail,
            subject: `Investment Opportunity in ${payload.propertyZip}`,
            text: `Hi ${payload.buyerName},\n\nWe noticed you're an active investor in the ${payload.propertyZip} area. We have a deal that matches your buy criteria.\n\nReply if you'd like details.\n\nBest regards`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px;">
                <h2>Investment Opportunity</h2>
                <p>Hi ${payload.buyerName},</p>
                <p>We noticed you're an active investor in the <strong>${payload.propertyZip}</strong> area based on recent transaction activity.</p>
                <p>We have a deal that matches your buy criteria and wanted to reach out.</p>
                <p><strong>Reply to this email</strong> if you'd like to see the details.</p>
              </div>
            `,
          }).catch(console.error);
        }

        // Send SMS if phone available
        if (payload.buyerPhone) {
          await sendPipelineSMS({
            to: payload.buyerPhone,
            message: `Hi ${payload.buyerName.split(' ')[0]}, we have a deal in ${payload.propertyZip} that fits your buy box. Reply YES for details.`,
            leadId: payload.dealId,
            organizationId: payload.organizationId,
            channel: 'buyer',
          }).catch(console.error);
        }
        break;
      }
      case 'generate_seller_leads': {
        // Auto-generate seller leads from public records for campaign
        const payload: any = job.payload;
        const { generateSellerLeads } = await import('./leadGenerationEngine');
        const result = await generateSellerLeads({
          organizationId: payload.organizationId,
          count: payload.count,
          regions: payload.regions,
        });
        console.log(`[generate_seller_leads] Generated ${result.generated} seller leads`);
        break;
      }
      case 'generate_buyer_leads': {
        // Auto-generate buyer leads from public records for campaign
        const payload: any = job.payload;
        const { generateBuyerLeads } = await import('./leadGenerationEngine');
        const result = await generateBuyerLeads({
          organizationId: payload.organizationId,
          count: payload.count,
          regions: payload.regions,
        });
        console.log(`[generate_buyer_leads] Generated ${result.generated} buyer leads`);
        break;
      }
      case 'generate_buyer_leads_region': {
        // Auto-generate buyer leads for specific region to ensure coverage
        const payload: any = job.payload;
        const { generateBuyerLeadsForRegion } = await import('./leadGenerationEngine');
        const result = await generateBuyerLeadsForRegion({
          organizationId: payload.organizationId,
          region: payload.region,
          count: payload.count,
          priceRange: payload.priceRange,
        });
        console.log(`[generate_buyer_leads_region] Generated ${result.generated} buyer leads for ${payload.region}`);
        break;
      }
      case 'start_campaign': {
        // Start an outreach campaign (queue openings)
        const payload: any = job.payload;
        const { dispatchOpenings } = await import('./cadenceEngine');

        // Update campaign status to ACTIVE
        await sql`
          UPDATE outreach_campaigns
          SET status = 'ACTIVE', started_at = NOW()
          WHERE id = ${payload.campaignId}
        `.catch(console.error);

        // Queue opening messages
        await dispatchOpenings(payload.campaignId, payload.organizationId);
        console.log(`[start_campaign] Started campaign ${payload.campaignId}`);
        break;
      }
      case 'buyer_cadence_step': {
        // Buyer multi-touch sequence step (equivalent to seller cadence)
        const payload: any = job.payload;
        const { sendEmailAuto } = await import('./emailProviders');
        const { sendPipelineSMS } = await import('./smsOutreachEngine');

        // Get buyer details
        const [buyer] = await sql`
          SELECT * FROM buyers WHERE id = ${payload.buyerId}
        `.catch(() => [null]);

        if (!buyer) {
          console.log(`[buyer_cadence_step] Buyer ${payload.buyerId} not found, skipping`);
          break;
        }

        // Check if buyer opted out or already converted
        if (buyer.is_blacklisted || buyer.status === 'CLOSED' || buyer.status === 'LOST') {
          console.log(`[buyer_cadence_step] Buyer ${payload.buyerId} opted out or closed, skipping`);
          break;
        }

        const firstName = (buyer.name || '').split(' ')[0] || 'there';
        const dealContext = payload.dealContext || {};

        // Generate message based on template type
        let message = '';
        let subject = '';
        switch (payload.templateType) {
          case 'intro':
            subject = 'Investment Opportunities in Your Area';
            message = `Hi ${firstName}, we're looking for cash buyers in your area. We consistently source off-market deals at 20-30% below market. Interested in first access?`;
            break;
          case 'deal_alert':
            message = `${firstName}, new off-market deal just came in. Cash buyers get first look. Reply YES for details.`;
            break;
          case 'followup':
            subject = 'Still Looking for Deals?';
            message = `Hi ${firstName}, following up on investment opportunities. We have several deals that might fit your criteria. Want to see what's available?`;
            break;
          case 'urgency':
            message = `${firstName}, we have a deal that needs to close in 2 weeks. Looking for a cash buyer. Can you move fast?`;
            break;
          case 'last_chance':
            subject = 'Before I Close Your File';
            message = `${firstName}, before I mark you inactive - are you still buying? We'd love to keep you on our VIP buyer list.`;
            break;
        }

        // Send via appropriate channel
        if (payload.channel === 'sms' && buyer.phone) {
          await sendPipelineSMS({
            to: buyer.phone,
            message,
            leadId: payload.buyerId,
            organizationId: payload.organizationId,
            channel: 'buyer',
          });
        } else if (payload.channel === 'email' && buyer.email) {
          await sendEmailAuto(payload.organizationId, {
            to: buyer.email,
            subject,
            text: message,
            html: `<p>${message}</p>`,
          });
        }

        // Update buyer touch count
        await sql`
          UPDATE buyers
          SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{touch_count}',
            (COALESCE((metadata->>'touch_count')::int, 0) + 1)::text::jsonb
          ),
          updated_at = NOW()
          WHERE id = ${payload.buyerId}
        `.catch(console.error);

        console.log(`[buyer_cadence_step] Sent ${payload.channel} to buyer ${payload.buyerId} (step ${payload.sequenceOrder})`);
        break;
      }
      case 'classify_buyer_response': {
        // AI classification of buyer responses
        const payload: any = job.payload;
        const { classifyBuyerResponse, transitionBuyerStage } = await import('./buyerPipelineEngine');

        const classification = await classifyBuyerResponse(payload.message, {
          name: payload.buyerName,
          previousInteractions: payload.previousInteractions || 0,
        });

        // Update buyer based on classification
        let newStage = 'CONTACTED';
        if (classification.interestLevel === 'HOT') {
          newStage = 'INTERESTED';
        } else if (classification.interestLevel === 'NOT_INTERESTED') {
          newStage = 'LOST';
        }

        await transitionBuyerStage(
          payload.buyerId,
          newStage as any,
          payload.organizationId,
          { classification }
        );

        console.log(`[classify_buyer_response] Buyer ${payload.buyerId}: ${classification.interestLevel} → ${newStage}`);
        break;
      }
      case 'release_earning': {
        // Release an earning from escrow (PENDING -> AVAILABLE) after inspection period
        const payload: any = job.payload;
        const { releaseEarning } = await import('./earningsEscrow');
        await releaseEarning(payload.earningId);
        break;
      }
      case 'process_matured_earnings': {
        // Batch process all matured earnings (cron fallback)
        const { processMaturedEarnings } = await import('./earningsEscrow');
        const count = await processMaturedEarnings();
        console.log(`[process_matured_earnings] Processed ${count} matured earnings`);
        break;
      }
      case 'campaign_process_leads': {
        // Campaign automation: process new leads for assignment (runs hourly)
        const payload: any = job.payload;
        const { runProcessLeadsJob } = await import('./campaignEngine');
        await runProcessLeadsJob(payload.campaignId);
        break;
      }
      case 'campaign_send_scheduled': {
        // Campaign automation: send scheduled outreach (runs every 5 min)
        const payload: any = job.payload;
        const { runScheduledOutreachJob } = await import('./campaignEngine');
        await runScheduledOutreachJob(payload.campaignId);
        break;
      }
      case 'campaign_handle_response': {
        // Campaign automation: handle inbound response (triggered on webhook)
        const payload: any = job.payload;
        const { handleInboundResponse } = await import('./campaignEngine');
        await handleInboundResponse(payload.messageId, payload.contactId, payload.responseText);
        break;
      }
      case 'campaign_daily_followups': {
        // Campaign automation: process follow-ups (runs daily)
        const payload: any = job.payload;
        const { runFollowUpJob } = await import('./campaignEngine');
        await runFollowUpJob(payload.campaignId);
        break;
      }
      case 'campaign_update_statuses': {
        // Campaign automation: sync lead statuses (runs periodically)
        const payload: any = job.payload;
        const { runUpdateStatusesJob } = await import('./campaignEngine');
        await runUpdateStatusesJob(payload.campaignId);
        break;
      }
      case 'campaign_automation_all': {
        // Campaign automation: master orchestrator for all campaigns (cron)
        const { runAllCampaignAutomation } = await import('./campaignEngine');
        const result = await runAllCampaignAutomation();
        console.log(`[campaign_automation_all] ${result.campaignsProcessed} campaigns, ${result.totalAssigned} assigned, ${result.totalScheduled} scheduled`);
        break;
      }
      case 'run_pipeline': {
        // Pipeline orchestration: run full pipeline for organization
        const payload: any = job.payload;
        const { runPipeline } = await import('./pipelineOrchestrator');
        const result = await runPipeline(payload.organizationId);
        console.log(`[run_pipeline] Org ${payload.organizationId}: ${result.humanActionsCreated} actions, ${result.errors.length} errors`);
        break;
      }
      case 'process_outreach_batch': {
        // Pipeline: batch process pending outreach messages
        // This is a coordination job - actual sends are individual send_message jobs
        const payload: any = job.payload;
        console.log(`[process_outreach_batch] Processing outreach for org ${payload.organizationId}`);
        break;
      }
      case 'generate_contract_auto': {
        // Pipeline: auto-generate contract from approved negotiation
        const payload: any = job.payload;
        const contractId = crypto.randomUUID();
        await sql`
          INSERT INTO contracts (id, organization_id, seller_lead_id, status, contract_price_cents, created_at)
          VALUES (${contractId}, ${payload.organizationId}, ${payload.leadId}, 'PENDING_APPROVAL', ${payload.priceCents}, NOW())
        `;
        await sql`
          UPDATE negotiation_sessions SET contract_id = ${contractId}, updated_at = NOW()
          WHERE id = ${payload.negotiationSessionId}
        `;
        console.log(`[generate_contract_auto] Generated contract ${contractId} for lead ${payload.leadId}`);
        break;
      }
      case 'send_negotiation_offer': {
        // Pipeline: send negotiation counter-offer via AI
        const payload: any = job.payload;
        const { sendCounterOffer } = await import('./negotiationProcessor');
        const result = await sendCounterOffer({
          sessionId: payload.sessionId,
          leadId: payload.leadId,
          organizationId: payload.organizationId,
          offerCents: payload.offerCents,
          proseTemplate: payload.proseTemplate,
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to send counter offer');
        }
        console.log(`[send_negotiation_offer] Sent counter for session ${payload.sessionId}: ${payload.offerCents} cents`);
        break;
      }
      case 'process_negotiation': {
        // Automated negotiation: evaluate incoming counter-offer
        const payload: any = job.payload;
        const { processNegotiation } = await import('./negotiationProcessor');
        const result = await processNegotiation({
          sessionId: payload.sessionId,
          leadId: payload.leadId,
          organizationId: payload.organizationId,
          inboundMessage: payload.inboundMessage,
          messageEventId: payload.messageEventId,
        });
        console.log(`[process_negotiation] Session ${payload.sessionId}: ${result.outcome}`);
        break;
      }
      case 'escalate_negotiation': {
        // Escalate negotiation to human review
        const payload: any = job.payload;
        const { escalateNegotiation } = await import('./negotiationProcessor');
        await escalateNegotiation({
          sessionId: payload.sessionId,
          leadId: payload.leadId,
          organizationId: payload.organizationId,
          reason: payload.reason,
          inboundMessage: payload.inboundMessage,
        });
        console.log(`[escalate_negotiation] Escalated session ${payload.sessionId}: ${payload.reason}`);
        break;
      }
      case 'send_contract': {
        // Pipeline: send contract for signature
        const payload: any = job.payload;
        const [contract] = await sql`
          SELECT c.*, l.email, l.name FROM contracts c
          LEFT JOIN leads l ON l.id = c.seller_lead_id
          WHERE c.id = ${payload.contractId}
        `;
        if (contract && (payload.email || contract.email)) {
          const { sendEmailAuto } = await import('./emailProviders');
          await sendEmailAuto(payload.organizationId, {
            to: payload.email || contract.email,
            subject: `Contract Ready for Signature - ${contract.name || 'Your Property'}`,
            text: `Your purchase agreement is ready for review and signature. Please click the link below to review and sign.`,
            html: `<p>Your purchase agreement is ready for review and signature.</p><p>Please click the link below to review and sign.</p>`,
          });
          await sql`
            UPDATE contracts SET status = 'PENDING_SIGNATURE', sent_at = NOW(), updated_at = NOW()
            WHERE id = ${payload.contractId}
          `;
        }
        console.log(`[send_contract] Sent contract ${payload.contractId}`);
        break;
      }
      case 'send_action_notification_email': {
        // Pipeline: send email notification for action item
        const payload: any = job.payload;
        const { sendEmailAuto } = await import('./emailProviders');
        // Get org owner email
        const [owner] = await sql`
          SELECT u.email FROM organization_members om
          JOIN "user" u ON u.id = om.user_id
          WHERE om.organization_id = ${payload.organizationId}
            AND om.role = 'OWNER'
          LIMIT 1
        `;
        if (owner?.email) {
          await sendEmailAuto(payload.organizationId, {
            to: owner.email,
            subject: `[${payload.priority}] Action Required: ${payload.title}`,
            text: `You have a new action item requiring attention: ${payload.title}. Log in to review.`,
            html: `<p>You have a new action item requiring attention:</p><p><strong>${payload.title}</strong></p><p>Log in to review.</p>`,
          });
        }
        break;
      }
      case 'send_action_notification_sms': {
        // Pipeline: send SMS notification for urgent action
        const payload: any = job.payload;
        const ownerNumber = process.env.OWNER_NUMBER;
        if (ownerNumber) {
          const gateway = await getGateway();
          await gateway.send({
            to: ownerNumber,
            text: `URGENT: ${payload.title}. Log in to take action.`,
            leadId: 'action-notification',
            transactional: true,
            organizationId: payload.organizationId,
          });
        }
        break;
      }
      case 'send_digest_email': {
        // Pipeline: send daily digest email
        const payload: any = job.payload;
        const { sendEmailAuto } = await import('./emailProviders');
        const notifications = payload.notifications || [];
        const [user] = payload.userId
          ? await sql`SELECT email FROM "user" WHERE id = ${payload.userId}`
          : await sql`
              SELECT u.email FROM organization_members om
              JOIN "user" u ON u.id = om.user_id
              WHERE om.organization_id = ${payload.organizationId} AND om.role = 'OWNER'
              LIMIT 1
            `;
        if (user?.email) {
          const summaryLines = notifications.map((n: any) =>
            `- ${n.title || n.type}: ${n.summary || ''}`
          ).join('\n');
          await sendEmailAuto(payload.organizationId, {
            to: user.email,
            subject: `Daily Digest: ${notifications.length} items`,
            text: `Your daily summary:\n\n${summaryLines}`,
            html: `<h2>Your Daily Summary</h2><ul>${notifications.map((n: any) =>
              `<li><strong>${n.title || n.type}</strong>: ${n.summary || ''}</li>`
            ).join('')}</ul>`,
          });
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

    // Refund credits on permanent failure (dead-lettered) for send jobs
    // Note: For transient failures (retryable), we don't refund since the job will retry
    if (isDead && (job.type === 'send_message' || job.type === 'send_email')) {
      const payload: any = job.payload;
      if (payload.organizationId && payload._creditDeducted) {
        // Use the originally deducted amount stored in payload (not recalculated)
        // This ensures exact refund even if pricing changed since deduction
        const refundAmount = payload._creditDeducted;
        const originalTransactionId = payload._creditTransactionId;
        const action = job.type === 'send_message'
          ? (payload.channel === 'sms' ? 'SMS_SEND' : 'EMAIL_SEND')
          : 'EMAIL_SEND';

        // Refund the exact credit amount that was originally deducted
        await refundCredits(
          payload.organizationId,
          refundAmount,
          `Refund: ${action} permanently failed`,
          { jobId: job.id, jobType: job.type, error: error.message },
          originalTransactionId
        ).catch(console.error); // Best-effort refund
      }
    }

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
