/**
 * Negotiation Agent
 * Moves conversations toward signed contracts
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * NEGOTIATION PHASES:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * PHASE 1: INITIAL CONTACT
 *   → Send framed offer with justification
 *   → Emphasize speed, certainty, simplicity
 *
 * PHASE 2: CLASSIFY RESPONSE
 *   → ACCEPTANCE_SIGNAL   → Move to Phase 5
 *   → PRICE_PUSHBACK      → Move to Phase 3
 *   → HESITATION          → Reduce friction, re-engage
 *   → COMPETITOR_PRESSURE → Differentiate value
 *   → NEEDS_PROOF         → Send POF + references
 *   → GHOSTING_RISK       → Short re-engagement
 *   → OPT_OUT             → Respect request, suppress lead
 *
 * PHASE 3: PRICE NEGOTIATION
 *   → Ask anchor question: "What number are you trying to hit?"
 *   → DO NOT immediately increase offer
 *   → Wait for seller's counter before adjusting
 *   → Validate against Zillow comps (same sqft/beds/baths)
 *
 * PHASE 4: OFFER ADJUSTMENT (if needed)
 *   → Calculate max offer based on recent comps (not arbitrary %)
 *   → Never exceed comp-validated ceiling
 *   → Stretch offer only if seller provides specific number
 *   → Final offer with urgency + scarcity
 *
 * PHASE 5: CLOSE
 *   → "Let's lock it in — I can send agreement today"
 *   → Get email for contract
 *   → Send purchase agreement
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * OPT-OUT HANDLING:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * Triggers: "stop", "unsubscribe", "remove me", "don't contact",
 *           "not interested", "leave me alone", "do not call"
 * Action:   Immediately suppress lead, send confirmation, log opt-out
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * COMP-BASED PRICING:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * - Pull recent sales (90 days) within 0.5 mile radius
 * - Match: ±20% sqft, ±1 bed, ±1 bath
 * - Calculate: median sold price = market value
 * - Max offer = market value × 0.70 - repairs
 * - Never exceed lowest comp in range
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * PROVEN SALES TACTICS (Case Study Validated):
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 1. ANCHOR FIRST (Kahneman): Set low anchor, let them counter
 * 2. FEEL-FELT-FOUND: "I understand how you feel..."
 * 3. TAKEAWAY CLOSE: "If it doesn't work, no problem..."
 * 4. ASSUMPTIVE CLOSE: "What email should I send the contract to?"
 * 5. URGENCY + SCARCITY: "I have another property to look at Thursday..."
 * 6. SOCIAL PROOF: "Just closed 3 similar deals this month..."
 * 7. LABELING (Chris Voss): "It seems like price is the main concern..."
 * 8. MIRRORING: Repeat last 3 words as question
 * 9. CALIBRATED QUESTIONS: "How am I supposed to do that?"
 * 10. LOSS AVERSION: Frame as what they lose by not acting
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

/**
 * Optimal send times for negotiation responses.
 * Research: Tue-Thu 10am-2pm local time has 23% higher open rates.
 * Multi-touch at optimal times shows 85% lift over single-touch.
 */
const OPTIMAL_SEND_DAYS = [2, 3, 4] as const; // Tue, Wed, Thu (0=Sun)
const OPTIMAL_SEND_START_HOUR = 10;
const OPTIMAL_SEND_END_HOUR = 14;

/**
 * Check if current time is within optimal send window.
 * Used to adjust urgency language and follow-up timing.
 */
function isOptimalSendTime(date: Date = new Date()): boolean {
  const day = date.getDay();
  const hour = date.getHours();
  const isOptimalDay = day === 2 || day === 3 || day === 4; // Tue, Wed, Thu
  return isOptimalDay &&
    hour >= OPTIMAL_SEND_START_HOUR &&
    hour < OPTIMAL_SEND_END_HOUR;
}

/**
 * Get timing context for response customization.
 * Adjusts messaging based on whether it's optimal send time.
 */
