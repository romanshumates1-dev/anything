/**
 * Negotiation Intelligence API
 *
 * Implements sussy2.md requirements:
 * - Dynamic pricing strategy
 * - Behavioral segmentation
 * - Counter-offer prediction
 * - Script optimization per lead type
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';

type SellerSegment = 'DISTRESSED' | 'RETAIL' | 'INVESTOR' | 'UNKNOWN';

interface NegotiationStrategy {
  leadId: number;
  segment: SellerSegment;
  motivationScore: number;
  recommendedOffer: number;
  offerRange: { min: number; max: number };
  counterOfferPrediction: number;
  tactics: string[];
  urgencyLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  bestContactTime: string;
  scriptType: string;
}

function classifySegment(signals: string[], metadata: any): SellerSegment {
  const distressSignals = ['foreclosure', 'tax_lien', 'probate', 'divorce', 'bankruptcy', 'code_violation'];
  const investorSignals = ['llc_owned', 'out_of_state', 'multiple_properties', 'rental'];

  const hasDistress = signals.some(s => distressSignals.includes(s.toLowerCase()));
  const hasInvestor = signals.some(s => investorSignals.includes(s.toLowerCase()));

  if (hasDistress) return 'DISTRESSED';
  if (hasInvestor) return 'INVESTOR';
  if (metadata?.owner_occupied) return 'RETAIL';
  return 'UNKNOWN';
}

function calculateMotivationScore(signals: string[], metadata: any): number {
  let score = 50;

  // Distress signals increase motivation
  const highMotivation = ['foreclosure', 'tax_lien', 'probate'];
  const medMotivation = ['divorce', 'code_violation', 'vacant'];

  for (const signal of signals) {
    if (highMotivation.includes(signal.toLowerCase())) score += 15;
    if (medMotivation.includes(signal.toLowerCase())) score += 10;
  }

  // Time on market increases motivation
  const daysOnMarket = metadata?.days_on_market || 0;
  if (daysOnMarket > 180) score += 20;
  else if (daysOnMarket > 90) score += 10;

  // Equity position affects motivation
  const equity = metadata?.equity_percent || 50;
  if (equity > 50) score += 10;
  if (equity < 20) score -= 10;

  return Math.min(100, Math.max(0, score));
}

function generateTactics(segment: SellerSegment, motivationScore: number): string[] {
  const tactics: string[] = [];

  if (segment === 'DISTRESSED') {
    tactics.push('Emphasize speed of closing');
    tactics.push('Offer to handle all paperwork');
    tactics.push('Be empathetic to their situation');
    if (motivationScore > 70) {
      tactics.push('Present as-is offer immediately');
    }
  } else if (segment === 'INVESTOR') {
    tactics.push('Focus on numbers and ROI');
    tactics.push('Be direct and professional');
    tactics.push('Offer quick due diligence');
  } else if (segment === 'RETAIL') {
    tactics.push('Build rapport first');
    tactics.push('Explain the process clearly');
    tactics.push('Offer flexible closing date');
  }

  return tactics;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { leadId } = body;
  if (!leadId) {
    return Response.json({ error: 'leadId required' }, { status: 400 });
  }

  try {
    const [lead] = await sql`
      SELECT id, metadata, name
      FROM leads
      WHERE id = ${leadId} AND organization_id = ${organization.id}
    `;

    if (!lead) {
      return Response.json({ error: 'Lead not found' }, { status: 404 });
    }

    const metadata = lead.metadata || {};
    const signals = metadata.signals || [];
    const estimatedValue = metadata.estimated_value || metadata.arv || 150000;

    const segment = classifySegment(signals, metadata);
    const motivationScore = calculateMotivationScore(signals, metadata);

    // Calculate offer based on segment and motivation
    let offerPercent = 0.70; // Base 70% of ARV
    if (segment === 'DISTRESSED' && motivationScore > 70) {
      offerPercent = 0.65; // Can go lower for motivated distressed
    } else if (segment === 'RETAIL') {
      offerPercent = 0.75; // Need to offer more for retail
    } else if (segment === 'INVESTOR') {
      offerPercent = 0.72; // Investors know the numbers
    }

    const recommendedOffer = Math.round(estimatedValue * offerPercent);
    const offerRange = {
      min: Math.round(estimatedValue * (offerPercent - 0.05)),
      max: Math.round(estimatedValue * (offerPercent + 0.05))
    };

    // Predict counter-offer likelihood
    const counterOfferPrediction = segment === 'RETAIL' ? 0.85 :
      segment === 'INVESTOR' ? 0.70 :
      segment === 'DISTRESSED' ? 0.40 : 0.60;

    const strategy: NegotiationStrategy = {
      leadId,
      segment,
      motivationScore,
      recommendedOffer,
      offerRange,
      counterOfferPrediction,
      tactics: generateTactics(segment, motivationScore),
      urgencyLevel: motivationScore > 70 ? 'HIGH' : motivationScore > 40 ? 'MEDIUM' : 'LOW',
      bestContactTime: segment === 'INVESTOR' ? '9am-11am weekdays' : '5pm-7pm weekdays',
      scriptType: `${segment.toLowerCase()}_${motivationScore > 70 ? 'urgent' : 'standard'}`
    };

    return Response.json(strategy);
  } catch (error: any) {
    console.error('Negotiation strategy error:', error);
    return Response.json({ error: 'Failed to generate strategy' }, { status: 500 });
  }
}
