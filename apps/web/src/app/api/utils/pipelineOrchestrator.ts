/**
 * Pipeline Orchestrator
 *
 * Coordinates all automated systems with minimal human interaction.
 * Design principle: AI runs everything, humans only intervene when genuinely beneficial.
 *
 * Human Interaction Points (ONLY these):
 * - Campaign Setup: Initial configuration (user knows their market)
 * - Deal Review: Over threshold amount (high-value decisions)
 * - Contract Signing: Final approval (legal commitment)
 * - Closing Confirmation: Deal completion (payment release)
 *
 * Everything else is automated.
 */

import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface PipelineConfig {
  organizationId: string;
  dealAutoApproveMaxCents: number;
  contractAutoSend: boolean;
  autoContinueLowRiskHours: number;
  autoContinueNormalRiskHours: number;
  autoContinueEnabled: boolean;
  notificationMode: 'IMMEDIATE' | 'BATCH' | 'DIGEST';
  digestHour: number;
  digestTimezone: string;
  smsNotifications: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  autoLeadScoring: boolean;
  autoCampaignAssignment: boolean;
  autoResponseClassification: boolean;
  autoNegotiation: boolean;
  autoContractGeneration: boolean;
}

export interface ActionQueueItem {
  id: string;
  organizationId: string;
  userId: string | null;
  type: ActionType;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  entityType: string | null;
  entityId: string | null;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  quickActions: QuickAction[];
  status: ActionStatus;
  autoContinueAt: Date | null;
  autoContinueAction: string | null;
  dueAt: Date | null;
  createdAt: Date;
}

export type ActionType =
  | 'REVIEW_DEAL'
  | 'APPROVE_CONTRACT'
  | 'CONFIRM_CLOSING'
  | 'REVIEW_RESPONSE'
  | 'ESCALATION'
  | 'CAMPAIGN_SETUP'
  | 'EXCEPTION';

export type ActionStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'AUTO_CONTINUED'
  | 'EXPIRED';

export interface QuickAction {
  action: string;
  label: string;
  variant?: 'default' | 'destructive' | 'secondary';
}

export interface PipelineRunStats {
  leadIngestion: { processed: number; errors: number; durationMs: number };
  outreach: { sent: number; deferred: number; suppressed: number };
  responses: { classified: number; escalated: number };
  negotiations: { advanced: number; walkAway: number };
  contracts: { generated: number; sent: number };
  closings: { completed: number };
}

export interface PipelineRunResult {
  runId: string;
  stats: PipelineRunStats;
  humanActionsCreated: number;
  errors: Array<{ stage: string; error: string }>;
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: Omit<PipelineConfig, 'organizationId'> = {
  dealAutoApproveMaxCents: 10_000_000, // $100k
  contractAutoSend: false,
  autoContinueLowRiskHours: 24,
  autoContinueNormalRiskHours: 48,
  autoContinueEnabled: true,
  notificationMode: 'BATCH',
  digestHour: 9,
  digestTimezone: 'America/New_York',
  smsNotifications: true,
  emailNotifications: true,
  pushNotifications: false,
  autoLeadScoring: true,
  autoCampaignAssignment: true,
  autoResponseClassification: true,
  autoNegotiation: true,
  autoContractGeneration: true,
};

export async function getPipelineConfig(organizationId: string): Promise<PipelineConfig> {
  const [row] = await sql`
    SELECT * FROM pipeline_config WHERE organization_id = ${organizationId}
  `;

  if (!row) {
    return { organizationId, ...DEFAULT_CONFIG };
  }

  return {
    organizationId,
    dealAutoApproveMaxCents: row.deal_auto_approve_max_cents ?? DEFAULT_CONFIG.dealAutoApproveMaxCents,
    contractAutoSend: row.contract_auto_send ?? DEFAULT_CONFIG.contractAutoSend,
    autoContinueLowRiskHours: row.auto_continue_low_risk_hours ?? DEFAULT_CONFIG.autoContinueLowRiskHours,
    autoContinueNormalRiskHours: row.auto_continue_normal_risk_hours ?? DEFAULT_CONFIG.autoContinueNormalRiskHours,
    autoContinueEnabled: row.auto_continue_enabled ?? DEFAULT_CONFIG.autoContinueEnabled,
    notificationMode: row.notification_mode ?? DEFAULT_CONFIG.notificationMode,
    digestHour: row.digest_hour ?? DEFAULT_CONFIG.digestHour,
    digestTimezone: row.digest_timezone ?? DEFAULT_CONFIG.digestTimezone,
    smsNotifications: row.sms_notifications ?? DEFAULT_CONFIG.smsNotifications,
    emailNotifications: row.email_notifications ?? DEFAULT_CONFIG.emailNotifications,
    pushNotifications: row.push_notifications ?? DEFAULT_CONFIG.pushNotifications,
    autoLeadScoring: row.auto_lead_scoring ?? DEFAULT_CONFIG.autoLeadScoring,
    autoCampaignAssignment: row.auto_campaign_assignment ?? DEFAULT_CONFIG.autoCampaignAssignment,
    autoResponseClassification: row.auto_response_classification ?? DEFAULT_CONFIG.autoResponseClassification,
    autoNegotiation: row.auto_negotiation ?? DEFAULT_CONFIG.autoNegotiation,
    autoContractGeneration: row.auto_contract_generation ?? DEFAULT_CONFIG.autoContractGeneration,
  };
}

export async function updatePipelineConfig(
  organizationId: string,
  updates: Partial<Omit<PipelineConfig, 'organizationId'>>
): Promise<PipelineConfig> {
  await sql`
    INSERT INTO pipeline_config (organization_id)
    VALUES (${organizationId})
    ON CONFLICT (organization_id) DO NOTHING
  `;

  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.dealAutoApproveMaxCents !== undefined) {
    setClauses.push('deal_auto_approve_max_cents = $' + (values.length + 1));
    values.push(updates.dealAutoApproveMaxCents);
  }
  if (updates.contractAutoSend !== undefined) {
    setClauses.push('contract_auto_send = $' + (values.length + 1));
    values.push(updates.contractAutoSend);
  }
  // ... additional fields would follow the same pattern