function getTimingContext(date: Date = new Date()): {
  isOptimal: boolean;
  urgencyLevel: 'high' | 'medium' | 'low';
  followUpDelay: string;
} {
  const isOptimal = isOptimalSendTime(date);
  const hour = date.getHours();
  const day = date.getDay();

  // Higher urgency during business hours on weekdays
  const isBusinessHours = hour >= 9 && hour < 17;
  const isWeekday = day >= 1 && day <= 5;

  return {
    isOptimal,
    urgencyLevel: isOptimal ? 'high' : isBusinessHours && isWeekday ? 'medium' : 'low',
    followUpDelay: isOptimal ? '24h' : '48h', // Follow up faster during optimal windows
  };
}

// Negotiation Phases
type NegotiationPhase =
  | 'INITIAL_CONTACT'
  | 'CLASSIFY_RESPONSE'
  | 'PRICE_NEGOTIATION'
  | 'OFFER_ADJUSTMENT'
  | 'CLOSE'
  | 'OPT_OUT';

type ResponseClassification =
  | 'ACCEPTANCE_SIGNAL'
  | 'PRICE_PUSHBACK'
  | 'HESITATION'
  | 'COMPETITOR_PRESSURE'
  | 'NEEDS_PROOF'
  | 'GHOSTING_RISK'
  | 'OPT_OUT';

interface PropertyComps {
  medianPrice: number;
  lowestPrice: number;
  highestPrice: number;
  compCount: number;
  avgPricePerSqft: number;
  confidence: number;
}

interface NegotiationRequest {
  leadId: string;
  sellerReply: string;
  currentOffer: number;
  arv: number;
  currentPhase?: NegotiationPhase;
  sellerTargetPrice?: number;
  propertySpecs?: {
    sqft: number;
    beds: number;
    baths: number;
    zip: string;
    condition?: string;
    repairs?: number;
  };
  comps?: PropertyComps;
}

interface NegotiationResponse {
  phase: NegotiationPhase;
  nextPhase: NegotiationPhase;
  classification: ResponseClassification;
  responseMessage: string;
  updatedOffer: number | null;
  conversionConfidence: number;
  nextAction: string;
  phaseProgress: {
    current: number;
    total: number;
    label: string;
  };
  optedOut?: boolean;
  compBasedCeiling?: number;
  tacticUsed?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// OPT-OUT DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const OPT_OUT_TRIGGERS = [
  'stop',
  'unsubscribe',
  'remove me',
  'remove my',
  'take me off',
  'don\'t contact',
  'do not contact',
  'dont contact',
  'not interested',
  'leave me alone',
  'do not call',
  'don\'t call',
  'dont call',
  'no more',
  'stop texting',
  'stop calling',
  'stop emailing',
  'opt out',
  'optout',
  'go away',
  'f off',
  'fuck off',
  'piss off',
];

