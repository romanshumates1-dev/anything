/**
 * Buyer Pipeline Engine
 *
 * Comprehensive buyer pipeline with ALL seller pipeline features adapted for buyers.
 * Ensures buyers have equivalent automation:
 *
 * SELLER FEATURE → BUYER EQUIVALENT
 * ─────────────────────────────────────────────────────────────────────
 * 1. Cadence Engine (multi-touch)      → Buyer Cadence (deal announcements)
 * 2. Stalled Conversation Recovery     → Buyer Re-engagement
 * 3. Resurrection Engine (30-180 day)  → Buyer Reactivation (dormant investors)
 * 4. Negotiation Engine                → Assignment Negotiation
 * 5. AI Reply Classification           → Buyer Interest Classification
 * 6. Contract Generation               → Assignment Contract Generation
 * 7. E-Sign                            → Assignment E-Sign
 * 8. VIP Window                        → Already buyer-side
 * 9. Regional Fee Engine               → Assignment Fee Calculator
 * 10. Trust Signals                    → Buyer Verification Signals
 *
 * Pipeline Stages (Buyer):
 * NEW → CONTACTED → INTERESTED → QUALIFIED → MATCHED → OFFERED → ACCEPTED → CLOSED
 */

import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';
import { callAI } from '@/app/api/utils/ai-provider';
import { sendEmailAuto } from '@/app/api/utils/emailProviders';
import { sendPipelineSMS } from '@/app/api/utils/smsOutreachEngine';

export type BuyerPipelineStage =
  | 'NEW'
  | 'CONTACTED'
  | 'INTERESTED'
  | 'QUALIFIED'
  | 'MATCHED'
  | 'OFFERED'
  | 'ACCEPTED'
  | 'CLOSED'
  | 'LOST';

export interface BuyerPipelineConfig {
  cadenceEnabled: boolean;
  reengagementEnabled: boolean;
  reactivationEnabled: boolean;
  autoQualifyEnabled: boolean;
  thresholds: {
    reengagementHours: number;      // 48-168 hours stalled
    reactivationDays: number;        // 60-180 days dormant
    maxTouchesPerBuyer: number;      // Cap at 8 touches
  };
}

const DEFAULT_CONFIG: BuyerPipelineConfig = {
  cadenceEnabled: true,
  reengagementEnabled: true,
  reactivationEnabled: true,
  autoQualifyEnabled: true,
  thresholds: {
    reengagementHours: 72,
    reactivationDays: 90,
    maxTouchesPerBuyer: 8,
  },
};

// ─── BUYER CADENCE ENGINE ────────────────────────────────────────────────────
// Multi-touch sequences for buyer outreach (equivalent to seller cadence)

export interface BuyerCadenceStep {
  sequenceOrder: number;
  channel: 'email' | 'sms';
  delayHours: number;
  templateType: 'intro' | 'deal_alert' | 'followup' | 'urgency' | 'last_chance';
}

const BUYER_CADENCE_SEQUENCE: BuyerCadenceStep[] = [
  { sequenceOrder: 1, channel: 'email', delayHours: 0, templateType: 'intro' },
  { sequenceOrder: 2, channel: 'sms', delayHours: 24, templateType: 'deal_alert' },
  { sequenceOrder: 3, channel: 'email', delayHours: 72, templateType: 'followup' },
  { sequenceOrder: 4, channel: 'sms', delayHours: 168, templateType: 'urgency' },
  { sequenceOrder: 5, channel: 'email', delayHours: 336, templateType: 'last_chance' },
];

export async function scheduleBuyerCadence(
  buyerId: string,
  organizationId: string,
  dealContext?: { dealId: string; propertyAddress: string; price: number }
): Promise<{ queued: number }> {
  let queued = 0;

  for (const step of BUYER_CADENCE_SEQUENCE) {
    const runAt = new Date(Date.now() + step.delayHours * 60 * 60 * 1000);

    await enqueueJob('buyer_cadence_step', {
      buyerId,
      organizationId,
      sequenceOrder: step.sequenceOrder,
      channel: step.channel,
      templateType: step.templateType,
      dealContext,
    }, {
      runAt,
      maxAttempts: 3,
      dedupeKey: `buyer_cadence_${buyerId}_${step.sequenceOrder}`,
    });

    queued++;
  }

  return { queued };
}