  if (setClauses.length > 0) {
    await sql`
      UPDATE pipeline_config
      SET ${sql.unsafe(setClauses.join(', '))}, updated_at = NOW()
      WHERE organization_id = ${organizationId}
    `;
  }

  return getPipelineConfig(organizationId);
}

// ============================================================================
// Action Queue Management
// ============================================================================

export async function createActionItem(params: {
  organizationId: string;
  type: ActionType;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  userId?: string;
  metadata?: Record<string, unknown>;
  quickActions?: QuickAction[];
  dueAt?: Date;
  autoContinueHours?: number;
  autoContinueAction?: string;
}): Promise<string> {
  const {
    organizationId,
    type,
    title,
    description,
    entityType,
    entityId,
    priority = 'NORMAL',
    userId,
    metadata = {},
    quickActions = [],
    dueAt,
    autoContinueHours,
    autoContinueAction,
  } = params;

  const autoContinueAt = autoContinueHours
    ? new Date(Date.now() + autoContinueHours * 60 * 60 * 1000)
    : null;

  const [action] = await sql`
    INSERT INTO action_queue (
      organization_id, user_id, type, priority, entity_type, entity_id,
      title, description, metadata, quick_actions, due_at,
      auto_continue_at, auto_continue_action
    ) VALUES (
      ${organizationId}, ${userId ?? null}, ${type}, ${priority},
      ${entityType ?? null}, ${entityId ?? null},
      ${title}, ${description ?? null}, ${JSON.stringify(metadata)},
      ${JSON.stringify(quickActions)}, ${dueAt ?? null},
      ${autoContinueAt}, ${autoContinueAction ?? null}
    )
    RETURNING id
  `;

  await logEvent('action_queue_created', 'action_queue', action.id, {
    type,
    priority,
    entityType,
    entityId,
  }, organizationId);

  // Send immediate notification if configured
  const config = await getPipelineConfig(organizationId);
  if (config.notificationMode === 'IMMEDIATE' || priority === 'URGENT') {
    await sendActionNotification(organizationId, action.id, title, priority);
  } else if (config.notificationMode === 'BATCH') {
    await addToNotificationBatch(organizationId, userId ?? null, {
      type: 'action_item',
      actionId: action.id,
      title,
      priority,
      createdAt: new Date().toISOString(),
    });
  }

  return action.id;
}

