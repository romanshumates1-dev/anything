/**
 * Offer Framing Agent
 * Maximizes offer acceptance probability through optimized messaging
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

type SellerSource = 'wholesaler' | 'marketplace' | 'distressed_owner' | 'unknown';

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

    // Calculate offer price (70% rule with adjustments)
    const calculatedMAO = mao || (arv * 0.7 - (repairs || 0));
    const offerPrice = Math.round(calculatedMAO / 1000) * 1000; // Round to nearest $1k

    const { tone } = getToneBySource(detectedSource);
    const framingMessage = generateFramingMessage(address, offerPrice, detectedSource, sellerContext);

    // Calculate confidence based on spread
    const spread = arv - offerPrice;
    const spreadPercent = spread / arv;
    const confidence = spreadPercent > 0.35 ? 0.85 : spreadPercent > 0.25 ? 0.70 : 0.55;

    const result: FramedOffer = {
      offerPrice,
      framingMessage,
      tone,
      confidence: Math.round(confidence * 100) / 100,
    };

    // Log the framed offer
    console.log(`[OFFER-FRAMING] Lead ${leadId}: $${offerPrice} (${tone})`);

    return Response.json(result);
  } catch (error: any) {
    console.error('[OFFER-FRAMING] Error:', error);
    return Response.json({ error: 'Failed to frame offer' }, { status: 500 });
  }
}
