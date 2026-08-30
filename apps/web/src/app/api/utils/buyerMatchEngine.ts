/**
 * Buyer Match Engine
 *
 * Automatically matches and notifies buyers when a seller signs a purchase agreement.
 * This engine is triggered by the job queue when `match_buyers_auto` jobs are processed.
 *
 * Flow:
 * 1. Seller signs purchase agreement → esign webhook fires
 * 2. Job queued: match_buyers_auto
 * 3. This engine: match buyers by region/criteria → notify VIPs first → schedule non-VIP window
 *
 * This closes the gap where buyer matching was manual-only.
 */

import sql from '@/app/api/utils/sql';
import { sendEmailAuto as sendEmail } from '@/app/api/utils/emailProviders';
import { sendPipelineSMS } from '@/app/api/utils/smsOutreachEngine';
import { scoreBuyer, BuyerSignals, BuyerTier, calculateEarnestAmount } from '@/app/api/prospects/scoring-engine';
import { calculateRegionalFee, USState } from '@/app/api/utils/regional-fee-engine';
import { generateComplianceFooter } from '@/app/api/compliance/regional-rules';
import { scheduleVipWindowExpiration } from '@/app/api/utils/vipWindowHandler';
import { alertBuyersMatched } from '@/app/api/alerts/notification-engine';
import { enqueueJob } from '@/app/api/utils/jobs';

export interface MatchBuyersParams {
  dealId: string;
  organizationId: string;
  propertyAddress?: string;
  purchasePrice?: number;
  notifyBuyers?: boolean;
}

export interface MatchBuyersResult {
  matchedCount: number;
  notifiedCount: number;
  vipCount: number;
  skippedReason?: string;
}

interface BuyerMatch {
  buyerId: string;
  name: string;
  email: string;
  phone?: string;
  matchScore: number;
  matchReasons: string[];
  tier: BuyerTier;
}

