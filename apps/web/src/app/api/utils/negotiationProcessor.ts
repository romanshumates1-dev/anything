/**
 * Negotiation Processor - Job handlers for automated AI negotiation
 *
 * This module processes incoming counter-offers and manages the negotiation
 * state machine. It achieves 90%+ automation by:
 * 1. Extracting prices from inbound messages using AI
 * 2. Evaluating counters against configured bounds
 * 3. Auto-responding within limits or escalating to humans
 *
 * Job Types:
 * - process_negotiation: Evaluate an incoming counter-offer
 * - send_counter_offer: Send an AI-generated counter
 * - escalate_negotiation: Add to human action queue
 */

import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { createActionItem } from '@/app/api/utils/pipelineOrchestrator';
import { callAI } from '@/app/api/utils/ai-provider';
import {
  evaluateCounterOffer,
  generateCounterResponse,
  computePhaseTransition,
  shouldEscalate,
  formatOffer,
  injectOffer,
  OFFER_SLOT,
  type NegotiationConfig,
  type NegotiationSessionState,
  type NegotiationPhase,
  type EvaluationResult,
  type CounterResponse,
  STRATEGY_CONCESSION_CURVES,
} from './negotiationEngine';
import { parseCounterCents, advanceRound } from './negotiationSession';

// ── PRICE EXTRACTION ─────────────────────────────────────────────────────────

const PRICE_EXTRACTION_PROMPT = `You are analyzing a response to a real estate offer negotiation. Extract any price or counter-offer amount mentioned.

Message: {MESSAGE}

Context: This is a response from a property {SIDE} regarding a real estate purchase offer.

Return ONLY valid JSON (no markdown, no explanation):
{
  "hasPrice": true | false,
  "priceCents": null | integer,
  "priceText": null | string,
  "confidence": 0.0-1.0,
  "sentiment": "accepting" | "countering" | "questioning" | "rejecting" | "unclear",
  "needsEscalation": true | false,
  "escalationReason": null | string
}

Rules:
- Convert all prices to cents (multiply by 100)
- "90k" = 9000000 cents, "$85,000" = 8500000 cents
- If multiple prices, extract the one most likely to be their counter-offer
- Set needsEscalation=true for: legal threats, emotional distress, explicit requests for human contact
- confidence < 0.7 if the price is ambiguous or unclear`;

export interface PriceExtractionResult {
  hasPrice: boolean;
  priceCents: number | null;
  priceText: string | null;
  confidence: number;
  sentiment: 'accepting' | 'countering' | 'questioning' | 'rejecting' | 'unclear';
  needsEscalation: boolean;
  escalationReason: string | null;
}

/**
 * Extract price/counter-offer from a message using AI.
 * Falls back to regex parsing if AI is unavailable.
 */
export async function extractPriceFromMessage(
  message: string,
  side: 'seller' | 'buyer'
): Promise<PriceExtractionResult> {
  // First try simple regex extraction (fast path for obvious prices)
  const regexPrice = parseCounterCents(message);
  if (regexPrice !== null) {
    // Validate it's a reasonable real estate price ($1k - $10M)
    if (regexPrice >= 100_000 && regexPrice <= 1_000_000_000) {
      return {
        hasPrice: true,
        priceCents: regexPrice,
        priceText: formatOffer(regexPrice),
        confidence: 0.85,
        sentiment: 'countering',
        needsEscalation: false,
        escalationReason: null,
      };
    }
  }

  // AI extraction for complex cases
  try {
    const prompt = PRICE_EXTRACTION_PROMPT
      .replace('{MESSAGE}', message.slice(0, 500))
      .replace('{SIDE}', side);

    const result = await callAI({
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a precise price extraction assistant. Return only JSON.',
      json: true,
    });

    const parsed = JSON.parse(result.text.replace(/```json\n?|\n?```/g, '').trim());

    return {
      hasPrice: Boolean(parsed.hasPrice),
      priceCents: parsed.priceCents ?? null,
      priceText: parsed.priceText ?? null,
      confidence: Number(parsed.confidence) || 0.5,
      sentiment: parsed.sentiment || 'unclear',
      needsEscalation: Boolean(parsed.needsEscalation),
      escalationReason: parsed.escalationReason ?? null,
    };
  } catch (error) {
    // Fallback: no price found, may need human review
    return {
      hasPrice: false,
      priceCents: null,
      priceText: null,
      confidence: 0.3,
      sentiment: 'unclear',
      needsEscalation: true,
      escalationReason: 'AI extraction failed, manual review recommended',
    };
  }
}