// ─── BUYER RE-ENGAGEMENT ENGINE ──────────────────────────────────────────────
// Re-engage buyers who showed interest but went silent (equivalent to stalled conversations)

export interface StalledBuyer {
  id: string;
  name: string;
  email: string;
  phone: string;
  lastActivityAt: Date;
  hoursSinceActivity: number;
  status: string;
  interestedDeals: number;
}

export async function findStalledBuyers(
  organizationId: string,
  thresholdHours: number = 72
): Promise<StalledBuyer[]> {
  const stalledBuyers = await sql`
    SELECT
      b.id,
      b.name,
      b.email,
      b.phone,
      b.updated_at as last_activity_at,
      EXTRACT(EPOCH FROM (NOW() - b.updated_at)) / 3600 as hours_since_activity,
      b.status,
      COALESCE(
        (SELECT COUNT(*) FROM buyer_assignments ba WHERE ba.buyer_id = b.id AND ba.status = 'interested'),
        0
      ) as interested_deals
    FROM buyers b
    WHERE b.organization_id = ${organizationId}
      AND b.status IN ('CONTACTED', 'INTERESTED')
      AND b.updated_at < NOW() - INTERVAL '${thresholdHours} hours'
      AND b.updated_at > NOW() - INTERVAL '14 days'
      AND NOT b.is_blacklisted
    ORDER BY hours_since_activity ASC
    LIMIT 50
  `.catch(() => []);

  return (stalledBuyers as any[]).map(b => ({
    id: b.id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    lastActivityAt: new Date(b.last_activity_at),
    hoursSinceActivity: Math.round(b.hours_since_activity),
    status: b.status,
    interestedDeals: b.interested_deals,
  }));
}

