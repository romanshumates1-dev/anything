/**
 * Campaign Automation Engine - "Set and Forget" Campaign Operation
 *
 * Core automation loop that runs the entire outreach pipeline with minimal
 * user interaction. Designed for real estate wholesaling:
 * - New lead imported -> Auto-assign to active campaign -> Schedule first touch
 * - First touch sent -> Wait configured delay -> Send follow-up
 * - Response received -> AI categorize -> Route appropriately
 * - Interested -> Move to negotiation pipeline
 * - Counter-offer -> Route to negotiation engine
 * - Not interested -> Mark cold, stop outreach
 * - No response after X touches -> Mark unresponsive
 */
import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { logEvent } from '@/app/api/utils/logger';
import { callAI } from '@/app/api/utils/ai-provider';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface CampaignSettings {
  // Targeting
  regions: Array<{ type: 'zip' | 'county' | 'state'; value: string }>;
  propertyTypes: string[];
  priceRange: { min: number; max: number }; // cents

  // Timing
  sendWindow: { start: string; end: string }; // "09:00", "17:00"
  sendDays: string[]; // ["mon", "tue", "wed", "thu", "fri"]
  touchDelays: number[]; // [0, 2, 5, 10] days between touches

  // Automation levels
  automationLevel: 'manual' | 'semi_auto' | 'full_auto';
  autoSendEnabled: boolean;
  autoNegotiateEnabled: boolean;
  autoContractEnabled: boolean;

  // Thresholds
  humanReviewThreshold: number; // cents - escalate deals over this
  maxAutoCounters: number; // max AI counter-offers before escalate
  responseTimeoutHours: number;
  maxTouches: number;

  // AI settings
  aiTone: 'professional' | 'casual' | 'urgent' | 'empathetic';
  aiPersonalizationLevel: 'low' | 'medium' | 'high';
  abTestingEnabled: boolean;
}

export interface AutomationState {
  currentTouch: number;
  nextTouchScheduledAt: Date | null;
  lastTouchAt: Date | null;
  lastResponseAt: Date | null;
  responseClassification: string | null;
  interestScore: number | null;
  negotiationStage: string | null;
  counterOfferCount: number;
  routedToNegotiation: boolean;
  routedToHuman: boolean;
  humanEscalationReason: string | null;
  outcome: string | null;
}

export interface ResponseClassification {
  classification: 'interested' | 'not_interested' | 'counter_offer' | 'question' | 'objection' | 'spam' | 'opt_out';
  confidence: number;
  extractedPrice?: number; // cents
  extractedTimeline?: 'immediate' | 'soon' | 'later' | 'unknown';
  extractedObjections?: string[];
  suggestedAction: string;
}

export interface CampaignMetrics {
  leadsProcessed: number;
  messagesSent: number;
  responsesReceived: number;
  responseRate: number;
  interestedCount: number;
  notInterestedCount: number;
  counterOfferCount: number;
  noResponseCount: number;
  negotiationsStarted: number;
  contractsSent: number;
  contractsSigned: number;
  humanEscalations: number;
  avgResponseTimeHours: number;
  avgTouchesToResponse: number;
}

export interface HumanAttentionItem {
  type: 'escalation' | 'high_value_deal' | 'complex_negotiation' | 'stuck_lead';
  contactId: string;
  campaignId: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  context: Record<string, any>;
  createdAt: Date;
}

// ============================================================================
// Campaign Engine Core
// ============================================================================

/**
 * Process new leads - runs hourly via job queue
 * Assigns leads to active campaigns based on targeting criteria
 */
export async function processNewLeads(campaignId: string): Promise<{
  processed: number;
  assigned: number;
  skipped: number;
  reason?: string;
}> {
  if (!(await isBetaFlagOn('campaignAutomation'))) {
    return { processed: 0, assigned: 0, skipped: 0, reason: 'flag_off' };
  }

  const [campaign] = await sql`
    SELECT oc.*, cs.*
    FROM outreach_campaigns oc
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE oc.id = ${campaignId}
      AND oc.status = 'ACTIVE'
      AND oc.automation_enabled = true
  `;

  if (!campaign) {
    return { processed: 0, assigned: 0, skipped: 0, reason: 'campaign_not_active' };
  }

  const settings = parseCampaignSettings(campaign);

  // Find unassigned leads that match campaign targeting
  const leads = await sql`
    SELECT l.*
    FROM leads l
    WHERE l.type = ${campaign.direction === 'SELLER' ? 'seller' : 'buyer'}
      AND NOT EXISTS (
        SELECT 1 FROM campaign_contacts cc
        WHERE cc.seller_lead_id = l.id::text OR cc.buyer_lead_id = l.id::text
      )
      AND l.status NOT IN ('contacted', 'negotiating', 'closed', 'lost')
    ORDER BY l.created_at ASC
    LIMIT 100
  `;

  let assigned = 0;
  let skipped = 0;

  for (const lead of leads) {
    // Check regional targeting
    if (!matchesRegionalTargeting(lead, settings)) {
      skipped++;
      continue;
    }

    // Check property type targeting
    if (!matchesPropertyType(lead, settings)) {
      skipped++;
      continue;
    }

    // Check price range targeting
    if (!matchesPriceRange(lead, settings)) {
      skipped++;
      continue;
    }

    // Assign to campaign
    const contactId = crypto.randomUUID();
    const stateId = crypto.randomUUID();

    await sql.transaction([
      sql`
        INSERT INTO campaign_contacts (
          id, campaign_id, organization_id, name, phone, email,
          property_address, property_type, estimated_value, region,
          status, ${campaign.direction === 'SELLER' ? sql`seller_lead_id` : sql`buyer_lead_id`}
        )
        VALUES (
          ${contactId}, ${campaignId}, ${campaign.organization_id},
          ${lead.name || 'Unknown'}, ${lead.phone || ''},
          ${lead.email || null},
          ${lead.metadata?.address || null},
          ${lead.metadata?.property_type || null},
          ${lead.metadata?.estimated_value || null},
          ${JSON.stringify({ zip: lead.metadata?.zip, county: lead.metadata?.county, state: lead.metadata?.state })},
          'QUEUED', ${lead.id.toString()}
        )
      `,
      sql`
        INSERT INTO campaign_automation_state (
          id, campaign_id, contact_id, organization_id,
          current_touch, next_touch_scheduled_at
        )
        VALUES (
          ${stateId}, ${campaignId}, ${contactId}, ${campaign.organization_id},
          0, ${new Date(Date.now() + (settings.touchDelays[0] || 0) * 24 * 3600_000)}
        )
      `,
    ]);

    // Schedule first touch if auto-send enabled
    if (settings.autoSendEnabled) {
      // First touch is scheduled via the automation state's next_touch_scheduled_at
      // which is already set above. The scheduleOutreach job will pick it up.
      await enqueueJob(
        'campaign_send_scheduled',
        { campaignId, organizationId: campaign.organization_id },
        { dedupeKey: `campaign_first_touch:${contactId}` }
      );
    }

    assigned++;
  }

  await logEvent('campaign_process_leads', 'campaign', campaignId, {
    processed: leads.length,
    assigned,
    skipped,
  }, campaign.organization_id);

  return { processed: leads.length, assigned, skipped };
}

