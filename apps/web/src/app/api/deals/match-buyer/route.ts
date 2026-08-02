/**
 * Buyer Matching API
 * Automatically finds interested buyers after seller signs
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { sendEmailAuto as sendEmail } from '@/app/api/utils/emailProviders';
import {
  scoreBuyer,
  BuyerSignals,
  BuyerTier,
  calculateEarnestAmount,
} from '@/app/api/prospects/scoring-engine';
import { alertBuyersMatched } from '@/app/api/alerts/notification-engine';

interface BuyerMatch {
  buyerId: string;
  name: string;
  email: string;
  phone?: string;
  matchScore: number;
  matchReasons: string[];
  verified: boolean;
  closedDeals: number;
  tier: BuyerTier;
  earnestMoney: { min: number; max: number; suggested: number };
  priority: string;
}

function calculateMatchScore(buyer: any, deal: any): {
  score: number;
  reasons: string[];
  tier: BuyerTier;
  earnestMoney: { min: number; max: number; suggested: number };
  priority: string;
} {
  const metadata = deal.metadata || {};

  const dealZip = metadata.zip || metadata.property_zip;
  const dealPrice = metadata.purchase_price || metadata.offer_price || 100000;
  const dealType = metadata.property_type || 'single_family';

  // Build buyer signals for scoring engine
  const signals: BuyerSignals = {
    cashPurchases: buyer.cash_buyer || buyer.payment_method === 'cash',
    purchasesLast12Months: buyer.purchases_12mo || 0,
    llcOrEntity: buyer.is_llc || buyer.company_name != null,
    verifiedProofOfFunds: buyer.pof_verified || buyer.verified,
    previousClosedDeal: buyer.closed_deals > 0,
    zipCodeMatch: dealZip && buyer.zip_codes?.includes(dealZip),
    priceRangeMatch: (() => {
      const buyerMin = buyer.price_min_cents ? buyer.price_min_cents / 100 : 0;
      const buyerMax = buyer.price_max_cents ? buyer.price_max_cents / 100 : Infinity;
      return dealPrice >= buyerMin && dealPrice <= buyerMax;
    })(),
    propertyTypeMatch: buyer.property_types?.includes(dealType),
    avgResponseTimeHours: buyer.avg_response_hours,
  };

  // Use scoring engine
  const buyerScore = scoreBuyer(signals);
  const earnestSuggested = calculateEarnestAmount(buyerScore.tier, dealPrice);

  // Build match reasons from scoring signals
  const reasons: string[] = [...buyerScore.signals];

  // Add geographic match reason if applicable
  if (signals.zipCodeMatch) {
    reasons.push(`Matches zip code: ${dealZip}`);
  }

  return {
    score: buyerScore.score,
    reasons,
    tier: buyerScore.tier,
    earnestMoney: {
      ...buyerScore.earnestMoney,
      suggested: earnestSuggested,
    },
    priority: buyerScore.priority,
  };
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

  const { dealId, notifyBuyers = true } = body;

  if (!dealId) {
    return Response.json({ error: 'dealId required' }, { status: 400 });
  }

  try {
    // Get deal
    const [deal] = await sql`
      SELECT * FROM leads WHERE id = ${dealId} AND organization_id = ${organization.id}
    `;

    if (!deal) {
      return Response.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Check deal is in correct status (seller signed)
    if (!['SIGNED', 'NEGOTIATING'].includes(deal.status)) {
      return Response.json({
        error: 'Deal not ready for buyer matching',
        currentStatus: deal.status,
        requiredStatus: 'SIGNED'
      }, { status: 400 });
    }

    // Get all verified buyers
    const buyers = await sql`
      SELECT * FROM buyers
      WHERE organization_id = ${organization.id} AND verified = true
      ORDER BY closed_deals DESC
    `;

    if (buyers.length === 0) {
      return Response.json({
        matches: [],
        message: 'No verified buyers in network',
      });
    }

    // Score and rank buyers with tier-based sorting
    const matches: BuyerMatch[] = buyers
      .map((buyer: any) => {
        const { score, reasons, tier, earnestMoney, priority } = calculateMatchScore(buyer, deal);
        return {
          buyerId: buyer.id,
          name: buyer.name,
          email: buyer.email,
          phone: buyer.phone,
          matchScore: score,
          matchReasons: reasons,
          verified: buyer.verified,
          closedDeals: buyer.closed_deals || 0,
          tier,
          earnestMoney,
          priority,
        };
      })
      .filter((m: BuyerMatch) => m.matchScore >= 30)
      // Sort by tier first (VIP > VERIFIED > PROSPECT > UNVERIFIED), then by score
      .sort((a: BuyerMatch, b: BuyerMatch) => {
        const tierOrder: Record<BuyerTier, number> = { VIP: 4, VERIFIED: 3, PROSPECT: 2, UNVERIFIED: 1 };
        const tierDiff = (tierOrder[b.tier] || 0) - (tierOrder[a.tier] || 0);
        if (tierDiff !== 0) return tierDiff;
        return b.matchScore - a.matchScore;
      })
      .slice(0, 10);

    // Notify top matching buyers
    if (notifyBuyers && matches.length > 0) {
      const metadata = deal.metadata || {};
      const address = metadata.address || metadata.property_address || 'Property';
      const price = metadata.purchase_price || metadata.offer_price || 100000;
      const assignmentFee = metadata.assignment_fee || Math.min(20000, price * 0.1);
      const totalPrice = price + assignmentFee;

      for (const match of matches.slice(0, 5)) {
        await sendEmail(organization.id, {
          to: match.email,
          subject: `New Deal Available: ${address}`,
          text: `New Investment Opportunity\n\n${address}\n$${totalPrice.toLocaleString()}\n\nPurchase: $${price.toLocaleString()} + Assignment: $${assignmentFee.toLocaleString()}\n\nDeal ID: ${dealId}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2>New Investment Opportunity</h2>

              <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">${address}</h3>
                <p style="font-size: 24px; color: #2e7d32; font-weight: bold;">$${totalPrice.toLocaleString()}</p>
                <p style="color: #666;">Purchase: $${price.toLocaleString()} + Assignment: $${assignmentFee.toLocaleString()}</p>
              </div>

              <h3>Why This Deal?</h3>
              <ul>
                ${match.matchReasons.map(r => `<li>${r}</li>`).join('')}
              </ul>

              <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0;"><strong>Ready to move?</strong> Reply to this email or click below to express interest.</p>
              </div>

              <p style="color: #666; font-size: 12px;">Deal ID: ${dealId}</p>
            </div>
          `,
        }).catch(e => console.error(`Failed to notify buyer ${match.email}:`, e));
      }

      console.log(`[BUYER-MATCH] Deal ${dealId}: Notified ${Math.min(5, matches.length)} buyers`);
    }

    // Notify admin of matches via alert system
    const propertyAddress = deal.metadata?.address || deal.metadata?.property_address || 'N/A';
    await alertBuyersMatched(
      dealId,
      propertyAddress,
      matches.length,
      matches.slice(0, 5).map(m => `${m.name} (${m.tier})`)
    ).catch(console.error);

    // Separate VIP buyers for exclusive first-look (2hr window)
    const vipBuyers = matches.filter(m => m.tier === 'VIP');
    const otherBuyers = matches.filter(m => m.tier !== 'VIP');

    return Response.json({
      dealId,
      matches,
      vipBuyers: vipBuyers.length,
      notified: notifyBuyers ? Math.min(5, matches.length) : 0,
      message: `Found ${matches.length} matching buyers (${vipBuyers.length} VIP with first-look)`,
      tierBreakdown: {
        VIP: vipBuyers.length,
        VERIFIED: matches.filter(m => m.tier === 'VERIFIED').length,
        PROSPECT: matches.filter(m => m.tier === 'PROSPECT').length,
        UNVERIFIED: matches.filter(m => m.tier === 'UNVERIFIED').length,
      },
    });
  } catch (error: any) {
    console.error('[BUYER-MATCH] Error:', error);
    return Response.json({ error: 'Failed to match buyers' }, { status: 500 });
  }
}