export async function reengageStalledBuyer(
  buyer: StalledBuyer,
  organizationId: string
): Promise<{ sent: boolean; channel: string }> {
  const message = getBuyerReengagementMessage(buyer);

  // Try SMS first, then email
  if (buyer.phone) {
    await sendPipelineSMS({
      to: buyer.phone,
      message: message.sms,
      leadId: buyer.id,
      organizationId,
      channel: 'buyer',
    });
    return { sent: true, channel: 'sms' };
  } else if (buyer.email) {
    await sendEmailAuto(organizationId, {
      to: buyer.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true, channel: 'email' };
  }

  return { sent: false, channel: 'none' };
}

function getBuyerReengagementMessage(buyer: StalledBuyer) {
  const firstName = buyer.name.split(' ')[0] || 'there';

  if (buyer.hoursSinceActivity < 96) {
    // Soft check-in (48-96 hours)
    return {
      subject: `Quick follow up, ${firstName}`,
      sms: `Hi ${firstName}, just checking in. We have new deals coming in. Still looking for investment properties?`,
      text: `Hi ${firstName},\n\nJust wanted to follow up and see if you're still looking for investment opportunities.\n\nWe have some new deals coming through that might match your criteria.\n\nLet me know if you'd like to see what's available.\n\nBest`,
      html: `<p>Hi ${firstName},</p><p>Just wanted to follow up and see if you're still looking for investment opportunities.</p><p>We have some new deals coming through that might match your criteria.</p><p>Let me know if you'd like to see what's available.</p>`,
    };
  } else if (buyer.hoursSinceActivity < 168) {
    // Value reinforcement (96-168 hours)
    return {
      subject: `New deals in your area, ${firstName}`,
      sms: `${firstName}, we just got 3 new off-market deals. 20-30% below market. Want first look?`,
      text: `Hi ${firstName},\n\nWe've locked up several new properties that I thought might interest you.\n\nThese are off-market deals at 20-30% below retail - the kind that go fast.\n\nWould you like me to send over the details?\n\nBest`,
      html: `<p>Hi ${firstName},</p><p>We've locked up several new properties that I thought might interest you.</p><p>These are off-market deals at <strong>20-30% below retail</strong> - the kind that go fast.</p><p>Would you like me to send over the details?</p>`,
    };
  } else {
    // Last chance (168+ hours)
    return {
      subject: `Before I close your file, ${firstName}`,
      sms: `${firstName}, before I take you off my active buyer list - is there anything holding you back? Happy to discuss.`,
      text: `Hi ${firstName},\n\nI wanted to reach out one more time before I mark your file as inactive.\n\nIs there anything specific you're looking for that we haven't been able to match?\n\nIf your situation has changed, no worries - just let me know and I'll keep you on my list for future deals.\n\nBest`,
      html: `<p>Hi ${firstName},</p><p>I wanted to reach out one more time before I mark your file as inactive.</p><p>Is there anything specific you're looking for that we haven't been able to match?</p><p>If your situation has changed, no worries - just let me know and I'll keep you on my list for future deals.</p>`,
    };
  }
}

// ─── BUYER REACTIVATION ENGINE ───────────────────────────────────────────────
// Reactivate dormant buyers (60-180 days) - equivalent to resurrection engine

export async function findDormantBuyers(
  organizationId: string,
  minDays: number = 60,
  maxDays: number = 180
): Promise<StalledBuyer[]> {
  const dormantBuyers = await sql`
    SELECT
      b.id,
      b.name,
      b.email,
      b.phone,
      b.updated_at as last_activity_at,
      EXTRACT(DAY FROM (NOW() - b.updated_at)) as days_since_activity,
      b.status,
      b.actual_close_count as closed_deals
    FROM buyers b
    WHERE b.organization_id = ${organizationId}
      AND b.updated_at < NOW() - INTERVAL '${minDays} days'
      AND b.updated_at > NOW() - INTERVAL '${maxDays} days'
      AND NOT b.is_blacklisted
      AND (b.email IS NOT NULL OR b.phone IS NOT NULL)
    ORDER BY b.actual_close_count DESC, days_since_activity ASC
    LIMIT 100
  `.catch(() => []);

  return (dormantBuyers as any[]).map(b => ({
    id: b.id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    lastActivityAt: new Date(b.last_activity_at),
    hoursSinceActivity: b.days_since_activity * 24,
    status: b.status,
    interestedDeals: b.closed_deals || 0,
  }));
}

export async function reactivateDormantBuyers(organizationId: string): Promise<{ reactivated: number }> {
  const dormant = await findDormantBuyers(organizationId);
  let reactivated = 0;

  for (const buyer of dormant) {
    const firstName = buyer.name.split(' ')[0] || 'there';
    const message = `Hi ${firstName}, it's been a while! We've built up our deal flow significantly. Looking for cash buyers who can close in 2-3 weeks. Still investing?`;

    if (buyer.phone) {
      await enqueueJob('send_pipeline_sms', {
        to: buyer.phone,
        message,
        leadId: buyer.id,
        organizationId,
        channel: 'buyer',
      }, {
        maxAttempts: 3,
        dedupeKey: `buyer_reactivate_${buyer.id}`,
      });
      reactivated++;
    } else if (buyer.email) {
      await enqueueJob('send_email', {
        organizationId,
        to: buyer.email,
        subject: 'Still investing in real estate?',
        text: message,
        html: `<p>${message}</p>`,
      }, {
        maxAttempts: 3,
        dedupeKey: `buyer_reactivate_email_${buyer.id}`,
      });
      reactivated++;
    }
  }

  await logEvent('buyer_reactivation_run', 'system', organizationId, {
    dormantFound: dormant.length,
    reactivated,
  }, organizationId);

  return { reactivated };
}

// ─── BUYER INTEREST CLASSIFICATION ───────────────────────────────────────────
// AI classification of buyer responses (equivalent to seller reply classification)

export type BuyerInterestLevel = 'HOT' | 'WARM' | 'COOL' | 'NOT_INTERESTED' | 'SPAM';

export interface BuyerClassification {
  interestLevel: BuyerInterestLevel;
  buyerType: 'cash' | 'financed' | 'unknown';
  timeline: 'immediate' | 'short_term' | 'long_term' | 'unknown';
  priceRange: { min: number; max: number } | null;
  propertyTypes: string[];
  nextAction: string;
  confidence: number;
}

export async function classifyBuyerResponse(
  message: string,
  buyerContext?: { name: string; previousInteractions: number }
): Promise<BuyerClassification> {
  const prompt = `Classify this investor/buyer response for a real estate wholesale deal.

Message: "${message}"

${buyerContext ? `Context: Buyer name is ${buyerContext.name}, ${buyerContext.previousInteractions} previous interactions.` : ''}

Classify:
1. Interest Level: HOT (ready to buy now), WARM (interested, needs info), COOL (maybe later), NOT_INTERESTED, SPAM
2. Buyer Type: cash, financed, or unknown
3. Timeline: immediate (this week), short_term (this month), long_term (3+ months), unknown
4. Price range if mentioned (min/max)
5. Property types interested in (SFR, multi, commercial, etc.)
6. Recommended next action

Respond in JSON format:
{
  "interestLevel": "HOT|WARM|COOL|NOT_INTERESTED|SPAM",
  "buyerType": "cash|financed|unknown",
  "timeline": "immediate|short_term|long_term|unknown",
  "priceRange": {"min": number, "max": number} or null,
  "propertyTypes": ["string"],
  "nextAction": "string",
  "confidence": 0.0-1.0
}`;

  try {
    const response = await callAI({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
      json: true,
    });

    const parsed = JSON.parse(response.text);
    return {
      interestLevel: parsed.interestLevel || 'COOL',
      buyerType: parsed.buyerType || 'unknown',
      timeline: parsed.timeline || 'unknown',
      priceRange: parsed.priceRange || null,
      propertyTypes: parsed.propertyTypes || [],
      nextAction: parsed.nextAction || 'Send deal details',
      confidence: parsed.confidence || 0.5,
    };
  } catch (e) {
    console.error('[BUYER-CLASSIFY] AI classification failed:', e);
    // Fallback to keyword-based classification
    return classifyBuyerResponseFallback(message);
  }
}

function classifyBuyerResponseFallback(message: string): BuyerClassification {
  const lower = message.toLowerCase();

  // HOT signals
  if (/yes|interested|send|deal|buy|cash|ready|let'?s|show me/i.test(lower)) {
    return {
      interestLevel: 'HOT',
      buyerType: /cash/i.test(lower) ? 'cash' : 'unknown',
      timeline: 'immediate',
      priceRange: null,
      propertyTypes: [],
      nextAction: 'Send deal details immediately',
      confidence: 0.7,
    };
  }

  // NOT_INTERESTED signals
  if (/no|stop|remove|unsubscribe|not interested|don't contact/i.test(lower)) {
    return {
      interestLevel: 'NOT_INTERESTED',
      buyerType: 'unknown',
      timeline: 'unknown',
      priceRange: null,
      propertyTypes: [],
      nextAction: 'Mark as not interested, respect opt-out',
      confidence: 0.9,
    };
  }

  // WARM - asking questions
  if (/what|where|how much|price|details|more info|\?/i.test(lower)) {
    return {
      interestLevel: 'WARM',
      buyerType: 'unknown',
      timeline: 'short_term',
      priceRange: null,
      propertyTypes: [],
      nextAction: 'Answer questions and send deal info',
      confidence: 0.6,
    };
  }

  // Default to COOL
  return {
    interestLevel: 'COOL',
    buyerType: 'unknown',
    timeline: 'unknown',
    priceRange: null,
    propertyTypes: [],
    nextAction: 'Add to nurture sequence',
    confidence: 0.4,
  };
}

// ─── ASSIGNMENT NEGOTIATION ENGINE ───────────────────────────────────────────
// Negotiate assignment fees with buyers (equivalent to seller negotiation)

export interface AssignmentOffer {
  dealId: string;
  buyerId: string;
  propertyAddress: string;
  purchasePrice: number;
  askingFee: number;
  minimumFee: number;
}

export interface NegotiationResponse {
  counterOffer: number | null;
  accepted: boolean;
  message: string;
  nextAction: string;
}

export async function negotiateAssignmentFee(
  offer: AssignmentOffer,
  buyerMessage: string
): Promise<NegotiationResponse> {
  const prompt = `You are negotiating an assignment fee with a real estate investor buyer.

Deal details:
- Property: ${offer.propertyAddress}
- Purchase price: $${offer.purchasePrice.toLocaleString()}
- Our asking assignment fee: $${offer.askingFee.toLocaleString()}
- Our minimum acceptable fee: $${offer.minimumFee.toLocaleString()}

Buyer's message: "${buyerMessage}"

Respond with a negotiation strategy. If they offer below minimum, counter firmly but professionally.
If they accept or offer above minimum, accept. Always maintain urgency without being pushy.

Respond in JSON:
{
  "counterOffer": number or null (if accepting),
  "accepted": boolean,
  "message": "Response to buyer",
  "nextAction": "next step"
}`;

  try {
    const response = await callAI({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 500,
      json: true,
    });

    return JSON.parse(response.text);
  } catch (e) {
    console.error('[ASSIGNMENT-NEGOTIATE] AI failed:', e);

    // Check if buyer mentioned a number
    const priceMatch = buyerMessage.match(/\$?([\d,]+)/);
    if (priceMatch) {
      const offeredPrice = parseInt(priceMatch[1].replace(/,/g, ''), 10);

      if (offeredPrice >= offer.minimumFee) {
        return {
          counterOffer: null,
          accepted: true,
          message: `Great, we can do $${offeredPrice.toLocaleString()}. I'll send over the assignment contract right away.`,
          nextAction: 'Generate assignment contract',
        };
      } else {
        const counter = Math.round((offer.askingFee + offer.minimumFee) / 2);
        return {
          counterOffer: counter,
          accepted: false,
          message: `I appreciate the offer. The lowest we can go on this one is $${counter.toLocaleString()} - it's a solid deal that will move fast. Can you meet us there?`,
          nextAction: 'Wait for buyer response',
        };
      }
    }

    return {
      counterOffer: null,
      accepted: false,
      message: 'Thanks for your interest. Were you thinking about making an offer on this assignment?',
      nextAction: 'Clarify buyer intent',
    };
  }
}

// ─── BUYER PIPELINE STAGE TRANSITIONS ────────────────────────────────────────

export async function transitionBuyerStage(
  buyerId: string,
  toStage: BuyerPipelineStage,
  organizationId: string,
  metadata?: Record<string, any>
): Promise<void> {
  const [buyer] = await sql`
    SELECT status FROM buyers WHERE id = ${buyerId}
  `.catch(() => [{ status: 'NEW' }]);

  const fromStage = buyer?.status || 'NEW';

  await sql`
    UPDATE buyers
    SET status = ${toStage}, updated_at = NOW()
    WHERE id = ${buyerId}
  `;

  // Record transition
  await sql`
    INSERT INTO stage_transitions (
      id, lead_id, from_stage, to_stage, lead_type, metadata, created_at
    ) VALUES (
      ${crypto.randomUUID()},
      ${buyerId},
      ${fromStage},
      ${toStage},
      'buyer',
      ${JSON.stringify(metadata || {})},
      NOW()
    )
  `.catch(console.error);

  await logEvent('buyer_stage_transition', 'buyer', buyerId, {
    fromStage,
    toStage,
    ...metadata,
  }, organizationId);
}

// ─── RUN ALL BUYER PIPELINE CRONS ────────────────────────────────────────────

export async function runBuyerPipelineMaintenance(organizationId: string): Promise<{
  stalledReengaged: number;
  dormantReactivated: number;
}> {
  // Re-engage stalled buyers (48-168 hours)
  const stalledBuyers = await findStalledBuyers(organizationId, 48);
  let stalledReengaged = 0;
  for (const buyer of stalledBuyers.slice(0, 20)) {
    const result = await reengageStalledBuyer(buyer, organizationId);
    if (result.sent) stalledReengaged++;
  }

  // Reactivate dormant buyers (60-180 days)
  const { reactivated: dormantReactivated } = await reactivateDormantBuyers(organizationId);

  return { stalledReengaged, dormantReactivated };
}