/**
 * Schedule outreach - runs every 5 minutes via job queue
 * Sends due messages based on campaign schedule
 */
export async function scheduleOutreach(campaignId: string): Promise<{
  scheduled: number;
  skipped: number;
  reason?: string;
}> {
  if (!(await isBetaFlagOn('campaignAutomation'))) {
    return { scheduled: 0, skipped: 0, reason: 'flag_off' };
  }

  const [campaign] = await sql`
    SELECT oc.*, cs.*
    FROM outreach_campaigns oc
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE oc.id = ${campaignId}
      AND oc.status = 'ACTIVE'
      AND oc.automation_enabled = true
  `;

  if (!campaign) {
    return { scheduled: 0, skipped: 0, reason: 'campaign_not_active' };
  }

  const settings = parseCampaignSettings(campaign);

  // Check if within send window
  if (!isWithinSendWindow(settings)) {
    return { scheduled: 0, skipped: 0, reason: 'outside_send_window' };
  }

  // Check if today is a send day
  if (!isSendDay(settings)) {
    return { scheduled: 0, skipped: 0, reason: 'not_send_day' };
  }

  // Get contacts due for outreach
  const dueContacts = await sql`
    SELECT cas.*, cc.phone, cc.email, cc.name, cc.property_address
    FROM campaign_automation_state cas
    JOIN campaign_contacts cc ON cc.id = cas.contact_id
    WHERE cas.campaign_id = ${campaignId}
      AND cas.next_touch_scheduled_at <= NOW()
      AND cas.outcome IS NULL
      AND cc.status NOT IN ('OPTED_OUT', 'COLD', 'INVALID_NUMBER')
      AND cc.opted_out_at IS NULL
    ORDER BY cas.next_touch_scheduled_at ASC
    LIMIT 50
  `;

  let scheduled = 0;
  let skipped = 0;

  for (const contact of dueContacts) {
    // Skip if max touches reached
    if (contact.current_touch >= settings.maxTouches) {
      await markUnresponsive(contact.contact_id, campaignId);
      skipped++;
      continue;
    }

    // Get the appropriate template for this touch
    const touchNumber = contact.current_touch + 1;
    const template = await getTemplateForTouch(campaignId, touchNumber);

    if (!template) {
      skipped++;
      continue;
    }

    // Generate personalized message
    const message = await generatePersonalizedMessage(template, {
      name: contact.name || 'Unknown',
      property_address: contact.property_address,
      current_touch: contact.current_touch || 0,
    }, settings);

    // Enqueue the send
    await enqueueJob(
      'send_message',
      {
        leadId: contact.seller_lead_id || contact.buyer_lead_id,
        to: contact.phone,
        text: message,
        campaignId,
        organizationId: campaign.organization_id,
        contactId: contact.contact_id,
        channel: 'sms',
        isOpening: touchNumber === 1,
      },
      { dedupeKey: `campaign_touch:${contact.contact_id}:${touchNumber}` }
    );

    // Update automation state
    const nextTouchDelay = settings.touchDelays[touchNumber] || settings.touchDelays[settings.touchDelays.length - 1] || 7;
    await sql`
      UPDATE campaign_automation_state
      SET current_touch = ${touchNumber},
          last_touch_at = NOW(),
          next_touch_scheduled_at = ${new Date(Date.now() + nextTouchDelay * 24 * 3600_000)},
          updated_at = NOW()
      WHERE contact_id = ${contact.contact_id}
    `;

    scheduled++;
  }

  // Update campaign last automation run
  await sql`
    UPDATE outreach_campaigns
    SET last_automation_run = NOW()
    WHERE id = ${campaignId}
  `;

  await logEvent('campaign_schedule_outreach', 'campaign', campaignId, {
    scheduled,
    skipped,
  }, campaign.organization_id);

  return { scheduled, skipped };
}

/**
 * Handle inbound response - triggered on webhook
 * AI categorizes the response and routes appropriately
 */
export async function handleInboundResponse(
  messageId: string,
  contactId: string,
  responseText: string
): Promise<{
  handled: boolean;
  classification?: ResponseClassification;
  action?: string;
  reason?: string;
}> {
  if (!(await isBetaFlagOn('campaignAutomation'))) {
    return { handled: false, reason: 'flag_off' };
  }

  // Get contact and campaign info
  const [contact] = await sql`
    SELECT cc.*, cas.*, oc.organization_id, cs.*
    FROM campaign_contacts cc
    JOIN campaign_automation_state cas ON cas.contact_id = cc.id
    JOIN outreach_campaigns oc ON oc.id = cc.campaign_id
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE cc.id = ${contactId}
  `;

  if (!contact) {
    return { handled: false, reason: 'contact_not_found' };
  }

  const settings = parseCampaignSettings(contact);

  // AI classify the response
  const classification = await classifyResponse(responseText, {
    name: contact.name || 'Unknown',
    property_address: contact.property_address,
    current_touch: contact.current_touch || 0,
  });

  // Store classification
  const classId = crypto.randomUUID();
  await sql`
    INSERT INTO response_classifications (
      id, contact_id, message_id, organization_id,
      classification, confidence,
      extracted_price, extracted_timeline, extracted_objections,
      model_used, raw_response
    )
    VALUES (
      ${classId}, ${contactId}, ${messageId}, ${contact.organization_id},
      ${classification.classification}, ${classification.confidence},
      ${classification.extractedPrice || null},
      ${classification.extractedTimeline || null},
      ${classification.extractedObjections || null},
      'bedrock-haiku',
      ${JSON.stringify(classification)}
    )
  `;

  // Update automation state
  await sql`
    UPDATE campaign_automation_state
    SET last_response_at = NOW(),
        response_classification = ${classification.classification},
        interest_score = ${classification.confidence},
        updated_at = NOW()
    WHERE contact_id = ${contactId}
  `;

  // Route based on classification
  let action = 'none';

  switch (classification.classification) {
    case 'interested':
      action = await routeToNegotiation(contactId, contact.campaign_id, contact.organization_id);
      break;

    case 'counter_offer':
      action = await handleCounterOffer(contactId, contact.campaign_id, contact.organization_id, classification, settings);
      break;

    case 'not_interested':
      action = await markCold(contactId, contact.campaign_id, 'not_interested');
      break;

    case 'opt_out':
      action = await handleOptOut(contactId, contact.campaign_id);
      break;

    case 'question':
    case 'objection':
      // Queue AI response if auto-negotiate enabled, else escalate
      if (settings.autoNegotiateEnabled) {
        action = await queueAIResponse(contactId, contact.campaign_id, classification);
      } else {
        action = await escalateToHuman(contactId, contact.campaign_id, contact.organization_id, `${classification.classification}_needs_review`);
      }
      break;

    case 'spam':
      // Ignore spam, don't count as response
      action = 'ignored_spam';
      break;
  }

  // Cancel pending follow-ups if responded
  if (classification.classification !== 'spam') {
    await cancelPendingTouches(contactId);
  }

  await logEvent('campaign_handle_response', 'campaign_contact', contactId, {
    classification: classification.classification,
    confidence: classification.confidence,
    action,
  }, contact.organization_id);

  return { handled: true, classification, action };
}