// ── NEGOTIATION RESPONSE GENERATION ──────────────────────────────────────────

const NEGOTIATION_RESPONSE_PROMPT = `You are an experienced real estate wholesaler responding to a {SIDE} during price negotiation.

Current situation:
- We offered: {OUR_OFFER}
- They countered with: {THEIR_COUNTER}
- We are now responding with: {NEW_OFFER}
- This is round {ROUND} of negotiation
- Our strategy: {STRATEGY}

Generate a brief, professional SMS response (under 160 chars if possible, max 300).
Include the placeholder {OFFER} where the price should go.
Be respectful, acknowledge their position, and explain our offer rationale briefly.

Do NOT mention the actual dollar amount - use {OFFER} exactly once.
Do NOT be pushy or use high-pressure tactics.
DO be direct, respectful, and solution-oriented.

Return ONLY the message text, no quotes or explanation.`;

/**
 * Generate AI prose for a negotiation response.
 * The {OFFER} slot is injected with the computed figure AFTER generation.
 */
export async function generateNegotiationProse(
  side: 'seller' | 'buyer',
  ourOfferCents: number,
  theirCounterCents: number | null,
  newOfferCents: number,
  round: number,
  strategy: string
): Promise<string> {
  const prompt = NEGOTIATION_RESPONSE_PROMPT
    .replace('{SIDE}', side)
    .replace('{OUR_OFFER}', formatOffer(ourOfferCents))
    .replace('{THEIR_COUNTER}', theirCounterCents ? formatOffer(theirCounterCents) : 'N/A')
    .replace('{NEW_OFFER}', formatOffer(newOfferCents))
    .replace('{ROUND}', String(round))
    .replace('{STRATEGY}', strategy);

  try {
    const result = await callAI({
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a real estate negotiation expert. Write concise, professional messages.',
    });

    let text = result.text.trim();

    // Ensure {OFFER} is present
    if (!text.includes(OFFER_SLOT)) {
      // Insert it at a logical place
      if (text.toLowerCase().includes('offer')) {
        text = text.replace(/offer/i, `offer of ${OFFER_SLOT}`);
      } else {
        text = `${text} Our offer: ${OFFER_SLOT}.`;
      }
    }

    return text;
  } catch (error) {
    // Fallback templates
    if (side === 'seller') {
      return `Based on our analysis of the property and current market conditions, we can offer ${OFFER_SLOT} cash with a 14-day close. Let me know if this works for you.`;
    } else {
      return `Thank you for your interest. Given the current buyer demand, we're able to assign at ${OFFER_SLOT}. This ensures a smooth transaction for both parties.`;
    }
  }
}

// ── JOB HANDLERS ─────────────────────────────────────────────────────────────

export interface ProcessNegotiationPayload {
  sessionId: string;
  leadId: number;
  organizationId: string;
  inboundMessage: string;
  messageEventId?: string;
}

/**
 * Process an incoming counter-offer from a lead.
 * This is the main entry point for the automated negotiation flow.
 */
