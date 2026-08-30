import { NextResponse } from 'next/server';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import sql from '@/app/api/utils/sql';

/**
 * POST /api/conversion/offer-framing
 *
 * Offer Framing Agent - maximizes offer acceptance probability.
 * Never just states numbers - frames offers for psychological acceptance.
 *
 * Input: { leadId: number, offerPrice?: number }
 * Output: { offerPrice: number, framingMessage: string, reasoning: string }
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization found' }, { status: 403 });
  }

  const body = await request.json();
  const { leadId, offerPrice } = body;

  if (!leadId) {
    return NextResponse.json({ error: 'leadId required' }, { status: 400 });
  }

  try {
    // Get lead data
    const [lead] = await sql`
      SELECT
        l.id,
        l.name,
        l.metadata->>'address' as address,
        l.metadata->>'source' as source,
        l.metadata->>'signals' as signals_json,
        pv.arv,
        pv.repairs,
        pv.offer_max as mao,
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

    // Parse context
    let signals: string[] = [];
    try {
      signals = lead.signals_json ? JSON.parse(lead.signals_json) : [];
    } catch {
      signals = [];
    }

    const source = (lead.source || 'seller').toLowerCase();
    const finalOffer = offerPrice || lead.mao || 0;

    // Detect tone based on source and context
    const tone = detectTone(source, signals);

    // Build framing message
    const message = buildFramingMessage({
      name: lead.name,
      address: lead.address,
      offerPrice: finalOffer,
      arv: lead.arv,
      repairs: lead.repairs,
      tone,
      source
    });

    // Calculate justification
    const reasoning = buildReasoning(finalOffer, lead.arv, lead.repairs);

    return NextResponse.json({
      offerPrice: finalOffer,
      framingMessage: message,
      reasoning,
      tone,
      acceptance_factors: {
        speed: 'close fast',
        certainty: 'no backing out',
        simplicity: 'no hassle'
      }
    });

  } catch (error: any) {
    console.error('POST /api/conversion/offer-framing error', error);
    return NextResponse.json(
      { error: 'Failed to frame offer' },
      { status: 500 }
    );
  }
}

function detectTone(source: string, signals: string[]): 'wholesaler' | 'seller' | 'marketplace' {
  if (source.includes('wholesale') || source.includes('wholesaler')) {
    return 'wholesaler';
  }
  if (source.includes('marketplace') || source.includes('platform')) {
    return 'marketplace';
  }
  return 'seller'; // Default empathetic tone
}

function buildFramingMessage(data: {
  name: string | null;
  address: string | null;
  offerPrice: number;
  arv: number | null;
  repairs: number | null;
  tone: string;
  source: string;
}): string {
  const offerStr = `$${Math.round(data.offerPrice / 100).toLocaleString()}`;
  const addressStr = data.address || 'the property';

  // WHOLESALER: Direct, transactional
  if (data.tone === 'wholesaler') {
    return `Took a look at ${addressStr}.\n\nGiven the condition and comps, I'd be around ${offerStr}.\n\nI can move quickly and handle everything on my end — no repairs needed.\n\nLet me know if that works or where you need to be.`;
  }

  // MARKETPLACE: Casual, fast
  if (data.tone === 'marketplace') {
    return `Hey — interested in ${addressStr}.\n\nBased on current market, I can do ${offerStr} and close fast.\n\nCash offer, no inspections, no hassle.\n\nWork for you?`;
  }

  // SELLER: Empathetic, simple
  const nameStr = data.name || 'there';
  return `Hi ${nameStr},\n\nI took a look at ${addressStr}.\n\nBased on what it needs and comparable sales nearby, I can offer ${offerStr}.\n\nI can close in 7-14 days, buy as-is, and handle all the paperwork — no repairs, no showings, no stress.\n\nDoes that work for you?`;
}

function buildReasoning(offer: number, arv: number | null, repairs: number | null): string {
  if (!arv) return 'Offer based on market analysis';

  const offerDollars = Math.round(offer / 100);
  const arvDollars = arv ? Math.round(arv / 100) : 0;
  const repairsDollars = repairs ? Math.round(repairs / 100) : 0;

  const profit = arvDollars - repairsDollars - offerDollars;
  const margin = arvDollars > 0 ? ((profit / arvDollars) * 100).toFixed(1) : '0';

  return `ARV ~$${arvDollars.toLocaleString()}, repairs ~$${repairsDollars.toLocaleString()}, offer $${offerDollars.toLocaleString()} (${margin}% margin after rehab)`;
}