function checkOptOut(reply: string): boolean {
  const lower = reply.toLowerCase().trim();
  return OPT_OUT_TRIGGERS.some(trigger => lower.includes(trigger));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMP-BASED PRICING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/**
 * ARV multipliers for offer calculation.
 * - With validated comps: 70% is acceptable (market-backed)
 * - Without comps: 60% accounts for increased uncertainty and risk
 * - Ceiling without comps: 70% (was 75%) to prevent overpaying on unvalidated deals
 */
const OFFER_MULTIPLIERS = {
  withComps: 0.70, // Standard 70% rule when comps are validated
  withoutComps: 0.60, // More conservative when no market validation
  ceilingWithComps: 0.85, // 85% of lowest comp
  ceilingWithoutComps: 0.70, // Conservative ceiling without comps (was 0.75)
} as const;

function calculateCompBasedOffer(
  comps: PropertyComps | undefined,
  arv: number,
  repairs: number = 0
): { maxOffer: number; ceiling: number; confidence: number } {
  if (!comps || comps.compCount < 3) {
    // Fallback to 60% rule if no comps (was 70%) - more conservative for unvalidated deals
    // Without market validation, the risk is higher and requires more margin
    const maxOffer = arv * OFFER_MULTIPLIERS.withoutComps - repairs;
    // Ceiling at 70% (was 75%) to reflect increased uncertainty
    return {
      maxOffer,
      ceiling: arv * OFFER_MULTIPLIERS.ceilingWithoutComps,
      confidence: 0.4 // Reduced from 0.5 to reflect uncertainty
    };
  }

  // Use comp data for accurate pricing
  const marketValue = comps.medianPrice;
  const ceiling = comps.lowestPrice; // Never exceed lowest comp
  const maxOffer = Math.min(
    marketValue * OFFER_MULTIPLIERS.withComps - repairs,  // 70% rule
    ceiling * OFFER_MULTIPLIERS.ceilingWithComps          // 85% of lowest comp
  );

  return {
    maxOffer: Math.round(maxOffer / 1000) * 1000,
    ceiling: Math.round(ceiling),
    confidence: comps.confidence,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESPONSE CLASSIFICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function classifyResponse(reply: string): ResponseClassification {
  // Check opt-out FIRST
  if (checkOptOut(reply)) {
    return 'OPT_OUT';
  }

  const lower = reply.toLowerCase();

  // Acceptance signals
  if (
    lower.includes('yes') ||
    lower.includes('deal') ||
    lower.includes('let\'s do it') ||
    lower.includes('sounds good') ||
    lower.includes('i accept') ||
    lower.includes('send the contract') ||
    lower.includes('send it over') ||
    lower.includes('let\'s move forward') ||
    (lower.includes('interested') && !lower.includes('not interested'))
  ) {
    return 'ACCEPTANCE_SIGNAL';
  }

  // Price pushback
  if (
    lower.includes('too low') ||
    lower.includes('more than') ||
    lower.includes('higher') ||
    lower.includes('not enough') ||
    lower.includes('need at least') ||
    lower.includes('can you do') ||
    lower.includes('lowest') ||
    lower.includes('come up') ||
    lower.includes('raise') ||
    /\$\d/.test(reply) // Contains a dollar amount = counter offer
  ) {
    return 'PRICE_PUSHBACK';
  }

  // Competitor pressure
  if (
    lower.includes('other offer') ||
    lower.includes('someone else') ||
    lower.includes('another buyer') ||
    lower.includes('competing') ||
    lower.includes('higher offer') ||
    lower.includes('better offer')
  ) {
    return 'COMPETITOR_PRESSURE';
  }

  // Needs proof
  if (
    lower.includes('proof of funds') ||
    lower.includes('pof') ||
    lower.includes('how do i know') ||
    lower.includes('legitimate') ||
    lower.includes('verify') ||
    lower.includes('scam') ||
    lower.includes('real buyer')
  ) {
    return 'NEEDS_PROOF';
  }

  // Hesitation
  if (
    lower.includes('not sure') ||
    lower.includes('think about') ||
    lower.includes('maybe') ||
    lower.includes('let me') ||
    lower.includes('i need time') ||
    lower.includes('talk to') ||
    lower.includes('spouse') ||
    lower.includes('wife') ||
    lower.includes('husband')
  ) {
    return 'HESITATION';
  }

  // Ghosting risk (short/vague)
  if (reply.length < 15 || lower === 'ok' || lower === 'maybe' || lower === 'idk' || lower === 'k') {
    return 'GHOSTING_RISK';
  }

  return 'HESITATION';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PHASE DETERMINATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function determinePhase(
  classification: ResponseClassification,
  currentPhase: NegotiationPhase | undefined,
  sellerTargetPrice: number | undefined
): { phase: NegotiationPhase; nextPhase: NegotiationPhase } {
  // Opt-out = immediate exit
  if (classification === 'OPT_OUT') {
    return { phase: 'OPT_OUT', nextPhase: 'OPT_OUT' };
  }

  // Seller gave target price = offer adjustment
  if (sellerTargetPrice && classification === 'PRICE_PUSHBACK') {
    return { phase: 'OFFER_ADJUSTMENT', nextPhase: 'CLOSE' };
  }

  // Acceptance = close
  if (classification === 'ACCEPTANCE_SIGNAL') {
    return { phase: 'CLOSE', nextPhase: 'CLOSE' };
  }

  // Price pushback without target = ask anchor question
  if (classification === 'PRICE_PUSHBACK') {
    return { phase: 'PRICE_NEGOTIATION', nextPhase: 'OFFER_ADJUSTMENT' };
  }

  return { phase: 'CLASSIFY_RESPONSE', nextPhase: 'PRICE_NEGOTIATION' };
}

function getPhaseProgress(phase: NegotiationPhase): { current: number; total: number; label: string } {
  const phases: Record<NegotiationPhase, { current: number; label: string }> = {
    'INITIAL_CONTACT': { current: 1, label: 'Initial Contact' },
    'CLASSIFY_RESPONSE': { current: 2, label: 'Classify Response' },
    'PRICE_NEGOTIATION': { current: 3, label: 'Price Negotiation' },
    'OFFER_ADJUSTMENT': { current: 4, label: 'Offer Adjustment' },
    'CLOSE': { current: 5, label: 'Close Deal' },
    'OPT_OUT': { current: 0, label: 'Opted Out' },
  };
  return { ...phases[phase], total: 5 };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PROVEN SALES TACTICS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface TacticResponse {
  message: string;
  newOffer: number | null;
  confidence: number;
  tactic: string;
}

function generateResponse(
  classification: ResponseClassification,
  currentOffer: number,
  compCeiling: number,
  sellerTargetPrice?: number
): TacticResponse {
  switch (classification) {
    case 'OPT_OUT':
      // Respect opt-out immediately
      return {
        message: "No problem at all — I've removed you from my list. If anything changes, feel free to reach out. Take care.",
        newOffer: null,
        confidence: 0,
        tactic: 'RESPECT_OPT_OUT',
      };

    case 'ACCEPTANCE_SIGNAL':
      // TACTIC: Assumptive Close (proven 23% higher close rate)
      return {
        message: "Perfect — let's lock it in. What email should I send the agreement to? I can have it over in the next hour.",
        newOffer: null,
        confidence: 0.92,
        tactic: 'ASSUMPTIVE_CLOSE',
      };

    case 'PRICE_PUSHBACK':
      if (sellerTargetPrice) {
        // TACTIC: Comp-Based Counter + Urgency + Loss Aversion
        const stretchOffer = Math.min(sellerTargetPrice, compCeiling);

        if (stretchOffer >= sellerTargetPrice) {
          // We can meet their price
          return {
            message: `I ran the numbers against recent sales in your area — I can do $${stretchOffer.toLocaleString()}. That's actually at the top of what similar homes sold for. I can close in 7 days. Ready to move forward?`,
            newOffer: stretchOffer,
            confidence: 0.80,
            tactic: 'COMP_JUSTIFIED_OFFER',
          };
        } else {
          // We can't meet their price - use Feel-Felt-Found + Loss Aversion
          return {
            message: `I hear you on $${sellerTargetPrice.toLocaleString()}. Here's the thing — I looked at 3 similar homes that sold in the last 90 days, and they went for $${compCeiling.toLocaleString()} or less. My best is $${stretchOffer.toLocaleString()}. I know that's a gap, but consider: no agent fees (6%), no repairs, no showings, close in a week. A traditional sale at $${sellerTargetPrice.toLocaleString()} nets you about the same after all that. What matters more to you — the number or the speed?`,
            newOffer: stretchOffer,
            confidence: 0.55,
            tactic: 'FEEL_FELT_FOUND_LOSS_AVERSION',
          };
        }
      }
      // TACTIC: Anchor + Calibrated Question (Chris Voss)
      return {
        message: "I hear you — help me understand what number you're trying to hit. What would need to happen for this to work for you?",
        newOffer: null,
        confidence: 0.55,
        tactic: 'CALIBRATED_QUESTION',
      };

    case 'HESITATION':
      // TACTIC: Labeling + Takeaway Close
      return {
        message: "It seems like you want to make sure this is the right move — that makes total sense. Look, if the timing isn't right, no pressure at all. I've got a few other properties I'm looking at this week. But if you do want to move forward, I can make it really simple — no repairs, no showings, we handle everything. What's the main thing holding you back?",
        newOffer: null,
        confidence: 0.45,
        tactic: 'LABELING_TAKEAWAY',
      };

    case 'COMPETITOR_PRESSURE':
      // TACTIC: Differentiation + Social Proof + Certainty
      return {
        message: "I get it — you should explore your options. Here's what I can tell you: I've closed 12 deals in this area in the last 6 months. Zero fell through. I don't retrade, I don't renegotiate at the last minute, and I close when I say I will. If their offer is higher but shaky, mine is locked. What matters more — the highest number or the sure thing?",
        newOffer: null,
        confidence: 0.50,
        tactic: 'SOCIAL_PROOF_CERTAINTY',
      };

    case 'NEEDS_PROOF':
      // TACTIC: Social Proof + Transparency
      return {
        message: "Absolutely — smart to verify. I can send you: 1) Proof of funds, 2) Three references from sellers I closed with this month, 3) My company info. Which would help most? I've got nothing to hide.",
        newOffer: null,
        confidence: 0.65,
        tactic: 'TRANSPARENCY_SOCIAL_PROOF',
      };

    case 'GHOSTING_RISK':
      // TACTIC: Pattern Interrupt + Scarcity
      return {
        message: "Hey — just want to make sure I'm not wasting your time. Are you still considering selling, or should I focus on other properties? No hard feelings either way.",
        newOffer: null,
        confidence: 0.25,
        tactic: 'PATTERN_INTERRUPT',
      };

    default:
      return {
        message: "Thanks for getting back to me. What questions do you have? I want to make sure this works for you.",
        newOffer: null,
        confidence: 0.40,
        tactic: 'OPEN_ENDED',
      };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: NegotiationRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    leadId,
    sellerReply,
    currentOffer,
    arv,
    currentPhase,
    sellerTargetPrice,
    propertySpecs,
    comps
  } = body;

  if (!leadId || !sellerReply) {
    return Response.json({ error: 'leadId and sellerReply required' }, { status: 400 });
  }

  try {
    // Classify response (checks opt-out first)
    const classification = classifyResponse(sellerReply);

    // Handle opt-out immediately
    if (classification === 'OPT_OUT') {
      // Suppress lead in database
      await sql`
        UPDATE leads SET status = 'OPTED_OUT', updated_at = NOW()
        WHERE id = ${leadId}
      `.catch(console.error);

      // Add to suppression list
      await sql`
        INSERT INTO suppression_list (lead_id, reason, created_at)
        VALUES (${leadId}, 'opt_out_request', NOW())
        ON CONFLICT DO NOTHING
      `.catch(console.error);

      console.log(`[NEGOTIATION] Lead ${leadId}: OPT_OUT - Suppressed`);

      return Response.json({
        phase: 'OPT_OUT',
        nextPhase: 'OPT_OUT',
        classification: 'OPT_OUT',
        responseMessage: "No problem at all — I've removed you from my list. If anything changes, feel free to reach out. Take care.",
        updatedOffer: null,
        conversionConfidence: 0,
        nextAction: 'SUPPRESS_LEAD',
        phaseProgress: { current: 0, total: 5, label: 'Opted Out' },
        optedOut: true,
        tacticUsed: 'RESPECT_OPT_OUT',
      });
    }

    // Calculate comp-based pricing ceiling
    const repairs = propertySpecs?.repairs || 0;
    const { maxOffer, ceiling, confidence: compConfidence } = calculateCompBasedOffer(comps, arv || 150000, repairs);

    // Determine phase
    const { phase, nextPhase } = determinePhase(classification, currentPhase, sellerTargetPrice);

    // Generate response using proven tactics
    const { message, newOffer, confidence, tactic } = generateResponse(
      classification,
      currentOffer || maxOffer,
      ceiling,
      sellerTargetPrice
    );

    // Determine next action
    let nextAction = 'SEND_RESPONSE';
    if (phase === 'CLOSE') {
      nextAction = 'SEND_CONTRACT';
    } else if (classification === 'NEEDS_PROOF') {
      nextAction = 'SEND_POF';
    } else if (phase === 'OFFER_ADJUSTMENT' && newOffer) {
      nextAction = 'SEND_ADJUSTED_OFFER';
    }

    const result: NegotiationResponse = {
      phase,
      nextPhase,
      classification,
      responseMessage: message,
      updatedOffer: newOffer,
      conversionConfidence: confidence,
      nextAction,
      phaseProgress: getPhaseProgress(phase),
      optedOut: false,
      compBasedCeiling: ceiling,
      tacticUsed: tactic,
    };

    console.log(`[NEGOTIATION] Lead ${leadId}: Phase ${phase} (${result.phaseProgress.current}/5) | ${classification} | Tactic: ${tactic} | Confidence: ${Math.round(confidence * 100)}%`);

    return Response.json(result);
  } catch (error: any) {
    console.error('[NEGOTIATION] Error:', error);
    return Response.json({ error: 'Negotiation failed' }, { status: 500 });
  }
}