function calculateMatchScore(buyer: any, deal: any): {
  score: number;
  reasons: string[];
  tier: BuyerTier;
} {
  const metadata = deal.metadata || {};
  const dealZip = metadata.zip || metadata.property_zip;
  const dealPrice = metadata.purchase_price || metadata.offer_price || 100000;
  const dealType = metadata.property_type || 'single_family';

  const signals: BuyerSignals = {
    cashPurchases: buyer.cash_buyer || buyer.payment_method === 'cash',
    purchasesLast12Months: buyer.actual_close_count || 0,
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

  const buyerScore = scoreBuyer(signals);
  const reasons: string[] = [...buyerScore.signals];

  if (signals.zipCodeMatch) {
    reasons.push(`Matches zip code: ${dealZip}`);
  }

  return {
    score: buyerScore.score,
    reasons,
    tier: buyerScore.tier,
  };
}

export async function matchAndNotifyBuyers(params: MatchBuyersParams): Promise<MatchBuyersResult> {
  const { dealId, organizationId, notifyBuyers = true } = params;

  // Get deal details
  const [deal] = await sql`
    SELECT * FROM leads WHERE id = ${parseInt(dealId, 10)} AND organization_id = ${organizationId}
  `.catch(() => [null]);

  if (!deal) {
    return { matchedCount: 0, notifiedCount: 0, vipCount: 0, skippedReason: 'deal_not_found' };
  }

  // Get all verified/semi-verified buyers for this org
  const buyers = await sql`
    SELECT * FROM buyers
    WHERE organization_id = ${organizationId}
      AND (verified = true OR pof_submitted = true)
    ORDER BY verified DESC, actual_close_count DESC
  `.catch(() => []);

  if (buyers.length === 0) {
    return { matchedCount: 0, notifiedCount: 0, vipCount: 0, skippedReason: 'no_verified_buyers' };
  }

  // Score and rank buyers
  const matches: BuyerMatch[] = buyers
    .map((buyer: any) => {
      const { score, reasons, tier } = calculateMatchScore(buyer, deal);
      return {
        buyerId: buyer.id,
        name: buyer.name,
        email: buyer.email,
        phone: buyer.phone,
        matchScore: score,
        matchReasons: reasons,
        tier,
      };
    })
    .filter((m: BuyerMatch) => m.matchScore >= 30)
    .sort((a: BuyerMatch, b: BuyerMatch) => {
      const tierOrder: Record<BuyerTier, number> = { VIP: 4, VERIFIED: 3, PROSPECT: 2, UNVERIFIED: 1 };
      const tierDiff = (tierOrder[b.tier] || 0) - (tierOrder[a.tier] || 0);
      if (tierDiff !== 0) return tierDiff;
      return b.matchScore - a.matchScore;
    })
    .slice(0, 10);

  if (matches.length === 0) {
    return { matchedCount: 0, notifiedCount: 0, vipCount: 0, skippedReason: 'no_matching_buyers' };
  }

  let notifiedCount = 0;
  const vipBuyers = matches.filter(m => m.tier === 'VIP');
  const otherBuyers = matches.filter(m => m.tier !== 'VIP');

  if (notifyBuyers) {
    const metadata = deal.metadata || {};
    const address = params.propertyAddress || metadata.address || metadata.property_address || 'Property';
    const price = params.purchasePrice || metadata.purchase_price || metadata.offer_price || 100000;

    // Calculate regional fee
    const state = (metadata.property_state || 'TX') as USState;
    const regionalFee = calculateRegionalFee({
      state,
      propertyValueDollars: price,
      isDistressed: metadata.is_distressed || false,
    });
    const assignmentFee = metadata.assignment_fee || Math.round(regionalFee.targetFeeCents / 100);
    const totalPrice = price + assignmentFee;

    // Compliance footer
    const complianceFooter = generateComplianceFooter(
      state,
      process.env.COMPANY_ADDRESS || '123 Main St, Dallas, TX 75201',
      `${process.env.NEXTAUTH_URL || 'https://app.dealflow.ai'}/unsubscribe?dealId=${dealId}`,
      metadata.is_distressed || false
    );

    // Schedule VIP window if we have both VIP and non-VIP buyers
    if (vipBuyers.length > 0 && otherBuyers.length > 0) {
      const vipWindowEndTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
      await sql`
        UPDATE leads SET
          metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{vip_window_end}',
            ${JSON.stringify(vipWindowEndTime.toISOString())}::jsonb
          ),
          updated_at = NOW()
        WHERE id = ${parseInt(dealId, 10)}
      `.catch(console.error);

      await scheduleVipWindowExpiration(dealId, organizationId, 2 * 60 * 60 * 1000).catch(console.error);
    }

    // Notify VIP buyers first (or all if no VIPs)
    const buyersToNotify = vipBuyers.length > 0 ? vipBuyers.slice(0, 5) : matches.slice(0, 5);

    const notifications = buyersToNotify.map(async (match) => {
      const isVip = match.tier === 'VIP';
      const exclusivityNote = isVip
        ? `<div style="background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0;">
            <strong>VIP Exclusive:</strong> You have first access for 2 hours.
          </div>`
        : '';

      // Send email
      await sendEmail(organizationId, {
        to: match.email,
        subject: `${isVip ? '[VIP] ' : ''}New Deal Available: ${address}`,
        text: `New Investment Opportunity\n\n${address}\n$${totalPrice.toLocaleString()}\n\nPurchase: $${price.toLocaleString()} + Assignment: $${assignmentFee.toLocaleString()}\n\nDeal ID: ${dealId}`,
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
            <ul>${match.matchReasons.map(r => `<li>${r}</li>`).join('')}</ul>
            <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Ready to move?</strong> Reply to this email or call us.</p>
            </div>
            <p style="color: #666; font-size: 12px;">Deal ID: ${dealId}</p>
            ${complianceFooter}
          </div>
        `,
      }).catch(console.error);

      // Also send SMS if phone available
      if (match.phone) {
        await sendPipelineSMS({
          to: match.phone,
          message: `${isVip ? '[VIP] ' : ''}New deal: ${address} - $${totalPrice.toLocaleString()}. Reply YES to claim. Deal ID: ${dealId}`,
          leadId: dealId,
          organizationId,
          channel: 'buyer',
        }).catch(console.error);
      }

      return match;
    });

    const results = await Promise.allSettled(notifications);
    notifiedCount = results.filter(r => r.status === 'fulfilled').length;

    // Record buyer assignments as "notified" status
    for (const match of buyersToNotify) {
      await sql`
        INSERT INTO buyer_assignments (
          id, lead_id, buyer_id, status, assignment_fee_cents, organization_id, created_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${parseInt(dealId, 10)},
          ${match.buyerId},
          'notified',
          ${assignmentFee * 100},
          ${organizationId},
          NOW()
        )
        ON CONFLICT (lead_id, buyer_id) DO UPDATE SET status = 'notified', updated_at = NOW()
      `.catch(console.error);
    }
  }

  // Alert owner
  await alertBuyersMatched(
    dealId,
    params.propertyAddress || 'Property',
    matches.length,
    matches.slice(0, 5).map(m => `${m.name} (${m.tier})`)
  ).catch(console.error);

  console.log(`[BUYER-MATCH-ENGINE] Deal ${dealId}: ${matches.length} matched, ${notifiedCount} notified (${vipBuyers.length} VIP)`);

  // AUTO-DISCOVERY: If < 5 matches or no VIP buyers, trigger buyer discovery from public records
  const needsDiscovery = matches.length < 5 || vipBuyers.length === 0;
  if (needsDiscovery && deal) {
    const metadata = deal.metadata || {};
    const propertyZip = metadata.zip || metadata.property_zip;
    const propertyState = metadata.property_state || 'KY';
    const price = params.purchasePrice || metadata.purchase_price || metadata.offer_price || 100000;

    if (propertyZip) {
      await enqueueJob('discover_buyers_auto', {
        dealId,
        organizationId,
        propertyZip,
        propertyCounty: metadata.property_county,
        propertyState,
        priceRange: { min: price * 0.7, max: price * 1.5 },
        propertyType: metadata.property_type,
        limit: 50,
      }, {
        maxAttempts: 3,
        dedupeKey: `buyer_discovery_${dealId}`,
      }).catch(console.error);

      console.log(`[BUYER-MATCH-ENGINE] Deal ${dealId}: Queued buyer discovery (matches=${matches.length}, vips=${vipBuyers.length})`);
    }
  }

  return {
    matchedCount: matches.length,
    notifiedCount,
    vipCount: vipBuyers.length,
  };
}
