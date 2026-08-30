import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * POST /api/conversion/follow-up
 *
 * Follow-Up Optimization Agent - revives and converts inactive leads.
 * Never repeats messages, keeps them short, adds new angles.
 *
 * Input: { leadId: number, daysSinceLastContact: number }
 * Output: { message: string, angle: string, tone: string }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const body = await request.json();
  const { leadId, daysSinceLastContact } = body;

  if (!leadId || daysSinceLastContact === undefined) {
    return NextResponse.json(
      { error: 'leadId and daysSinceLastContact required' },
      { status: 400 }
    );
  }

  try {
    // Get lead context
    const [lead] = await sql`
      SELECT
        l.name,
        l.metadata->>'signals' as signals_json,
        l.metadata->>'address' as address,
        ls.distress_score,
        pv.offer_max
      FROM leads l
      LEFT JOIN lead_scores ls ON ls.lead_id = l.id
      LEFT JOIN property_valuations pv ON pv.lead_id = l.id
      WHERE l.id = ${leadId}
        AND l.organization_id = ${organization.id}
    `;

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // Parse signals
    let signals: string[] = [];
    try {
      signals = lead.signals_json ? JSON.parse(lead.signals_json) : [];
    } catch {
      signals = [];
    }

    // Detect seller profile
    const profile = detectProfile(signals, lead.distress_score);

    // Select message based on days + profile
    const followUp = selectFollowUp(daysSinceLastContact, profile, {
      name: lead.name,
      offer: lead.offer_max
    });

    return NextResponse.json({
      message: followUp.message,
      angle: followUp.angle,
      tone: followUp.tone,
      profile: profile.type,
      daysSince: daysSinceLastContact
    });

  } catch (error: any) {
    console.error('POST /api/conversion/follow-up error', error);
    return NextResponse.json(
      { error: 'Failed to generate follow-up' },
      { status: 500 }
    );
  }
}

/**
 * Detect seller profile for tone adjustment
 */
function detectProfile(
  signals: string[],
  distressScore: number | null
): {
  type: 'high_distress' | 'investor' | 'competitive' | 'standard';
  motivation: string;
  pressureLevel: 'low' | 'medium' | 'high';
} {
  // HIGH DISTRESS
  const highDistressSignals = ['pre_foreclosure', 'tax_delinquent', 'bankruptcy', 'probate'];
  if (signals.some(s => highDistressSignals.includes(s)) || (distressScore && distressScore > 0.7)) {
    return {
      type: 'high_distress',
      motivation: 'speed',
      pressureLevel: 'high'
    };
  }

  // INVESTOR
  if (signals.includes('llc') || signals.includes('trust')) {
    return {
      type: 'investor',
      motivation: 'certainty',
      pressureLevel: 'low'
    };
  }

  // COMPETITIVE
  if (signals.includes('listed') || signals.includes('fsbo')) {
    return {
      type: 'competitive',
      motivation: 'reliability',
      pressureLevel: 'medium'
    };
  }

  return {
    type: 'standard',
    motivation: 'convenience',
    pressureLevel: 'low'
  };
}

/**
 * Select follow-up message based on timing and profile
 */
function selectFollowUp(
  daysSince: number,
  profile: { type: string; motivation: string; pressureLevel: string },
  context: { name: string | null; offer: number }
): {
  message: string;
  angle: string;
  tone: string;
} {
  const name = context.name || 'there';
  const offerStr = context.offer ? `$${Math.round(context.offer / 100).toLocaleString()}` : 'my offer';

  // DAY 1: Circle back
  if (daysSince <= 1) {
    if (profile.type === 'high_distress') {
      return {
        message: `Hi ${name} — just circling back.\n\nI can still close fast if you need to move quickly. Let me know.`,
        angle: 'speed + empathy',
        tone: 'supportive'
      };
    }
    return {
      message: `Just circling back — still considering offers?`,
      angle: 'gentle reminder',
      tone: 'neutral'
    };
  }

  // DAY 3: Adjust terms
  if (daysSince <= 3) {
    if (profile.type === 'investor') {
      return {
        message: `Can adjust terms if needed.\n\nAll-cash, proof of funds ready. What number works for you?`,
        angle: 'flexibility + certainty',
        tone: 'professional'
      };
    }
    return {
      message: `Can adjust terms if needed — what's most important to you?\n\nPrice, timing, or simplicity?`,
      angle: 'identify motivation',
      tone: 'collaborative'
    };
  }

  // DAY 5: Close out
  if (daysSince <= 5) {
    if (profile.type === 'competitive') {
      return {
        message: `Still interested or should I close this out?\n\nI won't retrade or waste your time — just want to know where you're at.`,
        angle: 'urgency + reliability',
        tone: 'direct'
      };
    }
    return {
      message: `Still interested or should I close this out?\n\nNo worries either way.`,
      angle: 'soft urgency',
      tone: 'casual'
    };
  }

  // DAY 7+: Timing flexibility
  if (profile.type === 'high_distress') {
    return {
      message: `If timing was the issue, I can be flexible.\n\nClose next week or 60 days — whatever helps.`,
      angle: 'remove timing objection',
      tone: 'accommodating'
    };
  }

  return {
    message: `If timing was the issue, I can be flexible.\n\nStill open to ${offerStr} if you want to move forward.`,
    angle: 'final flexibility',
    tone: 'open-ended'
  };
}