export async function getActionQueue(
  organizationId: string,
  options: {
    status?: ActionStatus;
    priority?: string;
    type?: ActionType;
    userId?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ items: ActionQueueItem[]; total: number }> {
  const { status = 'PENDING', priority, type, userId, limit = 50, offset = 0 } = options;

  // Build dynamic query conditions
  let conditions = sql`organization_id = ${organizationId}`;

  if (status) {
    conditions = sql`${conditions} AND status = ${status}`;
  }
  if (priority) {
    conditions = sql`${conditions} AND priority = ${priority}`;
  }
  if (type) {
    conditions = sql`${conditions} AND type = ${type}`;
  }
  if (userId) {
    conditions = sql`${conditions} AND (user_id = ${userId} OR user_id IS NULL)`;
  }

  const [countResult] = await sql`
    SELECT COUNT(*) as total FROM action_queue WHERE ${conditions}
  `;

  const items = await sql`
    SELECT * FROM action_queue
    WHERE ${conditions}
    ORDER BY
      CASE priority
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'NORMAL' THEN 3
        WHEN 'LOW' THEN 4
      END,
      created_at ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    items: items.map(mapActionQueueRow),
    total: Number(countResult.total),
  };
}

export async function completeAction(
  actionId: string,
  userId: string,
  resultAction: string,
  notes?: string
): Promise<void> {
  const [action] = await sql`
    UPDATE action_queue
    SET status = 'COMPLETED',
        completed_at = NOW(),
        completed_by = ${userId},
        result_action = ${resultAction},
        result_notes = ${notes ?? null},
        updated_at = NOW()
    WHERE id = ${actionId}
    RETURNING *
  `;

  if (action) {
    await logEvent('action_queue_completed', 'action_queue', actionId, {
      resultAction,
      completedBy: userId,
    }, action.organization_id);
  }
}

export async function skipAction(actionId: string, userId: string, reason: string): Promise<void> {
  const [action] = await sql`
    UPDATE action_queue
    SET status = 'SKIPPED',
        completed_at = NOW(),
        completed_by = ${userId},
        result_notes = ${reason},
        updated_at = NOW()
    WHERE id = ${actionId}
    RETURNING *
  `;

  if (action) {
    await logEvent('action_queue_skipped', 'action_queue', actionId, {
      reason,
      skippedBy: userId,
    }, action.organization_id);
  }
}

function mapActionQueueRow(row: Record<string, unknown>): ActionQueueItem {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    userId: row.user_id as string | null,
    type: row.type as ActionType,
    priority: row.priority as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
    entityType: row.entity_type as string | null,
    entityId: row.entity_id as string | null,
    title: row.title as string,
    description: row.description as string | null,
    metadata: (row.metadata || {}) as Record<string, unknown>,
    quickActions: (row.quick_actions || []) as QuickAction[],
    status: row.status as ActionStatus,
    autoContinueAt: row.auto_continue_at ? new Date(row.auto_continue_at as string) : null,
    autoContinueAction: row.auto_continue_action as string | null,
    dueAt: row.due_at ? new Date(row.due_at as string) : null,
    createdAt: new Date(row.created_at as string),
  };
}

// ============================================================================
// Pipeline Orchestrator
// ============================================================================

export async function runPipeline(organizationId: string): Promise<PipelineRunResult> {
  const runId = crypto.randomUUID();
  const startTime = Date.now();
  const errors: Array<{ stage: string; error: string }> = [];
  const stats: PipelineRunStats = {
    leadIngestion: { processed: 0, errors: 0, durationMs: 0 },
    outreach: { sent: 0, deferred: 0, suppressed: 0 },
    responses: { classified: 0, escalated: 0 },
    negotiations: { advanced: 0, walkAway: 0 },
    contracts: { generated: 0, sent: 0 },
    closings: { completed: 0 },
  };
  let humanActionsCreated = 0;

  // Start pipeline run record
  await sql`
    INSERT INTO pipeline_runs (id, organization_id, started_at, status)
    VALUES (${runId}, ${organizationId}, NOW(), 'RUNNING')
  `;

  const config = await getPipelineConfig(organizationId);

  try {
    // Stage 1: Lead Ingestion
    const ingestionStart = Date.now();
    try {
      const ingestionResult = await processLeadIngestion(organizationId, config);
      stats.leadIngestion = {
        processed: ingestionResult.processed,
        errors: ingestionResult.errors,
        durationMs: Date.now() - ingestionStart,
      };
    } catch (e: unknown) {
      errors.push({ stage: 'lead_ingestion', error: String(e) });
    }

    // Stage 2: Outreach
    try {
      const outreachResult = await processOutreach(organizationId, config);
      stats.outreach = outreachResult;
    } catch (e: unknown) {
      errors.push({ stage: 'outreach', error: String(e) });
    }

    // Stage 3: Response Processing
    try {
      const responsesResult = await processResponses(organizationId, config);
      stats.responses = responsesResult;
      humanActionsCreated += responsesResult.escalated;
    } catch (e: unknown) {
      errors.push({ stage: 'responses', error: String(e) });
    }

    // Stage 4: Negotiations
    try {
      const negotiationsResult = await processNegotiations(organizationId, config);
      stats.negotiations = negotiationsResult;
    } catch (e: unknown) {
      errors.push({ stage: 'negotiations', error: String(e) });
    }

    // Stage 5: Contracts
    try {
      const contractsResult = await processContracts(organizationId, config);
      stats.contracts = contractsResult;
      if (!config.contractAutoSend) {
        humanActionsCreated += contractsResult.generated;
      }
    } catch (e: unknown) {
      errors.push({ stage: 'contracts', error: String(e) });
    }

    // Stage 6: Closings
    try {
      const closingsResult = await processClosings(organizationId, config);
      stats.closings = closingsResult;
      humanActionsCreated += closingsResult.completed; // All closings need confirmation
    } catch (e: unknown) {
      errors.push({ stage: 'closings', error: String(e) });
    }

    // Process auto-continue items
    await processAutoContinue(organizationId);

  } finally {
    // Complete pipeline run record
    const status = errors.length === 0 ? 'COMPLETED' : (errors.length < 6 ? 'PARTIAL' : 'FAILED');
    await sql`
      UPDATE pipeline_runs
      SET completed_at = NOW(),
          status = ${status},
          stage_stats = ${JSON.stringify(stats)},
          leads_processed = ${stats.leadIngestion.processed},
          messages_sent = ${stats.outreach.sent},
          responses_handled = ${stats.responses.classified},
          deals_advanced = ${stats.negotiations.advanced},
          contracts_generated = ${stats.contracts.generated},
          human_actions_created = ${humanActionsCreated},
          errors = ${JSON.stringify(errors)}
      WHERE id = ${runId}
    `;

    await logEvent('pipeline_run_completed', 'pipeline', runId, {
      durationMs: Date.now() - startTime,
      status,
      stats,
      errorsCount: errors.length,
    }, organizationId);
  }

  return { runId, stats, humanActionsCreated, errors };
}

// ============================================================================
// Stage Processors
// ============================================================================

async function processLeadIngestion(
  organizationId: string,
  config: PipelineConfig
): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors = 0;

  // Find leads that need processing (new imports, unsorted leads)
  const leads = await sql`
    SELECT id, name, phone, email, metadata, source
    FROM leads
    WHERE status = 'new'
      AND (metadata->>'organization_id' = ${organizationId} OR metadata IS NULL)
    ORDER BY created_at ASC
    LIMIT 100
  `;

  for (const lead of leads) {
    try {
      // Auto-score lead if enabled
      if (config.autoLeadScoring) {
        await scoreAndCategorizeLead(lead.id, organizationId);
      }

      // Auto-assign to campaign if enabled
      if (config.autoCampaignAssignment) {
        await assignLeadToCampaign(lead.id, organizationId);
      }

      // Update lead status
      await sql`
        UPDATE leads
        SET status = 'processed',
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{organization_id}', ${JSON.stringify(organizationId)}::jsonb),
            updated_at = NOW()
        WHERE id = ${lead.id}
      `;

      processed++;
    } catch (e) {
      console.error(`[pipeline] Failed to process lead ${lead.id}:`, e);
      errors++;
    }
  }

  return { processed, errors };
}

async function scoreAndCategorizeLead(leadId: number | string, organizationId: string): Promise<void> {
  // Get lead data
  const [lead] = await sql`SELECT * FROM leads WHERE id = ${leadId}`;
  if (!lead) return;

  // Simple scoring based on available data
  let score = 50; // Base score

  // Has phone = +20
  if (lead.phone) score += 20;
  // Has email = +10
  if (lead.email) score += 10;
  // Has metadata = +10
  if (lead.metadata && Object.keys(lead.metadata).length > 0) score += 10;

  // Check for distress signals in metadata
  const metadata = lead.metadata || {};
  if (metadata.distress_indicators || metadata.motivation) score += 20;
  if (metadata.property_condition === 'poor') score += 15;
  if (metadata.tax_delinquent) score += 25;
  if (metadata.pre_foreclosure) score += 30;

  // Clamp score
  score = Math.min(100, Math.max(0, score));

  // Update lead with score
  await sql`
    UPDATE leads
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{lead_score}',
      ${score}::text::jsonb
    ),
    updated_at = NOW()
    WHERE id = ${leadId}
  `;
}

async function assignLeadToCampaign(leadId: number | string, organizationId: string): Promise<void> {
  // Find active campaign for this lead type
  const [lead] = await sql`SELECT * FROM leads WHERE id = ${leadId}`;
  if (!lead) return;

  // Check if already assigned
  const [existing] = await sql`
    SELECT id FROM campaign_contacts
    WHERE (seller_lead_id = ${leadId} OR buyer_lead_id = ${leadId})
    LIMIT 1
  `;
  if (existing) return;

  // Find matching active campaign
  const [campaign] = await sql`
    SELECT id FROM outreach_campaigns
    WHERE organization_id = ${organizationId}
      AND status = 'ACTIVE'
      AND direction = ${lead.type === 'buyer' ? 'BUYER' : 'SELLER'}
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (campaign && lead.phone) {
    // Add to campaign
    await sql`
      INSERT INTO campaign_contacts (
        campaign_id, phone,
        ${lead.type === 'buyer' ? sql`buyer_lead_id` : sql`seller_lead_id`},
        status, created_at
      ) VALUES (
        ${campaign.id}, ${lead.phone}, ${leadId}, 'PENDING', NOW()
      )
      ON CONFLICT DO NOTHING
    `;
  }
}