export async function processNegotiation(
  payload: ProcessNegotiationPayload
): Promise<{
  outcome: 'counter_sent' | 'accepted' | 'escalated' | 'walked_away' | 'error';
  details: Record<string, unknown>;
}> {
  const { sessionId, leadId, organizationId, inboundMessage } = payload;

  // Check if automated negotiation is enabled
  if (!(await isBetaFlagOn('boundedNegotiation'))) {
    return { outcome: 'escalated', details: { reason: 'boundedNegotiation flag is off' } };
  }

  // Load session state
  const [session] = await sql`
    SELECT * FROM negotiation_sessions WHERE id = ${sessionId}
  `;

  if (!session) {
    return { outcome: 'error', details: { error: 'Session not found' } };
  }

  if (session.status !== 'active') {
    return { outcome: 'error', details: { error: `Session status is ${session.status}` } };
  }

  // Extract price from inbound message
  const extraction = await extractPriceFromMessage(inboundMessage, session.side);

  await logEvent('negotiation_extraction', 'lead', String(leadId), {
    sessionId,
    hasPrice: extraction.hasPrice,
    priceCents: extraction.priceCents,
    confidence: extraction.confidence,
    sentiment: extraction.sentiment,
  }, organizationId);

  // Check if we need to escalate due to extraction issues
  if (extraction.needsEscalation || extraction.confidence < 0.6) {
    await escalateNegotiation({
      sessionId,
      leadId,
      organizationId,
      reason: extraction.escalationReason || 'Low confidence price extraction',
      inboundMessage,
    });
    return { outcome: 'escalated', details: { reason: extraction.escalationReason } };
  }

  // No price detected - might be a question or comment
  if (!extraction.hasPrice || extraction.priceCents === null) {
    // Check sentiment to determine response
    if (extraction.sentiment === 'accepting') {
      // They might be accepting our offer without restating price
      // Escalate to confirm
      await escalateNegotiation({
        sessionId,
        leadId,
        organizationId,
        reason: 'Possible acceptance without explicit price - needs confirmation',
        inboundMessage,
      });
      return { outcome: 'escalated', details: { sentiment: extraction.sentiment } };
    }

    if (extraction.sentiment === 'rejecting') {
      // They rejected - mark as walked away
      await sql`
        UPDATE negotiation_sessions
        SET status = 'walked_away', updated_at = NOW()
        WHERE id = ${sessionId}
      `;
      return { outcome: 'walked_away', details: { sentiment: 'rejecting' } };
    }

    // Questions or unclear - escalate for human handling
    await escalateNegotiation({
      sessionId,
      leadId,
      organizationId,
      reason: 'No price in response - may be a question',
      inboundMessage,
    });
    return { outcome: 'escalated', details: { sentiment: extraction.sentiment } };
  }

  // We have a price - use the bounded negotiation session flow
  const config = buildSessionConfig(session);
  const proseTemplate = await generateNegotiationProse(
    session.side,
    session.last_offer_cents || session.opener_cents,
    extraction.priceCents,
    extraction.priceCents, // Will be replaced by advanceRound
    session.round + 1,
    config.strategy
  );

  // Use the existing advanceRound which handles all the state management
  const result = await advanceRound(sessionId, String(extraction.priceCents / 100), proseTemplate);

  switch (result.outcome) {
    case 'agreed':
      // Deal accepted - trigger contract generation
      await enqueueJob('generate_contract_auto', {
        organizationId,
        negotiationSessionId: sessionId,
        leadId,
        priceCents: result.counterCents,
      });
      return { outcome: 'accepted', details: { agreedCents: result.counterCents } };

    case 'offer_queued':
      return { outcome: 'counter_sent', details: { offerCents: result.offerCents, round: result.round } };

    case 'walked_away':
      return { outcome: 'walked_away', details: { reason: 'Max rounds exceeded or outside bounds' } };

    case 'escalated':
      return { outcome: 'escalated', details: { reason: result.reason } };

    case 'inactive':
      return { outcome: 'error', details: { reason: result.reason } };

    default:
      return { outcome: 'error', details: { result } };
  }
}

/**
 * Build a NegotiationConfig from a session row.
 */
function buildSessionConfig(session: Record<string, any>): NegotiationConfig {
  return {
    minPriceCents: Number(session.approved_min_cents),
    maxPriceCents: Number(session.approved_max_cents),
    targetPriceCents: Math.round((Number(session.approved_min_cents) + Number(session.approved_max_cents)) / 2),
    strategy: session.strategy || 'balanced',
    autoApproveUnderCents: session.auto_approve_under_cents || 10_000_000,
    escalateOverCents: session.escalate_over_cents || 50_000_000,
    maxRounds: session.max_rounds || 4,
  };
}

export interface SendCounterOfferPayload {
  sessionId: string;
  leadId: number;
  organizationId: string;
  offerCents: number;
  proseTemplate?: string;
}

/**
 * Send a counter-offer to the lead.
 */