/**
 * Process follow-ups - runs daily via job queue
 * Schedules follow-up touches for contacts that haven't responded
 */
export async function processFollowUps(campaignId: string): Promise<{
  processed: number;
  scheduled: number;
  markedUnresponsive: number;
}> {
  if (!(await isBetaFlagOn('campaignAutomation'))) {
    return { processed: 0, scheduled: 0, markedUnresponsive: 0 };
  }

  const [campaign] = await sql`
    SELECT oc.*, cs.*
    FROM outreach_campaigns oc
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE oc.id = ${campaignId}
      AND oc.status = 'ACTIVE'
      AND oc.automation_enabled = true
  `;

  if (!campaign) {
    return { processed: 0, scheduled: 0, markedUnresponsive: 0 };
  }

  const settings = parseCampaignSettings(campaign);

  // Get contacts that need follow-up
  const contacts = await sql`
    SELECT cas.*, cc.*
    FROM campaign_automation_state cas
    JOIN campaign_contacts cc ON cc.id = cas.contact_id
    WHERE cas.campaign_id = ${campaignId}
      AND cas.outcome IS NULL
      AND cas.last_response_at IS NULL
      AND cas.last_touch_at < NOW() - INTERVAL '1 day' * ${settings.touchDelays[1] || 2}
      AND cc.status NOT IN ('OPTED_OUT', 'COLD')
    ORDER BY cas.last_touch_at ASC
    LIMIT 100
  `;

  let processed = 0;
  let scheduled = 0;
  let markedUnresponsive = 0;

  for (const contact of contacts) {
    processed++;

    // Check response timeout
    const hoursSinceLastTouch = (Date.now() - new Date(contact.last_touch_at).getTime()) / 3600_000;

    // Check if max touches reached
    if (contact.current_touch >= settings.maxTouches) {
      await markUnresponsive(contact.contact_id, campaignId);
      markedUnresponsive++;
      continue;
    }

    // Check timeout - mark unresponsive after X hours with no response
    if (hoursSinceLastTouch > settings.responseTimeoutHours && contact.current_touch >= 2) {
      await markUnresponsive(contact.contact_id, campaignId);
      markedUnresponsive++;
      continue;
    }

    // Schedule next touch
    const nextTouch = contact.current_touch + 1;
    const delay = settings.touchDelays[nextTouch - 1] || 7;
    const scheduledAt = new Date(Date.now() + delay * 24 * 3600_000);

    await sql`
      UPDATE campaign_automation_state
      SET next_touch_scheduled_at = ${scheduledAt},
          updated_at = NOW()
      WHERE contact_id = ${contact.contact_id}
    `;

    scheduled++;
  }

  await logEvent('campaign_process_followups', 'campaign', campaignId, {
    processed,
    scheduled,
    markedUnresponsive,
  }, campaign.organization_id);

  return { processed, scheduled, markedUnresponsive };
}

/**
 * Update lead statuses - runs periodically
 * Syncs automation state with campaign contact status
 */
export async function updateLeadStatuses(campaignId: string): Promise<{
  updated: number;
}> {
  const updates = await sql`
    UPDATE campaign_contacts cc
    SET status = CASE
      WHEN cas.routed_to_negotiation THEN 'NEGOTIATING'::contact_status
      WHEN cas.outcome = 'contract' THEN 'CONTRACT_SIGNED'::contact_status
      WHEN cas.outcome = 'no_deal' THEN 'DEAL_NO_AGREEMENT'::contact_status
      WHEN cas.outcome = 'unresponsive' THEN 'COLD'::contact_status
      WHEN cas.outcome = 'opted_out' THEN 'OPTED_OUT'::contact_status
      WHEN cas.response_classification = 'interested' THEN 'ENGAGED'::contact_status
      WHEN cas.current_touch > 0 AND cas.last_response_at IS NULL THEN 'FOLLOWED_UP'::contact_status
      WHEN cas.current_touch > 0 THEN 'SENT'::contact_status
      ELSE 'QUEUED'::contact_status
    END,
    updated_at = NOW()
    FROM campaign_automation_state cas
    WHERE cc.id = cas.contact_id
      AND cc.campaign_id = ${campaignId}
      AND cas.updated_at > cc.updated_at
    RETURNING cc.id
  `;

  return { updated: updates.length };
}

// ============================================================================
// AI Response Classification
// ============================================================================

