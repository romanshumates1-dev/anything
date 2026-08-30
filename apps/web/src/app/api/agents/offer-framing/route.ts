/**
 * Offer Framing Agent
 * Maximizes offer acceptance probability through optimized messaging
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

type SellerSource = 'wholesaler' | 'marketplace' | 'distressed_owner' | 'unknown';

// Configurable thresholds for confidence calculation and offer pricing
// These should be validated against actual conversion data via A/B testing
const SPREAD_THRESHOLDS = { high: 0.35, medium: 0.25 } as const;

// ARV multiplier - 65% baseline provides better margin for $5K-$35K assignment fees
// Distressed properties use 60-62% to capture additional margin from motivated sellers
const ARV_MULTIPLIERS = {
  standard: 0.65, // Industry standard for wholesaling
  distressed: 0.60, // Foreclosure, probate, tax lien = higher motivation
} as const;

interface OfferFramingRequest {
  leadId: string;
  arv: number;
  repairs: number;
  mao: number;
  sellerContext?: string;
  source?: SellerSource;
}

interface FramedOffer {
  offerPrice: number;
  framingMessage: string;
  tone: string;
  confidence: number;
}

function determineSource(metadata: any): SellerSource {
  const signals = metadata?.signals || [];
  if (signals.includes('wholesaler') || metadata?.source === 'wholesaler') return 'wholesaler';
  if (signals.includes('marketplace') || metadata?.source === 'marketplace') return 'marketplace';
  if (signals.includes('foreclosure') || signals.includes('probate') || signals.includes('tax_lien')) return 'distressed_owner';
  return 'unknown';
}

function getToneBySource(source: SellerSource): { tone: string; style: string } {
  switch (source) {
    case 'wholesaler':
      return { tone: 'Direct, transactional', style: 'professional' };
    case 'distressed_owner':
      return { tone: 'Empathetic, simple', style: 'supportive' };
    case 'marketplace':
      return { tone: 'Casual, fast', style: 'friendly' };
    default:
      return { tone: 'Professional, clear', style: 'neutral' };
  }
}

function generateFramingMessage(
  address: string,
  offerPrice: number,
  source: SellerSource,
  sellerContext?: string
): string {
  const priceStr = `$${offerPrice.toLocaleString()}`;
  const { style } = getToneBySource(source);

  if (style === 'professional') {
    return `Regarding ${address} — based on current market comps and condition, I'm at ${priceStr}. Can close within 14 days, cash, as-is. Let me know if that works or where you need to be.`;
  }

  if (style === 'supportive') {
    return `Hi — I took a look at your property on ${address}. I understand you may be going through a lot right now, and I want to make this as simple as possible for you. I can offer ${priceStr}, close quickly, and handle everything — no repairs, no showings, no hassle. Just let me know if that helps or if there's anything else you need.`;
  }

  if (style === 'friendly') {
    return `Hey — checked out ${address}. Given comps and condition, I'd be around ${priceStr}. I can move fast and keep it simple on your end. Let me know if that works or where you need to be.`;
  }

  return `Hi — regarding the property at ${address}, I can offer ${priceStr} based on current market conditions. I can close quickly with cash, as-is. No repairs needed on your end. Let me know your thoughts.`;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: OfferFramingRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { leadId, arv, repairs, mao, sellerContext, source } = body;

  if (!leadId || !arv) {
    return Response.json({ error: 'leadId and arv required' }, { status: 400 });
  }

  try {
    const [lead] = await sql`
      SELECT id, name, metadata FROM leads
      WHERE id = ${leadId} AND organization_id = ${organization.id}
    `;

    if (!lead) {
      return Response.json({ error: 'Lead not found' }, { status: 404 });
    }

    const metadata = lead.metadata || {};
    const detectedSource = source || determineSource(metadata);
    const address = metadata.address || metadata.property_address || 'your property';

    // Calculate offer price using appropriate ARV multiplier
    // Distressed sellers (foreclosure, probate, tax lien) have 4% response rate vs 0.5% cold
    // and accept 10-15% lower offers - start lower to maximize assignment fee ($3K-$5K uplift)
    const isDistressed = detectedSource === 'distressed_owner';
    const arvMultiplier = isDistressed ? ARV_MULTIPLIERS.distressed : ARV_MULTIPLIERS.standard;
    const calculatedMAO = mao || (arv * arvMultiplier - (repairs || 0));
    const offerPrice = Math.round(calculatedMAO / 1000) * 1000; // Round to nearest $1k

    const { tone } = getToneBySource(detectedSource);
    const framingMessage = generateFramingMessage(address, offerPrice, detectedSource, sellerContext);

    // Calculate confidence based on spread (thresholds configurable for A/B testing)
    const spread = arv - offerPrice;
    const spreadPercent = spread / arv;
    const confidence = spreadPercent > SPREAD_THRESHOLDS.high ? 0.85
      : spreadPercent > SPREAD_THRESHOLDS.medium ? 0.70
      : 0.55;

    const result: FramedOffer = {
      offerPrice,
      framingMessage,
      tone,
      confidence: Math.round(confidence * 100) / 100,
    };

    // Log the framed offer with distress indicator
    console.log(`[OFFER-FRAMING] Lead ${leadId}: $${offerPrice} (${tone})${isDistressed ? ' [DISTRESSED]' : ''} ARV%=${Math.round(arvMultiplier * 100)}`);

    return Response.json(result);
  } catch (error: any) {
    console.error('[OFFER-FRAMING] Error:', error);
    return Response.json({ error: 'Failed to frame offer' }, { status: 500 });
  }
}