export async function sendCounterOffer(
  payload: SendCounterOfferPayload
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const { sessionId, leadId, organizationId, offerCents, proseTemplate } = payload;

  // Get lead phone
  const [lead] = await sql`SELECT phone FROM leads WHERE id = ${leadId}`;
  if (!lead?.phone) {
    return { success: false, error: 'Lead has no phone number' };
  }

  // Generate prose if not provided
  const template = proseTemplate || await generateNegotiationProse(
    'seller', // Default to seller side
    offerCents,
    null,
    offerCents,
    1,
    'balanced'
  );

  // Inject the offer amount
  const text = injectOffer(template.includes(OFFER_SLOT) ? template : `${template} ${OFFER_SLOT}`, offerCents);

  // Get session for context
  const [session] = await sql`SELECT * FROM negotiation_sessions WHERE id = ${sessionId}`;

  // Enqueue the send job
  const jobId = await enqueueJob(
    'send_message',
    {
      leadId,
      to: lead.phone,
      text,
      channel: 'sms',
      organizationId,
      boundedNegotiation: {
        computedOfferCents: offerCents,
        approvedMinCents: session?.approved_min_cents || offerCents * 0.8,
        approvedMaxCents: session?.approved_max_cents || offerCents * 1.2,
        sessionId,
      },
    },
    { dedupeKey: `negoffer:${sessionId}:${session?.round || 0}` }
  );

  await logEvent('negotiation_counter_sent', 'lead', String(leadId), {
    sessionId,
    offerCents,
    jobId,
  }, organizationId);

  return { success: true, jobId: jobId as string };
}

export interface EscalateNegotiationPayload {
  sessionId: string;
  leadId: number;
  organizationId: string;
  reason: string;
  inboundMessage?: string;
}

/**
 * Escalate a negotiation to the human action queue.
 */
export async function escalateNegotiation(
  payload: EscalateNegotiationPayload
): Promise<string> {
  const { sessionId, leadId, organizationId, reason, inboundMessage } = payload;

  // Pause the automated session
  await sql`
    UPDATE negotiation_sessions
    SET status = 'paused', updated_at = NOW()
    WHERE id = ${sessionId}
  `;

  // Get lead info
  const [lead] = await sql`SELECT name, phone FROM leads WHERE id = ${leadId}`;
  const leadName = lead?.name || `Lead #${leadId}`;

  // Create action item
  const actionId = await createActionItem({
    organizationId,
    type: 'REVIEW_RESPONSE',
    title: `Review negotiation: ${leadName}`,
    description: reason,
    entityType: 'negotiation',
    entityId: sessionId,
    priority: 'HIGH',
    metadata: {
      leadId,
      sessionId,
      inboundMessage: inboundMessage?.slice(0, 500),
      reason,
    },
    quickActions: [
      { action: 'continue_ai', label: 'Resume AI Negotiation' },
      { action: 'respond_manual', label: 'Respond Manually' },
      { action: 'walk_away', label: 'Walk Away', variant: 'destructive' },
    ],
    autoContinueHours: 24,
    autoContinueAction: 'walk_away',
  });

  await logEvent('negotiation_escalated', 'lead', String(leadId), {
    sessionId,
    reason,
    actionId,
  }, organizationId);

  return actionId;
}

// ── STATISTICS AND MONITORING ────────────────────────────────────────────────

export interface NegotiationStats {
  total: number;
  active: number;
  agreed: number;
  walkedAway: number;
  paused: number;
  autoResolved: number;
  escalated: number;
  avgRounds: number;
  autoResolutionRate: number;
}

/**
 * Get negotiation statistics for an organization.
 */
export async function getNegotiationStats(organizationId: string): Promise<NegotiationStats> {
  const stats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'active') as active,
      COUNT(*) FILTER (WHERE status = 'agreed') as agreed,
      COUNT(*) FILTER (WHERE status = 'walked_away') as walked_away,
      COUNT(*) FILTER (WHERE status = 'paused') as paused,
      AVG(round) as avg_rounds
    FROM negotiation_sessions
    WHERE organization_id = ${organizationId}
  `;

  const row = stats[0] || {};
  const total = Number(row.total) || 0;
  const agreed = Number(row.agreed) || 0;
  const walkedAway = Number(row.walked_away) || 0;
  const paused = Number(row.paused) || 0;

  // Auto-resolved = agreed + walked_away (without escalation)
  const escalatedCount = await sql`
    SELECT COUNT(*) as count FROM action_queue
    WHERE organization_id = ${organizationId}
      AND entity_type = 'negotiation'
  `;
  const escalated = Number(escalatedCount[0]?.count) || 0;
  const autoResolved = agreed + walkedAway - escalated;

  return {
    total,
    active: Number(row.active) || 0,
    agreed,
    walkedAway,
    paused,
    autoResolved: Math.max(0, autoResolved),
    escalated,
    avgRounds: Number(row.avg_rounds) || 0,
    autoResolutionRate: total > 0 ? (autoResolved / total) * 100 : 0,
  };
}
