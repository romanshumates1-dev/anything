import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * POST /api/campaigns/orchestrator/select-template
 *
 * Analyzes lead psychology and selects optimal message template.
 *
 * Input: { leadId: number, touchNumber: number }
 * Output: { templateId: number, messageType: string, reasoning: string }
 *
 * Psychology Detection:
 * - HIGH DISTRESS: pre_foreclosure, tax_delinquent, bankruptcy → empathy + speed
 * - INVESTOR: multiple properties, LLC owner → numbers + certainty
 * - COMPETITIVE: recent list, price drop → reliability + execution
 * - DEFAULT: standard baseline messaging
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const body = await request.json();
  const { leadId, touchNumber } = body;

  if (!leadId || touchNumber === undefined) {
    return NextResponse.json(
      { error: 'leadId and touchNumber required' },
      { status: 400 }
    );
  }

  try {
    // 1. Get lead data + signals
    const [lead] = await sql`
      SELECT
        l.id,
        l.name,
        l.metadata->>'signals' as signals_json,
        l.metadata->>'owner_type' as owner_type,
        l.metadata->>'days_on_market' as days_on_market,
        l.metadata->>'price_drops' as price_drops,
        ls.distress_score,
        dp.p_close
      FROM leads l
      LEFT JOIN lead_scores ls ON ls.lead_id = l.id
      LEFT JOIN deal_probabilities dp ON dp.lead_id = l.id
      WHERE l.id = ${leadId}
        AND l.organization_id = ${organization.id}
    `;

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // 2. Parse signals
    let signals: string[] = [];
    try {
      signals = lead.signals_json ? JSON.parse(lead.signals_json) : [];
    } catch {
      signals = [];
    }

    // 3. Detect seller profile
    const profile = detectSellerProfile({
      signals,
      ownerType: lead.owner_type,
      distressScore: lead.distress_score,
      pClose: Number(lead.p_close),
      daysOnMarket: lead.days_on_market ? parseInt(lead.days_on_market) : null,
      priceDrops: lead.price_drops ? parseInt(lead.price_drops) : null
    });

    // 4. Select template based on profile + touch
    const messageType = selectMessageType(profile, touchNumber);

    // 5. Get template
    const [template] = await sql`
      SELECT id, subject_template, body_template, message_type
      FROM campaign_message_library
      WHERE (organization_id = ${organization.id} OR organization_id = 'default')
        AND touch_number = ${touchNumber}
        AND message_type = ${messageType}
        AND active = true
      ORDER BY organization_id DESC
      LIMIT 1
    `;

    if (!template) {
      // Fallback to baseline
      const [fallback] = await sql`
        SELECT id, subject_template, body_template, message_type
        FROM campaign_message_library
        WHERE organization_id = 'default'
          AND touch_number = ${touchNumber}
          AND active = true
        ORDER BY id
        LIMIT 1
      `;

      if (!fallback) {
        return NextResponse.json({ error: 'No template found' }, { status: 500 });
      }

      return NextResponse.json({
        templateId: fallback.id,
        messageType: fallback.message_type,
        profile: 'baseline',
        reasoning: 'No specific profile match, using baseline template'
      });
    }

    return NextResponse.json({
      templateId: template.id,
      messageType: template.message_type,
      profile: profile.type,
      reasoning: profile.reasoning,
      toneAdjustment: profile.tone
    });

  } catch (error: any) {
    console.error('POST /api/campaigns/orchestrator/select-template error', error);
    return NextResponse.json(
      { error: 'Failed to select template' },
      { status: 500 }
    );
  }
}

/**
 * Detect seller profile based on signals and behavior
 */
function detectSellerProfile(data: {
  signals: string[];
  ownerType: string | null;
  distressScore: number | null;
  pClose: number;
  daysOnMarket: number | null;
  priceDrops: number | null;
}): {
  type: 'high_distress' | 'investor' | 'competitive' | 'baseline';
  reasoning: string;
  tone: string;
} {
  const { signals, ownerType, distressScore, daysOnMarket, priceDrops } = data;

  // HIGH DISTRESS: urgent situation, need empathy + speed
  const highDistressSignals = [
    'pre_foreclosure',
    'tax_delinquent',
    'bankruptcy',
    'probate',
    'divorce',
    'code_violation'
  ];
  const hasHighDistress = signals.some(s => highDistressSignals.includes(s));

  if (hasHighDistress || (distressScore && distressScore > 0.7)) {
    return {
      type: 'high_distress',
      reasoning: 'Urgent situation detected (foreclosure, tax issues, or distress score >0.7)',
      tone: 'Empathetic, speed-focused, solution-oriented'
    };
  }

  // INVESTOR: business owner, wants numbers + certainty
  const investorSignals = ['llc', 'inc', 'trust', 'holdings'];
  const isInvestor =
    ownerType === 'llc' ||
    ownerType === 'corporation' ||
    investorSignals.some(s => ownerType?.toLowerCase().includes(s));

  if (isInvestor) {
    return {
      type: 'investor',
      reasoning: 'Owner type indicates investor/business entity',
      tone: 'Professional, numbers-driven, certainty-focused'
    };
  }

  // COMPETITIVE: active market, needs reliability + execution
  const hasCompetition =
    (daysOnMarket !== null && daysOnMarket < 30) ||
    (priceDrops !== null && priceDrops > 0) ||
    signals.includes('listed') ||
    signals.includes('fsbo');

  if (hasCompetition) {
    return {
      type: 'competitive',
      reasoning: 'Property listed or active market indicators (DOM <30, price drops)',
      tone: 'Confident, execution-focused, differentiated'
    };
  }

  // BASELINE: standard messaging
  return {
    type: 'baseline',
    reasoning: 'No specific profile indicators, using standard approach',
    tone: 'Professional, straightforward, value-focused'
  };
}

/**
 * Select message type based on profile and touch number
 */
function selectMessageType(
  profile: { type: string },
  touchNumber: number
): string {
  // Touch 1: Initial contact
  if (touchNumber === 1) {
    switch (profile.type) {
      case 'high_distress':
        return 'initial_offer_distress';
      case 'investor':
        return 'initial_offer_investor';
      default:
        return 'initial_offer';
    }
  }

  // Touch 2: Day 3 follow-up
  if (touchNumber === 2) {
    switch (profile.type) {
      case 'competitive':
        return 'follow_up_execution';
      default:
        return 'follow_up_adjust';
    }
  }

  // Touch 3: Final touches (day 5 or 7)
  if (touchNumber === 3) {
    // Alternate between closing out and timing flexibility
    return Math.random() > 0.5 ? 'final_close_out' : 'final_timing';
  }

  // Fallback
  return touchNumber === 1 ? 'initial_offer' : 'follow_up_adjust';
}