const CLASSIFICATION_PROMPT = `You are an AI assistant helping classify responses from real estate leads.
Analyze the following message and classify it into one of these categories:

Categories:
- interested: Lead shows interest in selling/buying, wants more info, asks about process
- not_interested: Clear rejection, says no, not selling, go away
- counter_offer: Mentions a specific price or makes a counter-proposal
- question: Asks questions about the offer, process, timeline, etc.
- objection: Raises concerns or objections (price too low, bad timing, etc.)
- opt_out: Requests to stop messages (STOP, unsubscribe, remove me)
- spam: Irrelevant, automated, or unclear response

Also extract:
- Any mentioned price (in dollars)
- Timeline preference (immediate, soon, later, unknown)
- Specific objections if any

Respond in JSON format:
{
  "classification": "interested|not_interested|counter_offer|question|objection|opt_out|spam",
  "confidence": 0.0-1.0,
  "extractedPrice": null or number,
  "extractedTimeline": "immediate|soon|later|unknown",
  "extractedObjections": [],
  "suggestedAction": "brief suggestion for next step"
}

Lead Context:
- Name: {{name}}
- Property: {{propertyAddress}}
- Previous touches: {{touchCount}}

Message to classify:
{{message}}`;

async function classifyResponse(
  message: string,
  contact: { name: string; property_address?: string; current_touch: number }
): Promise<ResponseClassification> {
  try {
    // Check for explicit opt-out keywords first (fast path)
    const optOutKeywords = /\b(stop|unsubscribe|remove|opt.?out|do not contact|leave me alone)\b/i;
    if (optOutKeywords.test(message)) {
      return {
        classification: 'opt_out',
        confidence: 1.0,
        extractedTimeline: 'unknown',
        suggestedAction: 'Immediately stop all outreach',
      };
    }

    // Use AI for nuanced classification
    const prompt = CLASSIFICATION_PROMPT
      .replace('{{name}}', contact.name || 'Unknown')
      .replace('{{propertyAddress}}', contact.property_address || 'Unknown')
      .replace('{{touchCount}}', String(contact.current_touch || 0))
      .replace('{{message}}', message);

    const result = await callAI({
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a real estate lead classification expert. Always respond with valid JSON.',
      json: true,
    });

    const cleaned = result.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      classification: parsed.classification || 'question',
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      extractedPrice: parsed.extractedPrice ? Math.round(parsed.extractedPrice * 100) : undefined,
      extractedTimeline: parsed.extractedTimeline || 'unknown',
      extractedObjections: parsed.extractedObjections || [],
      suggestedAction: parsed.suggestedAction || 'Review manually',
    };
  } catch (error) {
    console.error('Classification error:', error);
    // Default to question on error - safest fallback
    return {
      classification: 'question',
      confidence: 0.3,
      extractedTimeline: 'unknown',
      suggestedAction: 'AI classification failed - review manually',
    };
  }
}

// ============================================================================
// Message Generation
// ============================================================================

const MESSAGE_GENERATION_PROMPT = `Generate a personalized outreach message for a real estate wholesaler.

Context:
- Recipient: {{name}}
- Property: {{propertyAddress}}
- Touch #: {{touchNumber}} of {{maxTouches}}
- Tone: {{tone}}
- Template base: {{template}}

Personalization level: {{personalizationLevel}}

Rules:
- Keep under 160 characters for SMS
- Be respectful and professional
- Don't be pushy
- Include a clear call-to-action
- Use the template as a base but personalize based on context

Variables available: {{firstName}}, {{propertyAddress}}, {{city}}, {{offerPrice}}

Return ONLY the message text, no explanation.`;

async function generatePersonalizedMessage(
  template: string,
  contact: { name: string; property_address?: string; current_touch: number },
  settings: CampaignSettings
): Promise<string> {
  // Simple variable substitution for low personalization
  if (settings.aiPersonalizationLevel === 'low') {
    return substituteVariables(template, contact);
  }

  // AI personalization for medium/high
  try {
    const prompt = MESSAGE_GENERATION_PROMPT
      .replace('{{name}}', contact.name || 'there')
      .replace('{{propertyAddress}}', contact.property_address || 'your property')
      .replace('{{touchNumber}}', String(contact.current_touch + 1))
      .replace('{{maxTouches}}', String(settings.maxTouches))
      .replace('{{tone}}', settings.aiTone)
      .replace('{{template}}', template)
      .replace('{{personalizationLevel}}', settings.aiPersonalizationLevel);

    const result = await callAI({
      messages: [{ role: 'user', content: prompt }],
      system: 'You are a real estate copywriter. Generate concise, effective outreach messages.',
    });

    // Ensure message stays under SMS limit
    let message = result.text.trim();
    if (message.length > 160) {
      message = message.substring(0, 157) + '...';
    }

    return message;
  } catch (error) {
    console.error('Message generation error:', error);
    return substituteVariables(template, contact);
  }
}

function substituteVariables(
  template: string,
  contact: { name: string; property_address?: string }
): string {
  const firstName = (contact.name || '').split(' ')[0] || 'there';
  return template
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{propertyAddress\}\}/g, contact.property_address || 'your property')
    .replace(/\{\{name\}\}/g, contact.name || 'there');
}

// ============================================================================
// Routing Helpers
// ============================================================================

async function routeToNegotiation(
  contactId: string,
  campaignId: string,
  organizationId: string
): Promise<string> {
  await sql`
    UPDATE campaign_automation_state
    SET routed_to_negotiation = true,
        negotiation_stage = 'initial',
        updated_at = NOW()
    WHERE contact_id = ${contactId}
  `;

  await sql`
    UPDATE campaign_contacts
    SET status = 'NEGOTIATING',
        updated_at = NOW()
    WHERE id = ${contactId}
  `;

  await logEvent('campaign_route_negotiation', 'campaign_contact', contactId, {
    campaignId,
  }, organizationId);

  return 'routed_to_negotiation';
}

async function handleCounterOffer(
  contactId: string,
  campaignId: string,
  organizationId: string,
  classification: ResponseClassification,
  settings: CampaignSettings
): Promise<string> {
  // Get current state
  const [state] = await sql`
    SELECT * FROM campaign_automation_state WHERE contact_id = ${contactId}
  `;

  // Check if we should escalate
  const shouldEscalate =
    (classification.extractedPrice && classification.extractedPrice > settings.humanReviewThreshold) ||
    (state?.counter_offer_count || 0) >= settings.maxAutoCounters ||
    !settings.autoNegotiateEnabled;

  if (shouldEscalate) {
    return escalateToHuman(contactId, campaignId, organizationId, 'counter_offer_threshold');
  }

  // Update state and route to negotiation
  await sql`
    UPDATE campaign_automation_state
    SET routed_to_negotiation = true,
        negotiation_stage = 'countering',
        counter_offer_count = counter_offer_count + 1,
        updated_at = NOW()
    WHERE contact_id = ${contactId}
  `;

  await sql`
    UPDATE campaign_contacts
    SET status = 'NEGOTIATING',
        updated_at = NOW()
    WHERE id = ${contactId}
  `;

  // Queue AI counter-response if enabled
  if (settings.autoNegotiateEnabled) {
    await queueAIResponse(contactId, campaignId, classification);
  }

  return 'routed_to_negotiation_with_counter';
}

