/**
 * Buyer Matching API
 * Automatically finds interested buyers after seller signs
 *
 * Features:
 * - Regional fee calculation with state-specific adjustments
 * - VIP exclusivity window (2hr first look)
 * - State-specific disclosure footers for compliance
 * - Parallel email notifications for performance
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
import { calculateRegionalFee, USState } from '@/app/api/utils/regional-fee-engine';
import { generateComplianceFooter } from '@/app/api/compliance/regional-rules';
import { scheduleVipWindowExpiration } from '@/app/api/utils/vipWindowHandler';

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
  // Note: Using actual column names from buyers table schema
  const signals: BuyerSignals = {
    cashPurchases: buyer.cash_buyer || buyer.payment_method === 'cash',
    purchasesLast12Months: buyer.actual_close_count || 0, // actual_close_count tracks closed deals
    llcOrEntity: buyer.name?.includes('LLC') || buyer.name?.includes('Inc') || buyer.name?.includes('Corp'),
    verifiedProofOfFunds: buyer.pof_submitted || buyer.verified,
    previousClosedDeal: (buyer.actual_close_count || 0) > 0,
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

    // [MEDIUM FIX] Include semi-verified buyers (POF submitted but not fully verified)
    // This expands the buyer pool to catch serious prospects who may have POF but not fully verified
    const buyers = await sql`
      SELECT * FROM buyers
      WHERE organization_id = ${organization.id}
        AND (verified = true OR pof_submitted = true)
      ORDER BY verified DESC, actual_close_count DESC
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
          closedDeals: buyer.actual_close_count || 0,
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

      // [HIGH FIX] Use regional fee engine instead of simplistic formula
      // Industry benchmark: 5-10% with $5K-$35K range
      const state = (metadata.property_state || 'TX') as USState;
      const regionalFee = calculateRegionalFee({
        state,
        propertyValueDollars: price,
        isDistressed: metadata.is_distressed || false,
      });
      const assignmentFee = metadata.assignment_fee || Math.round(regionalFee.targetFeeCents / 100);
      const totalPrice = price + assignmentFee;

      // [COMPLIANCE] Generate state-specific disclosure footer
      const complianceFooter = generateComplianceFooter(
        state,
        process.env.COMPANY_ADDRESS || '123 Main St, Dallas, TX 75201',
        `${process.env.NEXTAUTH_URL || 'https://app.dealflow.ai'}/unsubscribe?dealId=${dealId}`,
        metadata.is_distressed || false
      );

      // [REVENUE OPTIMIZATION] VIP exclusivity window implementation
      // Only notify VIP buyers first, store window end timestamp
      const vipBuyers = matches.filter(m => m.tier === 'VIP');
      const otherBuyers = matches.filter(m => m.tier !== 'VIP');
      const vipWindowEndTime = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

      // Store VIP window end time and schedule job to notify non-VIP buyers after window expires
      if (vipBuyers.length > 0 && otherBuyers.length > 0) {
        await sql`
          UPDATE leads SET
            metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{vip_window_end}',
              ${JSON.stringify(vipWindowEndTime.toISOString())}::jsonb
            ),
            updated_at = NOW()
          WHERE id = ${dealId}
        `.catch(console.error);

        // [REVENUE OPTIMIZATION] Schedule job to notify non-VIP buyers after 2hr VIP window
        await scheduleVipWindowExpiration(dealId, organization.id, 2 * 60 * 60 * 1000).catch(console.error);
      }

      // Determine which buyers to notify now (VIP only if we have VIPs, otherwise top 5)
      const buyersToNotify = vipBuyers.length > 0
        ? vipBuyers.slice(0, 5)
        : matches.slice(0, 5);

      // [LOW FIX] Use Promise.allSettled for parallel email sending (reduces latency)
      const emailPromises = buyersToNotify.map(match => {
        const isVip = match.tier === 'VIP';
        const exclusivityNote = isVip
          ? `<div style="background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0;">
              <strong>VIP Exclusive:</strong> You have first access for 2 hours.
            </div>`
          : '';

        return sendEmail(organization.id, {
          to: match.email,
          subject: `${isVip ? '[VIP] ' : ''}New Deal Available: ${address}`,
          text: `New Investment Opportunity\n\n${address}\n$${totalPrice.toLocaleString()}\n\nPurchase: $${price.toLocaleString()} + Assignment: $${assignmentFee.toLocaleString()}\n\nDeal ID: ${dealId}\n\nThis is a contract assignment opportunity.`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px;">
              <h2>New Investment Opportunity</h2>
              ${exclusivityNote}

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

              ${complianceFooter}
            </div>
          `,
        }).catch(e => {
          console.error(`Failed to notify buyer ${match.email}:`, e);
          return { status: 'rejected', reason: e };
        });
      });

      await Promise.allSettled(emailPromises);

      console.log(`[BUYER-MATCH] Deal ${dealId}: Notified ${buyersToNotify.length} buyers (${vipBuyers.length} VIP with 2hr exclusive window)`);
    }

    // Notify admin of matches via alert system
    const propertyAddress = deal.metadata?.address || deal.metadata?.property_address || 'N/A';
    await alertBuyersMatched(
      dealId,
      propertyAddress,
      matches.length,
      matches.slice(0, 5).map(m => `${m.name} (${m.tier})`)
    ).catch(console.error);

    // VIP buyers already separated above for notification logic
    const vipBuyersResult = matches.filter(m => m.tier === 'VIP');
    const otherBuyersResult = matches.filter(m => m.tier !== 'VIP');

    return Response.json({
      dealId,
      matches,
      vipBuyers: vipBuyersResult.length,
      notified: notifyBuyers ? Math.min(5, matches.length) : 0,
      vipWindowEnd: vipBuyersResult.length > 0 ? new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() : null,
      message: `Found ${matches.length} matching buyers (${vipBuyersResult.length} VIP with first-look)`,
      tierBreakdown: {
        VIP: vipBuyersResult.length,
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