async function processOutreach(
  organizationId: string,
  _config: PipelineConfig
): Promise<{ sent: number; deferred: number; suppressed: number }> {
  // Check for pending messages in campaign queue
  const pending = await sql`
    SELECT COUNT(*) as count FROM jobs
    WHERE type = 'send_message'
      AND status = 'pending'
      AND payload->>'organizationId' = ${organizationId}
  `;

  // Trigger job processing by enqueueing a drain job
  if (Number(pending[0]?.count) > 0) {
    await enqueueJob('process_outreach_batch', { organizationId }, { dedupeKey: `outreach:${organizationId}:${Date.now()}` });
  }

  // Get stats from recent job completions
  const stats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'completed' AND error_message IS NULL) as sent,
      COUNT(*) FILTER (WHERE status = 'pending' AND error_message LIKE 'deferred:%') as deferred,
      COUNT(*) FILTER (WHERE status = 'completed' AND error_message LIKE 'suppressed:%') as suppressed
    FROM jobs
    WHERE type = 'send_message'
      AND payload->>'organizationId' = ${organizationId}
      AND updated_at > NOW() - INTERVAL '1 hour'
  `;

  return {
    sent: Number(stats[0]?.sent || 0),
    deferred: Number(stats[0]?.deferred || 0),
    suppressed: Number(stats[0]?.suppressed || 0),
  };
}

async function processResponses(
  organizationId: string,
  config: PipelineConfig
): Promise<{ classified: number; escalated: number }> {
  let classified = 0;
  let escalated = 0;

  if (!config.autoResponseClassification) {
    return { classified: 0, escalated: 0 };
  }

  // Find unprocessed conversations that need classification
  const conversations = await sql`
    SELECT ac.*, l.name as lead_name, l.phone
    FROM ai_conversations ac
    JOIN leads l ON l.id = ac.lead_id
    WHERE ac.status = 'needs_review'
      AND ac.requires_human = true
    ORDER BY ac.last_message_at DESC
    LIMIT 50
  `;

  for (const conv of conversations) {
    try {
      // Get last message
      const history = conv.history || [];
      const lastMessage = history[history.length - 1];

      if (lastMessage?.role === 'user') {
        // Check if it contains price/numbers that need human review
        const needsHumanReview = await checkNeedsHumanReview(lastMessage.content, conv);

        if (needsHumanReview) {
          // Create action item for human review
          await createActionItem({
            organizationId,
            type: 'REVIEW_RESPONSE',
            title: `Review response from ${conv.lead_name || 'Lead'}`,
            description: lastMessage.content.slice(0, 200),
            entityType: 'conversation',
            entityId: conv.id,
            priority: 'HIGH',
            metadata: { phone: conv.phone, leadId: conv.lead_id },
            quickActions: [
              { action: 'approve_ai', label: 'Let AI Continue' },
              { action: 'respond_manual', label: 'Respond Manually' },
              { action: 'escalate', label: 'Escalate', variant: 'destructive' },
            ],
            autoContinueHours: config.autoContinueLowRiskHours,
            autoContinueAction: 'approve_ai',
          });
          escalated++;
        } else {
          // Auto-continue AI conversation
          await sql`
            UPDATE ai_conversations
            SET requires_human = false, status = 'active', updated_at = NOW()
            WHERE id = ${conv.id}
          `;
        }
        classified++;
      }
    } catch (e) {
      console.error(`[pipeline] Failed to process response ${conv.id}:`, e);
    }
  }

  return { classified, escalated };
}

async function checkNeedsHumanReview(
  message: string,
  _conv: Record<string, unknown>
): Promise<boolean> {
  // Check for price mentions
  const pricePattern = /\$[\d,]+|\d+[kK]|\d{4,}/;
  if (pricePattern.test(message)) return true;

  // Check for legal terms
  const legalTerms = /attorney|lawyer|lawsuit|sue|legal|contract|escrow|title/i;
  if (legalTerms.test(message)) return true;

  // Check for emotional distress
  const distressTerms = /death|divorce|foreclosure|bankruptcy|urgent|emergency/i;
  if (distressTerms.test(message)) return true;

  // Check for explicit counter-offer language
  const counterTerms = /counter|offer|accept|reject|deal|agree/i;
  if (counterTerms.test(message)) return true;

  return false;
}

async function processNegotiations(
  organizationId: string,
  config: PipelineConfig
): Promise<{ advanced: number; walkAway: number }> {
  let advanced = 0;
  let walkAway = 0;

  if (!config.autoNegotiation) {
    return { advanced: 0, walkAway: 0 };
  }

  // Find active negotiation sessions
  const sessions = await sql`
    SELECT ns.*, l.name as lead_name
    FROM negotiation_sessions ns
    JOIN leads l ON l.id = ns.lead_id
    WHERE ns.organization_id = ${organizationId}
      AND ns.status = 'ACTIVE'
      AND ns.awaiting_response = false
    ORDER BY ns.updated_at ASC
    LIMIT 20
  `;

  for (const session of sessions) {
    try {
      const { computeNextOffer, counterAcceptable } = await import('@/app/api/utils/negotiationEngine');

      // Get current offer state
      const offerState = {
        side: session.side as 'seller' | 'buyer',
        openerCents: session.opener_cents,
        clampCents: session.clamp_cents,
        round: session.current_round,
        lastOfferCents: session.last_offer_cents,
      };

      // Check if counter is acceptable
      if (session.counter_offer_cents) {
        if (counterAcceptable(offerState.side, session.counter_offer_cents, offerState.clampCents)) {
          // Accept the counter - move to contract stage
          await sql`
            UPDATE negotiation_sessions
            SET status = 'ACCEPTED', accepted_price_cents = ${session.counter_offer_cents}, updated_at = NOW()
            WHERE id = ${session.id}
          `;

          // Check if deal exceeds auto-approval threshold
          if (session.counter_offer_cents > config.dealAutoApproveMaxCents) {
            await createActionItem({
              organizationId,
              type: 'REVIEW_DEAL',
              title: `Review deal: ${session.lead_name}`,
              description: `Deal price $${(session.counter_offer_cents / 100).toLocaleString()} exceeds auto-approval threshold`,
              entityType: 'negotiation',
              entityId: session.id,
              priority: 'HIGH',
              metadata: { priceCents: session.counter_offer_cents, leadId: session.lead_id },
              quickActions: [
                { action: 'approve', label: 'Approve Deal' },
                { action: 'reject', label: 'Reject', variant: 'destructive' },
                { action: 'renegotiate', label: 'Renegotiate' },
              ],
            });
          } else {
            // Auto-approve and queue contract generation
            await enqueueJob('generate_contract_auto', {
              organizationId,
              negotiationSessionId: session.id,
              leadId: session.lead_id,
              priceCents: session.counter_offer_cents,
            });
          }
          advanced++;
          continue;
        }
      }

      // Compute next offer
      const nextOffer = computeNextOffer(offerState);

      if (nextOffer.kind === 'walk_away') {
        await sql`
          UPDATE negotiation_sessions
          SET status = 'WALKED_AWAY', updated_at = NOW()
          WHERE id = ${session.id}
        `;
        walkAway++;
      } else {
        // Send counter offer via AI
        await sql`
          UPDATE negotiation_sessions
          SET current_round = current_round + 1,
              last_offer_cents = ${nextOffer.offerCents},
              awaiting_response = true,
              updated_at = NOW()
          WHERE id = ${session.id}
        `;

        // Queue the response message
        await enqueueJob('send_negotiation_offer', {
          organizationId,
          sessionId: session.id,
          offerCents: nextOffer.offerCents,
        });

        advanced++;
      }
    } catch (e) {
      console.error(`[pipeline] Failed to process negotiation ${session.id}:`, e);
    }
  }

  return { advanced, walkAway };
}

async function processContracts(
  organizationId: string,
  config: PipelineConfig
): Promise<{ generated: number; sent: number }> {
  let generated = 0;
  let sent = 0;

  if (!config.autoContractGeneration) {
    return { generated: 0, sent: 0 };
  }

  // Find accepted negotiations ready for contract
  const accepted = await sql`
    SELECT ns.*, l.name as lead_name, l.email as lead_email
    FROM negotiation_sessions ns
    JOIN leads l ON l.id = ns.lead_id
    WHERE ns.organization_id = ${organizationId}
      AND ns.status = 'ACCEPTED'
      AND ns.contract_id IS NULL
    LIMIT 10
  `;

  for (const session of accepted) {
    try {
      // Generate contract
      const contractId = crypto.randomUUID();
      await sql`
        INSERT INTO contracts (id, organization_id, seller_lead_id, status, contract_price_cents, created_at)
        VALUES (${contractId}, ${organizationId}, ${session.lead_id}, 'PENDING_APPROVAL', ${session.accepted_price_cents}, NOW())
      `;

      // Link to negotiation
      await sql`
        UPDATE negotiation_sessions SET contract_id = ${contractId}, updated_at = NOW()
        WHERE id = ${session.id}
      `;

      generated++;

      // Create approval action if not auto-send
      if (!config.contractAutoSend) {
        await createActionItem({
          organizationId,
          type: 'APPROVE_CONTRACT',
          title: `Approve contract: ${session.lead_name}`,
          description: `Contract for $${(session.accepted_price_cents / 100).toLocaleString()} ready for approval`,
          entityType: 'contract',
          entityId: contractId,
          priority: 'NORMAL',
          metadata: { priceCents: session.accepted_price_cents, leadId: session.lead_id },
          quickActions: [
            { action: 'approve_send', label: 'Approve & Send' },
            { action: 'review', label: 'Review First' },
            { action: 'reject', label: 'Reject', variant: 'destructive' },
          ],
          autoContinueHours: config.autoContinueNormalRiskHours,
          autoContinueAction: 'approve_send',
        });
      } else {
        // Auto-send contract
        await enqueueJob('send_contract', {
          organizationId,
          contractId,
          leadId: session.lead_id,
          email: session.lead_email,
        });
        sent++;
      }
    } catch (e) {
      console.error(`[pipeline] Failed to generate contract for session ${session.id}:`, e);
    }
  }

  return { generated, sent };
}

async function processClosings(
  organizationId: string,
  _config: PipelineConfig
): Promise<{ completed: number }> {
  let completed = 0;

  // Find contracts that are signed and ready for closing confirmation
  const readyToClose = await sql`
    SELECT c.*, l.name as lead_name
    FROM contracts c
    JOIN leads l ON l.id = c.seller_lead_id
    WHERE c.organization_id = ${organizationId}
      AND c.status = 'SIGNED'
      AND c.closing_confirmed_at IS NULL
    LIMIT 10
  `;

  for (const contract of readyToClose) {
    try {
      // Create closing confirmation action (always requires human)
      await createActionItem({
        organizationId,
        type: 'CONFIRM_CLOSING',
        title: `Confirm closing: ${contract.lead_name}`,
        description: `Contract signed, confirm deal closed for $${(contract.contract_price_cents / 100).toLocaleString()}`,
        entityType: 'contract',
        entityId: contract.id,
        priority: 'HIGH',
        metadata: {
          priceCents: contract.contract_price_cents,
          leadId: contract.seller_lead_id,
          signedAt: contract.signed_at,
        },
        quickActions: [
          { action: 'confirm_closed', label: 'Confirm Closed' },
          { action: 'mark_cancelled', label: 'Cancelled', variant: 'destructive' },
          { action: 'extend', label: 'Extend Closing' },
        ],
      });
      completed++;
    } catch (e) {
      console.error(`[pipeline] Failed to create closing action for contract ${contract.id}:`, e);
    }
  }

  return { completed };
}

// ============================================================================
// Auto-Continue Processing
// ============================================================================

export async function processAutoContinue(organizationId: string): Promise<number> {
  const config = await getPipelineConfig(organizationId);
  if (!config.autoContinueEnabled) return 0;

  // Find items ready for auto-continue
  const items = await sql`
    SELECT * FROM action_queue
    WHERE organization_id = ${organizationId}
      AND status = 'PENDING'
      AND auto_continue_at IS NOT NULL
      AND auto_continue_at <= NOW()
      AND auto_continue_action IS NOT NULL
    LIMIT 20
  `;

  let processed = 0;
  for (const item of items) {
    try {
      // Execute the auto-continue action
      await executeAutoContinueAction(item);

      // Mark as auto-continued
      await sql`
        UPDATE action_queue
        SET status = 'AUTO_CONTINUED',
            completed_at = NOW(),
            result_action = ${item.auto_continue_action},
            result_notes = 'Auto-continued after timeout',
            updated_at = NOW()
        WHERE id = ${item.id}
      `;

      await logEvent('action_auto_continued', 'action_queue', item.id, {
        action: item.auto_continue_action,
        type: item.type,
      }, organizationId);

      processed++;
    } catch (e) {
      console.error(`[pipeline] Failed to auto-continue action ${item.id}:`, e);
    }
  }

  return processed;
}

async function executeAutoContinueAction(item: Record<string, unknown>): Promise<void> {
  const action = item.auto_continue_action as string;
  const entityType = item.entity_type as string;
  const entityId = item.entity_id as string;

  switch (action) {
    case 'approve_ai':
      if (entityType === 'conversation') {
        await sql`
          UPDATE ai_conversations
          SET requires_human = false, status = 'active', updated_at = NOW()
          WHERE id = ${entityId}
        `;
      }
      break;

    case 'approve_send':
      if (entityType === 'contract') {
        await enqueueJob('send_contract', {
          organizationId: item.organization_id,
          contractId: entityId,
        });
      }
      break;

    case 'approve':
      if (entityType === 'negotiation') {
        const [session] = await sql`
          SELECT * FROM negotiation_sessions WHERE id = ${entityId}
        `;
        if (session) {
          await enqueueJob('generate_contract_auto', {
            organizationId: item.organization_id,
            negotiationSessionId: entityId,
            leadId: session.lead_id,
            priceCents: session.accepted_price_cents,
          });
        }
      }
      break;
  }
}

// ============================================================================
// Notifications
// ============================================================================

async function sendActionNotification(
  organizationId: string,
  actionId: string,
  title: string,
  priority: string
): Promise<void> {
  const config = await getPipelineConfig(organizationId);

  if (config.emailNotifications) {
    // Queue email notification
    await enqueueJob('send_action_notification_email', {
      organizationId,
      actionId,
      title,
      priority,
    });
  }

  if (config.smsNotifications && priority === 'URGENT') {
    // Queue SMS for urgent only
    await enqueueJob('send_action_notification_sms', {
      organizationId,
      actionId,
      title,
    });
  }
}

async function addToNotificationBatch(
  organizationId: string,
  userId: string | null,
  notification: Record<string, unknown>
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  await sql`
    INSERT INTO notification_batches (organization_id, user_id, batch_date, notifications)
    VALUES (${organizationId}, ${userId}, ${today}, ${JSON.stringify([notification])}::jsonb)
    ON CONFLICT (organization_id, user_id, batch_date)
    WHERE user_id IS NOT NULL
    DO UPDATE SET notifications = notification_batches.notifications || ${JSON.stringify([notification])}::jsonb
  `;
}

// ============================================================================
// Pipeline Status
// ============================================================================

export interface PipelineStatus {
  isRunning: boolean;
  lastRun: {
    id: string;
    startedAt: Date;
    completedAt: Date | null;
    status: string;
    stats: PipelineRunStats;
  } | null;
  pendingActions: {
    total: number;
    urgent: number;
    high: number;
    normal: number;
    low: number;
  };
  stageHealth: {
    stage: string;
    status: 'healthy' | 'degraded' | 'error';
    lastProcessed: Date | null;
    errorRate: number;
  }[];
}

export async function getPipelineStatus(organizationId: string): Promise<PipelineStatus> {
  // Get last pipeline run
  const [lastRun] = await sql`
    SELECT * FROM pipeline_runs
    WHERE organization_id = ${organizationId}
    ORDER BY started_at DESC
    LIMIT 1
  `;

  // Get pending action counts
  const actionCounts = await sql`
    SELECT priority, COUNT(*) as count
    FROM action_queue
    WHERE organization_id = ${organizationId}
      AND status = 'PENDING'
    GROUP BY priority
  `;

  const pendingActions = {
    total: 0,
    urgent: 0,
    high: 0,
    normal: 0,
    low: 0,
  };

  for (const row of actionCounts) {
    const count = Number(row.count);
    pendingActions.total += count;
    const priority = (row.priority as string).toLowerCase() as keyof typeof pendingActions;
    if (priority in pendingActions) {
      pendingActions[priority] = count;
    }
  }

  // Calculate stage health from recent job stats
  const stageHealth = await calculateStageHealth(organizationId);

  return {
    isRunning: lastRun?.status === 'RUNNING',
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: new Date(lastRun.started_at),
          completedAt: lastRun.completed_at ? new Date(lastRun.completed_at) : null,
          status: lastRun.status,
          stats: lastRun.stage_stats || {},
        }
      : null,
    pendingActions,
    stageHealth,
  };
}

async function calculateStageHealth(
  organizationId: string
): Promise<PipelineStatus['stageHealth']> {
  const stages = [
    { name: 'lead_ingestion', jobType: 'score_lead' },
    { name: 'outreach', jobType: 'send_message' },
    { name: 'responses', jobType: 'ai_reply' },
    { name: 'negotiations', jobType: 'send_negotiation_offer' },
    { name: 'contracts', jobType: 'send_contract' },
  ];

  const health: PipelineStatus['stageHealth'] = [];

  for (const stage of stages) {
    const stats = await sql`
      SELECT
        MAX(updated_at) as last_processed,
        COUNT(*) FILTER (WHERE status = 'dead') as errors,
        COUNT(*) as total
      FROM jobs
      WHERE type = ${stage.jobType}
        AND payload->>'organizationId' = ${organizationId}
        AND created_at > NOW() - INTERVAL '24 hours'
    `;

    const errorRate = stats[0]?.total > 0
      ? Number(stats[0].errors) / Number(stats[0].total)
      : 0;

    health.push({
      stage: stage.name,
      status: errorRate > 0.2 ? 'error' : errorRate > 0.05 ? 'degraded' : 'healthy',
      lastProcessed: stats[0]?.last_processed ? new Date(stats[0].last_processed) : null,
      errorRate,
    });
  }

  return health;
}

// ============================================================================
// Scheduled Jobs
// ============================================================================

/**
 * Schedule the pipeline to run periodically.
 * Called by a cron job or worker.
 */
export async function schedulePipelineRun(organizationId: string): Promise<string | null> {
  return enqueueJob(
    'run_pipeline',
    { organizationId },
    {
      dedupeKey: `pipeline:${organizationId}:${new Date().toISOString().split('T')[0]}`,
    }
  );
}

/**
 * Send daily digest notifications.
 * Called by a cron job at the configured digest hour.
 */
export async function sendDailyDigests(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  const batches = await sql`
    SELECT nb.*, pc.digest_hour, pc.digest_timezone
    FROM notification_batches nb
    JOIN pipeline_config pc ON pc.organization_id = nb.organization_id
    WHERE nb.batch_date = ${today}
      AND nb.status = 'PENDING'
  `;

  let sent = 0;
  for (const batch of batches) {
    try {
      // Check if it's the right hour in the org's timezone
      // (simplified - in production use a proper timezone library)
      const now = new Date();
      const hour = now.getUTCHours(); // Would need timezone conversion

      if (hour === batch.digest_hour) {
        await enqueueJob('send_digest_email', {
          organizationId: batch.organization_id,
          userId: batch.user_id,
          notifications: batch.notifications,
        });

        await sql`
          UPDATE notification_batches
          SET status = 'SENT', sent_at = NOW()
          WHERE id = ${batch.id}
        `;

        sent++;
      }
    } catch (e) {
      console.error(`[pipeline] Failed to send digest ${batch.id}:`, e);
    }
  }

  return sent;
}