async function markCold(
  contactId: string,
  campaignId: string,
  reason: string
): Promise<string> {
  await sql`
    UPDATE campaign_automation_state
    SET outcome = 'no_deal',
        outcome_at = NOW(),
        updated_at = NOW()
    WHERE contact_id = ${contactId}
  `;

  await sql`
    UPDATE campaign_contacts
    SET status = 'COLD',
        updated_at = NOW()
    WHERE id = ${contactId}
  `;

  await cancelPendingTouches(contactId);

  return `marked_cold:${reason}`;
}

async function markUnresponsive(
  contactId: string,
  campaignId: string
): Promise<string> {
  await sql`
    UPDATE campaign_automation_state
    SET outcome = 'unresponsive',
        outcome_at = NOW(),
        updated_at = NOW()
    WHERE contact_id = ${contactId}
  `;

  await sql`
    UPDATE campaign_contacts
    SET status = 'COLD',
        updated_at = NOW()
    WHERE id = ${contactId}
  `;

  await cancelPendingTouches(contactId);

  return 'marked_unresponsive';
}

async function handleOptOut(contactId: string, campaignId: string): Promise<string> {
  await sql`
    UPDATE campaign_automation_state
    SET outcome = 'opted_out',
        outcome_at = NOW(),
        updated_at = NOW()
    WHERE contact_id = ${contactId}
  `;

  await sql`
    UPDATE campaign_contacts
    SET status = 'OPTED_OUT',
        opted_out_at = NOW(),
        updated_at = NOW()
    WHERE id = ${contactId}
  `;

  // Get phone to add to compliance records
  const [contact] = await sql`
    SELECT phone FROM campaign_contacts WHERE id = ${contactId}
  `;

  if (contact?.phone) {
    await sql`
      INSERT INTO compliance_records (target, type, channel, metadata)
      VALUES (${contact.phone}, 'opt-out', 'sms', '{"source": "campaign_response"}'::jsonb)
      ON CONFLICT (target, channel, type) DO NOTHING
    `;
  }

  await cancelPendingTouches(contactId);

  return 'opted_out';
}

async function escalateToHuman(
  contactId: string,
  campaignId: string,
  organizationId: string,
  reason: string
): Promise<string> {
  await sql`
    UPDATE campaign_automation_state
    SET routed_to_human = true,
        human_escalation_reason = ${reason},
        updated_at = NOW()
    WHERE contact_id = ${contactId}
  `;

  await logEvent('campaign_escalate_human', 'campaign_contact', contactId, {
    campaignId,
    reason,
  }, organizationId);

  return `escalated:${reason}`;
}

async function queueAIResponse(
  contactId: string,
  campaignId: string,
  classification: ResponseClassification
): Promise<string> {
  // Get the lead ID for the ai_reply job
  const [contact] = await sql`
    SELECT seller_lead_id, buyer_lead_id, campaign_id
    FROM campaign_contacts
    WHERE id = ${contactId}
  `;

  const leadId = contact?.seller_lead_id || contact?.buyer_lead_id;

  if (leadId) {
    await enqueueJob('ai_reply', {
      leadId: parseInt(leadId, 10),
      contactId,
      campaignId,
      classification: classification.classification,
    });
  }

  return 'ai_response_queued';
}

async function cancelPendingTouches(contactId: string): Promise<void> {
  await sql`
    UPDATE jobs
    SET status = 'cancelled', updated_at = NOW()
    WHERE type = 'send_message'
      AND status IN ('pending', 'failed')
      AND payload->>'contactId' = ${contactId}
  `;
}

// ============================================================================
// Template & Settings Helpers
// ============================================================================

async function getTemplateForTouch(campaignId: string, touchNumber: number): Promise<string | null> {
  const kind = touchNumber === 1 ? 'OPENING' : 'FOLLOW_UP';
  const sequenceOrder = touchNumber === 1 ? 0 : touchNumber - 1;

  const [template] = await sql`
    SELECT body FROM campaign_message_templates
    WHERE campaign_id = ${campaignId}
      AND kind = ${kind}
      AND sequence_order = ${sequenceOrder}
      AND is_active = true
    ORDER BY sequence_order ASC
    LIMIT 1
  `;

  return template?.body || null;
}

function parseCampaignSettings(campaign: Record<string, any>): CampaignSettings {
  return {
    regions: Array.isArray(campaign.target_regions) ? campaign.target_regions : [],
    propertyTypes: campaign.target_property_types || ['single_family', 'multi_family', 'condo'],
    priceRange: {
      min: campaign.target_price_min || 0,
      max: campaign.target_price_max || Infinity,
    },
    sendWindow: {
      start: campaign.send_window_start || '09:00',
      end: campaign.send_window_end || '17:00',
    },
    sendDays: campaign.send_days || ['mon', 'tue', 'wed', 'thu', 'fri'],
    touchDelays: campaign.touch_delays || [0, 2, 5, 10],
    automationLevel: campaign.automation_level || 'semi_auto',
    autoSendEnabled: campaign.auto_send_enabled ?? false,
    autoNegotiateEnabled: campaign.auto_negotiate_enabled ?? false,
    autoContractEnabled: campaign.auto_contract_enabled ?? false,
    humanReviewThreshold: campaign.human_review_threshold || 10000000, // $100k
    maxAutoCounters: campaign.max_auto_counters || 3,
    responseTimeoutHours: campaign.response_timeout_hours || 72,
    maxTouches: campaign.max_touches || 4,
    aiTone: campaign.ai_tone || 'professional',
    aiPersonalizationLevel: campaign.ai_personalization_level || 'high',
    abTestingEnabled: campaign.ab_testing_enabled ?? false,
  };
}

function isWithinSendWindow(settings: CampaignSettings): boolean {
  const now = new Date();
  const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"
  return currentTime >= settings.sendWindow.start && currentTime <= settings.sendWindow.end;
}

function isSendDay(settings: CampaignSettings): boolean {
  const now = new Date();
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = days[now.getDay()];
  return settings.sendDays.includes(today);
}

// ============================================================================
// Regional Targeting
// ============================================================================

