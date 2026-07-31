import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * POST /api/conversion/negotiation
 *
 * Negotiation Agent - moves conversations toward signed contracts.
 * Classifies replies and chooses optimal response strategy.
 *
 * Input: { leadId: number, inboundMessage: string, currentOffer: number }
 * Output: { classification: string, response: string, updatedOffer?: number, confidence: number }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const body = await request.json();
  const { leadId, inboundMessage, currentOffer } = body;

  if (!leadId || !inboundMessage) {
    return NextResponse.json(
      { error: 'leadId and inboundMessage required' },
      { status: 400 }
    );
  }

  try {
    // Get lead context
    const [lead] = await sql`
      SELECT
        l.name,
        l.metadata->>'address' as address,
        pv.offer_max as max_offer,
        dp.p_close
      FROM leads l
      LEFT JOIN property_valuations pv ON pv.lead_id = l.id
      LEFT JOIN deal_probabilities dp ON dp.lead_id = l.id
      WHERE l.id = ${leadId}
        AND l.organization_id = ${organization.id}
    `;

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Classify the reply
    const classification = classifyReply(inboundMessage);

    // Choose response strategy
    const strategy = chooseStrategy(classification, {
      name: lead.name,
      currentOffer,
      maxOffer: lead.max_offer
    });

    // Log negotiation event
    await sql`
      INSERT INTO negotiation_events (
        organization_id,
        lead_id,
        event_type,
        event_data,
        created_at
      ) VALUES (
        ${organization.id},
        ${leadId},
        'reply_classified',
        ${JSON.stringify({
          classification,
          inbound: inboundMessage.substring(0, 200),
          strategy: strategy.type
        })},
        now()
      )
    `;

    return NextResponse.json({
      classification,
      response: strategy.message,
      updatedOffer: strategy.updatedOffer,
      confidence: strategy.confidence,
      nextAction: strategy.nextAction
    });

  } catch (error: any) {
    console.error('POST /api/conversion/negotiation error', error);
    return NextResponse.json(
      { error: 'Failed to process negotiation' },
      { status: 500 }
    );
  }
}

/**
 * Classify inbound reply into negotiation category
 */
function classifyReply(message: string): string {
  const lower = message.toLowerCase();

  // ACCEPTANCE SIGNAL
  if (
    lower.includes('deal') ||
    lower.includes('accept') ||
    lower.includes('yes') ||
    lower.includes('sounds good') ||
    lower.includes('let\'s do it') ||
    lower.includes('works for me')
  ) {
    return 'ACCEPTANCE_SIGNAL';
  }

  // PRICE PUSHBACK
  if (
    lower.includes('too low') ||
    lower.includes('need more') ||
    lower.includes('higher') ||
    lower.includes('not enough') ||
    lower.match(/\$[\d,]+/) // Contains dollar amount
  ) {
    return 'PRICE_PUSHBACK';
  }

  // COMPETITOR PRESSURE
  if (
    lower.includes('other offer') ||
    lower.includes('another buyer') ||
    lower.includes('competing') ||
    lower.includes('comparing')
  ) {
    return 'COMPETITOR_PRESSURE';
  }

  // NEEDS PROOF
  if (
    lower.includes('proof') ||
    lower.includes('funds') ||
    lower.includes('serious') ||
    lower.includes('legitimate')
  ) {
    return 'NEEDS_PROOF';
  }

  // HESITATION
  if (
    lower.includes('not sure') ||
    lower.includes('thinking') ||
    lower.includes('consider') ||
    lower.includes('need time')
  ) {
    return 'HESITATION';
  }

  // Default to neutral
  return 'NEUTRAL_INQUIRY';
}

/**
 * Choose response strategy based on classification
 */
function chooseStrategy(
  classification: string,
  context: { name: string | null; currentOffer: number; maxOffer: number }
): {
  type: string;
  message: string;
  updatedOffer?: number;
  confidence: number;
  nextAction: string;
} {
  const name = context.name || 'there';

  switch (classification) {
    case 'ACCEPTANCE_SIGNAL':
      return {
        type: 'CLOSE_FAST',
        message: `Perfect! Let's lock it in — I can send the agreement today.\n\nI'll handle everything on my end. What's the best email to send it to?`,
        confidence: 0.9,
        nextAction: 'send_contract'
      };

    case 'PRICE_PUSHBACK':
      return {
        type: 'ANCHOR_QUESTION',
        message: `I hear you.\n\nWhat number are you trying to hit?\n\nI want to make sure we're on the same page about condition and what it needs.`,
        confidence: 0.6,
        nextAction: 'await_counter'
      };

    case 'COMPETITOR_PRESSURE':
      return {
        type: 'DIFFERENTIATE',
        message: `I get it — always good to compare.\n\nHere's what makes us different: I won't retrade or waste your time. If I say I'm closing, I'm closing.\n\nNo inspection games, no financing delays. Just clean and fast.`,
        confidence: 0.7,
        nextAction: 'await_decision'
      };

    case 'NEEDS_PROOF':
      return {
        type: 'PROVIDE_PROOF',
        message: `Totally fair.\n\nI'm a serious buyer — I can send proof of funds today. I've closed on 50+ properties in the area.\n\nWhat would help you feel confident?`,
        confidence: 0.75,
        nextAction: 'send_proof_of_funds'
      };

    case 'HESITATION':
      return {
        type: 'REDUCE_FRICTION',
        message: `No pressure at all.\n\nI can make this super simple — we handle everything. All you need to do is sign, and we take it from there.\n\nWhat's holding you back?`,
        confidence: 0.5,
        nextAction: 'identify_objection'
      };

    default:
      return {
        type: 'CLARIFY',
        message: `Thanks for getting back.\n\nDoes my offer work for you, or where are you at with this?`,
        confidence: 0.4,
        nextAction: 'await_clarification'
      };
  }
}