interface RegionWithInclude {
  type: 'zip' | 'county' | 'state';
  value: string;
  include?: boolean;
}

/**
 * Check if a lead matches the regional targeting criteria.
 * Supports both include and exclude regions:
 * - If no regions: matches all leads
 * - If only include regions: lead must match at least one
 * - If only exclude regions: lead must not match any
 * - If both: lead must match at least one include AND not match any exclude
 */
function matchesRegionalTargeting(
  lead: { metadata?: { zip?: string; county?: string; state?: string }; zip?: string; county?: string; state?: string },
  settings: CampaignSettings
): boolean {
  if (settings.regions.length === 0) return true; // No targeting = all leads

  // Get lead location - support both direct fields and metadata
  const leadZip = lead.zip || lead.metadata?.zip;
  const leadCounty = (lead.county || lead.metadata?.county)?.toLowerCase();
  const leadState = (lead.state || lead.metadata?.state)?.toUpperCase();

  // Separate include and exclude regions
  const includeRegions = settings.regions.filter((r) => (r as RegionWithInclude).include !== false);
  const excludeRegions = settings.regions.filter((r) => (r as RegionWithInclude).include === false);

  // Helper to check if lead matches a region
  const matchesRegion = (region: { type: string; value: string }): boolean => {
    const regionType = region.type.toLowerCase();
    switch (regionType) {
      case 'zip':
        return leadZip === region.value;
      case 'county':
        // County can be stored as "STATE_County" or just "County"
        if (region.value.includes('_')) {
          const [state, county] = region.value.split('_');
          return leadState === state.toUpperCase() && leadCounty === county.toLowerCase();
        }
        return leadCounty === region.value.toLowerCase();
      case 'state':
        return leadState === region.value.toUpperCase();
      case 'city':
        // City matching requires state context
        return false; // TODO: implement city matching
      default:
        return false;
    }
  };

  // Check exclude regions first - if lead matches any exclude, reject
  if (excludeRegions.length > 0) {
    const matchesExclude = excludeRegions.some(matchesRegion);
    if (matchesExclude) return false;
  }

  // If no include regions, we only have excludes - if we got here, lead is valid
  if (includeRegions.length === 0) return true;

  // Check include regions - lead must match at least one
  return includeRegions.some(matchesRegion);
}

/**
 * Get leads that match regional targeting for a campaign.
 * Used for lead queries with dynamic filtering.
 */
export function buildRegionalFilter(
  regions: Array<{ type: string; value: string; include?: boolean }>
): {
  includeZips: string[];
  excludeZips: string[];
  includeStates: string[];
  excludeStates: string[];
  includeCounties: string[];
  excludeCounties: string[];
} {
  const includeZips: string[] = [];
  const excludeZips: string[] = [];
  const includeStates: string[] = [];
  const excludeStates: string[] = [];
  const includeCounties: string[] = [];
  const excludeCounties: string[] = [];

  for (const region of regions) {
    const isInclude = region.include !== false;
    const regionType = region.type.toLowerCase();

    switch (regionType) {
      case 'zip':
        if (isInclude) {
          includeZips.push(region.value);
        } else {
          excludeZips.push(region.value);
        }
        break;
      case 'state':
        if (isInclude) {
          includeStates.push(region.value.toUpperCase());
        } else {
          excludeStates.push(region.value.toUpperCase());
        }
        break;
      case 'county':
        if (isInclude) {
          includeCounties.push(region.value);
        } else {
          excludeCounties.push(region.value);
        }
        break;
    }
  }

  return {
    includeZips,
    excludeZips,
    includeStates,
    excludeStates,
    includeCounties,
    excludeCounties,
  };
}

function matchesPropertyType(
  lead: { metadata?: { property_type?: string } },
  settings: CampaignSettings
): boolean {
  if (settings.propertyTypes.length === 0) return true;
  const leadType = lead.metadata?.property_type?.toLowerCase() || '';
  return settings.propertyTypes.some((type) => leadType.includes(type.toLowerCase()));
}

function matchesPriceRange(
  lead: { metadata?: { estimated_value?: number } },
  settings: CampaignSettings
): boolean {
  const value = lead.metadata?.estimated_value || 0;
  return value >= settings.priceRange.min && value <= settings.priceRange.max;
}

// ============================================================================
// Dashboard & Metrics
// ============================================================================

/**
 * Get items needing human attention - for the dashboard
 */
export async function getHumanAttentionItems(organizationId: string): Promise<HumanAttentionItem[]> {
  const items: HumanAttentionItem[] = [];

  // Get human escalations
  const escalations = await sql`
    SELECT cas.*, cc.name, cc.property_address, cc.phone, oc.name as campaign_name
    FROM campaign_automation_state cas
    JOIN campaign_contacts cc ON cc.id = cas.contact_id
    JOIN outreach_campaigns oc ON oc.id = cas.campaign_id
    WHERE cas.organization_id = ${organizationId}
      AND cas.routed_to_human = true
      AND cas.outcome IS NULL
    ORDER BY cas.updated_at DESC
    LIMIT 20
  `;

  for (const esc of escalations) {
    items.push({
      type: 'escalation',
      contactId: esc.contact_id,
      campaignId: esc.campaign_id,
      reason: esc.human_escalation_reason || 'Needs review',
      priority: 'high',
      context: {
        name: esc.name,
        phone: esc.phone,
        propertyAddress: esc.property_address,
        campaignName: esc.campaign_name,
        classification: esc.response_classification,
      },
      createdAt: new Date(esc.updated_at),
    });
  }

  // Get high-value deals in negotiation
  const highValueDeals = await sql`
    SELECT cas.*, cc.name, cc.property_address, cc.estimated_value, oc.name as campaign_name
    FROM campaign_automation_state cas
    JOIN campaign_contacts cc ON cc.id = cas.contact_id
    JOIN outreach_campaigns oc ON oc.id = cas.campaign_id
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE cas.organization_id = ${organizationId}
      AND cas.routed_to_negotiation = true
      AND cas.outcome IS NULL
      AND cc.estimated_value > COALESCE(cs.human_review_threshold, 10000000)
    ORDER BY cc.estimated_value DESC
    LIMIT 10
  `;

  for (const deal of highValueDeals) {
    items.push({
      type: 'high_value_deal',
      contactId: deal.contact_id,
      campaignId: deal.campaign_id,
      reason: `High-value deal: $${Math.round((deal.estimated_value || 0) / 100).toLocaleString()}`,
      priority: 'high',
      context: {
        name: deal.name,
        propertyAddress: deal.property_address,
        estimatedValue: deal.estimated_value,
        campaignName: deal.campaign_name,
        negotiationStage: deal.negotiation_stage,
      },
      createdAt: new Date(deal.updated_at),
    });
  }

  // Get stuck leads (interested but no progress in 48h)
  const stuckLeads = await sql`
    SELECT cas.*, cc.name, cc.property_address, oc.name as campaign_name
    FROM campaign_automation_state cas
    JOIN campaign_contacts cc ON cc.id = cas.contact_id
    JOIN outreach_campaigns oc ON oc.id = cas.campaign_id
    WHERE cas.organization_id = ${organizationId}
      AND cas.response_classification = 'interested'
      AND cas.routed_to_negotiation = false
      AND cas.routed_to_human = false
      AND cas.outcome IS NULL
      AND cas.last_response_at < NOW() - INTERVAL '48 hours'
    ORDER BY cas.last_response_at ASC
    LIMIT 10
  `;

  for (const lead of stuckLeads) {
    items.push({
      type: 'stuck_lead',
      contactId: lead.contact_id,
      campaignId: lead.campaign_id,
      reason: 'Interested lead with no progress in 48h',
      priority: 'medium',
      context: {
        name: lead.name,
        propertyAddress: lead.property_address,
        campaignName: lead.campaign_name,
        lastResponse: lead.last_response_at,
      },
      createdAt: new Date(lead.last_response_at),
    });
  }

  return items.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Get campaign automation metrics - for the dashboard
 */
export async function getCampaignMetrics(campaignId: string): Promise<CampaignMetrics> {
  const [stats] = await sql`
    SELECT
      COUNT(*) as total_contacts,
      COUNT(*) FILTER (WHERE cas.current_touch > 0) as messages_sent,
      COUNT(*) FILTER (WHERE cas.last_response_at IS NOT NULL) as responses_received,
      COUNT(*) FILTER (WHERE cas.response_classification = 'interested') as interested_count,
      COUNT(*) FILTER (WHERE cas.response_classification = 'not_interested') as not_interested_count,
      COUNT(*) FILTER (WHERE cas.response_classification = 'counter_offer') as counter_offer_count,
      COUNT(*) FILTER (WHERE cas.current_touch > 0 AND cas.last_response_at IS NULL) as no_response_count,
      COUNT(*) FILTER (WHERE cas.routed_to_negotiation = true) as negotiations_started,
      COUNT(*) FILTER (WHERE cas.outcome = 'contract') as contracts_signed,
      COUNT(*) FILTER (WHERE cas.routed_to_human = true) as human_escalations,
      AVG(EXTRACT(EPOCH FROM (cas.last_response_at - cas.last_touch_at)) / 3600)
        FILTER (WHERE cas.last_response_at IS NOT NULL) as avg_response_time_hours,
      AVG(cas.current_touch) FILTER (WHERE cas.last_response_at IS NOT NULL) as avg_touches_to_response
    FROM campaign_automation_state cas
    WHERE cas.campaign_id = ${campaignId}
  `;

  const totalContacts = Number(stats.total_contacts) || 0;
  const responsesReceived = Number(stats.responses_received) || 0;

  return {
    leadsProcessed: totalContacts,
    messagesSent: Number(stats.messages_sent) || 0,
    responsesReceived,
    responseRate: totalContacts > 0 ? responsesReceived / totalContacts : 0,
    interestedCount: Number(stats.interested_count) || 0,
    notInterestedCount: Number(stats.not_interested_count) || 0,
    counterOfferCount: Number(stats.counter_offer_count) || 0,
    noResponseCount: Number(stats.no_response_count) || 0,
    negotiationsStarted: Number(stats.negotiations_started) || 0,
    contractsSent: 0, // Would need contracts table join
    contractsSigned: Number(stats.contracts_signed) || 0,
    humanEscalations: Number(stats.human_escalations) || 0,
    avgResponseTimeHours: Number(stats.avg_response_time_hours) || 0,
    avgTouchesToResponse: Number(stats.avg_touches_to_response) || 0,
  };
}

/**
 * Get real-time campaign status - for the dashboard
 */
export async function getCampaignStatus(campaignId: string): Promise<{
  status: string;
  isRunning: boolean;
  lastRun: Date | null;
  nextScheduledRun: Date | null;
  contactsByStage: Record<string, number>;
  warnings: string[];
}> {
  const [campaign] = await sql`
    SELECT oc.*, cs.*
    FROM outreach_campaigns oc
    LEFT JOIN campaign_settings cs ON cs.campaign_id = oc.id
    WHERE oc.id = ${campaignId}
  `;

  if (!campaign) {
    return {
      status: 'not_found',
      isRunning: false,
      lastRun: null,
      nextScheduledRun: null,
      contactsByStage: {},
      warnings: ['Campaign not found'],
    };
  }

  // Get contacts by stage
  const stages = await sql`
    SELECT cc.status, COUNT(*) as count
    FROM campaign_contacts cc
    WHERE cc.campaign_id = ${campaignId}
    GROUP BY cc.status
  `;

  const contactsByStage: Record<string, number> = {};
  for (const stage of stages) {
    contactsByStage[stage.status] = Number(stage.count);
  }

  // Check for warnings
  const warnings: string[] = [];

  if (campaign.status === 'PAUSED') {
    warnings.push(`Campaign paused: ${campaign.automation_paused_reason || 'No reason specified'}`);
  }

  if (!campaign.automation_enabled) {
    warnings.push('Automation is disabled for this campaign');
  }

  const settings = parseCampaignSettings(campaign);
  if (!isWithinSendWindow(settings)) {
    warnings.push('Currently outside send window');
  }

  if (!isSendDay(settings)) {
    warnings.push('Today is not a configured send day');
  }

  return {
    status: campaign.status,
    isRunning: campaign.status === 'ACTIVE' && campaign.automation_enabled,
    lastRun: campaign.last_automation_run ? new Date(campaign.last_automation_run) : null,
    nextScheduledRun: null, // Would need job query
    contactsByStage,
    warnings,
  };
}

// ============================================================================
// Campaign Settings Management
// ============================================================================

/**
 * Save campaign settings
 */
export async function saveCampaignSettings(
  campaignId: string,
  organizationId: string,
  settings: Partial<CampaignSettings>
): Promise<{ success: boolean; error?: string }> {
  try {
    const settingsId = crypto.randomUUID();

    await sql`
      INSERT INTO campaign_settings (
        id, campaign_id, organization_id,
        target_regions, target_property_types, target_price_min, target_price_max,
        send_window_start, send_window_end, send_days, touch_delays,
        automation_level, auto_send_enabled, auto_negotiate_enabled, auto_contract_enabled,
        human_review_threshold, max_auto_counters, response_timeout_hours, max_touches,
        ai_tone, ai_personalization_level, ab_testing_enabled
      )
      VALUES (
        ${settingsId}, ${campaignId}, ${organizationId},
        ${JSON.stringify(settings.regions || [])},
        ${settings.propertyTypes || ['single_family', 'multi_family', 'condo']},
        ${settings.priceRange?.min || null},
        ${settings.priceRange?.max || null},
        ${settings.sendWindow?.start || '09:00'},
        ${settings.sendWindow?.end || '17:00'},
        ${settings.sendDays || ['mon', 'tue', 'wed', 'thu', 'fri']},
        ${settings.touchDelays || [0, 2, 5, 10]},
        ${settings.automationLevel || 'semi_auto'},
        ${settings.autoSendEnabled ?? false},
        ${settings.autoNegotiateEnabled ?? false},
        ${settings.autoContractEnabled ?? false},
        ${settings.humanReviewThreshold || 10000000},
        ${settings.maxAutoCounters || 3},
        ${settings.responseTimeoutHours || 72},
        ${settings.maxTouches || 4},
        ${settings.aiTone || 'professional'},
        ${settings.aiPersonalizationLevel || 'high'},
        ${settings.abTestingEnabled ?? false}
      )
      ON CONFLICT (campaign_id) DO UPDATE SET
        target_regions = EXCLUDED.target_regions,
        target_property_types = EXCLUDED.target_property_types,
        target_price_min = EXCLUDED.target_price_min,
        target_price_max = EXCLUDED.target_price_max,
        send_window_start = EXCLUDED.send_window_start,
        send_window_end = EXCLUDED.send_window_end,
        send_days = EXCLUDED.send_days,
        touch_delays = EXCLUDED.touch_delays,
        automation_level = EXCLUDED.automation_level,
        auto_send_enabled = EXCLUDED.auto_send_enabled,
        auto_negotiate_enabled = EXCLUDED.auto_negotiate_enabled,
        auto_contract_enabled = EXCLUDED.auto_contract_enabled,
        human_review_threshold = EXCLUDED.human_review_threshold,
        max_auto_counters = EXCLUDED.max_auto_counters,
        response_timeout_hours = EXCLUDED.response_timeout_hours,
        max_touches = EXCLUDED.max_touches,
        ai_tone = EXCLUDED.ai_tone,
        ai_personalization_level = EXCLUDED.ai_personalization_level,
        ab_testing_enabled = EXCLUDED.ab_testing_enabled,
        updated_at = NOW()
    `;

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Enable automation for a campaign
 */
export async function enableCampaignAutomation(
  campaignId: string,
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify campaign exists and belongs to org
    const [campaign] = await sql`
      SELECT id FROM outreach_campaigns
      WHERE id = ${campaignId} AND organization_id = ${organizationId}
    `;

    if (!campaign) {
      return { success: false, error: 'Campaign not found' };
    }

    // Enable automation
    await sql`
      UPDATE outreach_campaigns
      SET automation_enabled = true,
          automation_paused_reason = NULL,
          updated_at = NOW()
      WHERE id = ${campaignId}
    `;

    await logEvent('campaign_automation_enabled', 'campaign', campaignId, {}, organizationId);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Disable automation for a campaign
 */
export async function disableCampaignAutomation(
  campaignId: string,
  organizationId: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await sql`
      UPDATE outreach_campaigns
      SET automation_enabled = false,
          automation_paused_reason = ${reason || null},
          updated_at = NOW()
      WHERE id = ${campaignId} AND organization_id = ${organizationId}
    `;

    await logEvent('campaign_automation_disabled', 'campaign', campaignId, { reason }, organizationId);

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Scheduled Job Entry Points (called by job worker)
// ============================================================================

/**
 * Job: campaign_process_leads - runs hourly
 */
export async function runProcessLeadsJob(campaignId: string): Promise<void> {
  const result = await processNewLeads(campaignId);
  console.log(`[campaign_process_leads] Campaign ${campaignId}: ${result.assigned} assigned, ${result.skipped} skipped`);
}

/**
 * Job: campaign_send_scheduled - runs every 5 minutes
 */
export async function runScheduledOutreachJob(campaignId: string): Promise<void> {
  const result = await scheduleOutreach(campaignId);
  console.log(`[campaign_send_scheduled] Campaign ${campaignId}: ${result.scheduled} scheduled, ${result.skipped} skipped`);
}

/**
 * Job: campaign_daily_followups - runs daily
 */
export async function runFollowUpJob(campaignId: string): Promise<void> {
  const result = await processFollowUps(campaignId);
  console.log(`[campaign_daily_followups] Campaign ${campaignId}: ${result.scheduled} scheduled, ${result.markedUnresponsive} unresponsive`);
}

/**
 * Job: campaign_update_statuses - runs periodically
 */
export async function runUpdateStatusesJob(campaignId: string): Promise<void> {
  const result = await updateLeadStatuses(campaignId);
  console.log(`[campaign_update_statuses] Campaign ${campaignId}: ${result.updated} updated`);
}

/**
 * Run all automation jobs for all active campaigns - master orchestrator
 */
export async function runAllCampaignAutomation(): Promise<{
  campaignsProcessed: number;
  totalAssigned: number;
  totalScheduled: number;
}> {
  const campaigns = await sql`
    SELECT id FROM outreach_campaigns
    WHERE status = 'ACTIVE' AND automation_enabled = true
  `;

  let totalAssigned = 0;
  let totalScheduled = 0;

  for (const campaign of campaigns) {
    try {
      const leadsResult = await processNewLeads(campaign.id);
      totalAssigned += leadsResult.assigned;

      const outreachResult = await scheduleOutreach(campaign.id);
      totalScheduled += outreachResult.scheduled;

      await updateLeadStatuses(campaign.id);
    } catch (error) {
      console.error(`Campaign automation error for ${campaign.id}:`, error);
    }
  }

  return {
    campaignsProcessed: campaigns.length,
    totalAssigned,
    totalScheduled,
  };
}
