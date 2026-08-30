/**
 * Campaign Auto-Launch API
 *
 * POST /api/campaigns/auto-launch
 *
 * Creates a complete campaign targeting N assignment contracts.
 * Automatically:
 * 1. Calculates required seller + buyer leads
 * 2. Generates leads from public records if inventory short
 * 3. Creates seller and buyer campaigns with proper sequences
 * 4. Ensures every region has sufficient buyer coverage
 * 5. Starts outreach immediately
 *
 * Body:
 * {
 *   targetDeals: number,           // 1-30 assignment contracts
 *   regions?: string[],            // Target states/counties (default: ['KY'])
 *   autoGenerateLeads?: boolean,   // Generate leads if short (default: true)
 *   autoDiscoverBuyers?: boolean,  // Auto-discover buyers per region (default: true)
 *   assignmentFee?: number,        // Expected fee per deal (default: $10,000)
 * }
 */

import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';
import { sizeCampaign } from '@/app/api/lead-finder/utils/planner';

interface LaunchRequest {
  targetDeals: number;
  regions?: string[];
  autoGenerateLeads?: boolean;
  autoDiscoverBuyers?: boolean;
  assignmentFee?: number;
}

const DEFAULT_ASSIGNMENT_FEE = 1000000; // $10,000 in cents
const MIN_BUYERS_PER_REGION = 20; // Ensure at least 20 buyers per region

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  let body: LaunchRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    targetDeals,
    regions = ['KY'],
    autoGenerateLeads = true,
    autoDiscoverBuyers = true,
    assignmentFee = DEFAULT_ASSIGNMENT_FEE,
  } = body;

  if (!targetDeals || targetDeals < 1 || targetDeals > 30) {
    return Response.json({ error: 'targetDeals must be between 1 and 30' }, { status: 400 });
  }

  try {
    // Calculate lead requirements
    const sizing = sizeCampaign({ targetDeals });
    const sellersNeeded = sizing.sellersNeeded;
    const buyersNeeded = Math.max(sizing.buyersNeeded, MIN_BUYERS_PER_REGION * regions.length);

    // Check current inventory
    const [sellerInv] = await sql`
      SELECT COUNT(*)::int as count FROM leads
      WHERE organization_id = ${organization.id}
        AND type = 'seller'
        AND status IN ('NEW', 'CONTACTED')
    `.catch(() => [{ count: 0 }]);

    const [buyerInv] = await sql`
      SELECT COUNT(*)::int as count FROM buyers
      WHERE organization_id = ${organization.id}
    `.catch(() => [{ count: 0 }]);

    const availableSellers = sellerInv?.count || 0;
    const availableBuyers = buyerInv?.count || 0;

    const sellerShortfall = Math.max(0, sellersNeeded - availableSellers);
    const buyerShortfall = Math.max(0, buyersNeeded - availableBuyers);

    // Generate leads if needed
    let sellersGenerated = 0;
    let buyersGenerated = 0;

    if (autoGenerateLeads && sellerShortfall > 0) {
      // Queue seller lead generation job
      await enqueueJob('generate_seller_leads', {
        organizationId: organization.id,
        count: sellerShortfall,
        regions,
        targetDeals,
      }, { maxAttempts: 3 });
      sellersGenerated = sellerShortfall;
    }

    if (autoDiscoverBuyers) {
      // Ensure minimum buyer coverage per region
      for (const region of regions) {
        const [regionBuyers] = await sql`
          SELECT COUNT(*)::int as count FROM buyers
          WHERE organization_id = ${organization.id}
            AND (
              zip_codes::text ILIKE ${'%' + region + '%'}
              OR metadata->>'state' = ${region}
              OR metadata->>'region' = ${region}
            )
        `.catch(() => [{ count: 0 }]);

        const regionCount = regionBuyers?.count || 0;
        if (regionCount < MIN_BUYERS_PER_REGION) {
          const needed = MIN_BUYERS_PER_REGION - regionCount;
          await enqueueJob('generate_buyer_leads_region', {
            organizationId: organization.id,
            region,
            count: needed,
            priceRange: { min: 50000, max: 500000 },
          }, {
            maxAttempts: 3,
            dedupeKey: `buyer_gen_${organization.id}_${region}`,
          });
          buyersGenerated += needed;
        }
      }

      // Also generate any remaining shortfall
      if (buyerShortfall > buyersGenerated) {
        await enqueueJob('generate_buyer_leads', {
          organizationId: organization.id,
          count: buyerShortfall - buyersGenerated,
          regions,
        }, { maxAttempts: 3 });
        buyersGenerated = buyerShortfall;
      }
    }

    // Create seller campaign
    const sellerCampaignId = crypto.randomUUID();
    await sql`
      INSERT INTO outreach_campaigns (
        id, organization_id, name, status, type, target_type,
        settings, created_at
      ) VALUES (
        ${sellerCampaignId},
        ${organization.id},
        ${`${targetDeals}-Deal Campaign - Sellers`},
        'DRAFT',
        'MULTI_TOUCH',
        'seller',
        ${JSON.stringify({
          targetDeals,
          regions,
          assignmentFee,
          autoGenerated: true,
          sellersNeeded,
          sequence: ['sms', 'email', 'sms', 'email', 'sms'],
          touchIntervalHours: [0, 24, 48, 72, 120],
        })},
        NOW()
      )
    `;

    // Create buyer campaign
    const buyerCampaignId = crypto.randomUUID();
    await sql`
      INSERT INTO outreach_campaigns (
        id, organization_id, name, status, type, target_type,
        settings, created_at
      ) VALUES (
        ${buyerCampaignId},
        ${organization.id},
        ${`${targetDeals}-Deal Campaign - Buyers`},
        'DRAFT',
        'MULTI_TOUCH',
        'buyer',
        ${JSON.stringify({
          targetDeals,
          regions,
          assignmentFee,
          autoGenerated: true,
          buyersNeeded,
          sequence: ['email', 'sms', 'email', 'sms'],
          touchIntervalHours: [0, 24, 72, 168],
        })},
        NOW()
      )
    `;

    // Create message templates for seller campaign
    const sellerTemplates = [
      {
        kind: 'OPENING',
        channel: 'sms',
        sequenceOrder: 1,
        subject: null,
        body: `Hi {first_name}, I noticed your property at {address}. We buy houses for cash and can close in 2 weeks. Would you consider an offer? Reply YES or call me.`,
      },
      {
        kind: 'FOLLOW_UP',
        channel: 'email',
        sequenceOrder: 2,
        subject: 'Quick Question About {address}',
        body: `Hi {first_name},\n\nI reached out yesterday about your property at {address}. We're actively buying in your area and pay cash.\n\nIf you're thinking about selling, I'd love to make you a fair offer with no fees or repairs needed.\n\nWould a quick call work for you this week?\n\nBest,\n{sender_name}`,
      },
      {
        kind: 'FOLLOW_UP',
        channel: 'sms',
        sequenceOrder: 3,
        subject: null,
        body: `Hi {first_name}, following up on {address}. We can close on your timeline and pay all closing costs. Any interest in hearing our cash offer?`,
      },
      {
        kind: 'FOLLOW_UP',
        channel: 'email',
        sequenceOrder: 4,
        subject: 'Still Interested in {address}',
        body: `Hi {first_name},\n\nJust wanted to follow up one more time about {address}.\n\nWe've helped many homeowners in your area sell quickly without the hassle of repairs, showings, or agent fees.\n\nIf your situation has changed or you're ready to explore options, just reply to this email.\n\nBest,\n{sender_name}`,
      },
      {
        kind: 'FOLLOW_UP',
        channel: 'sms',
        sequenceOrder: 5,
        subject: null,
        body: `{first_name}, last message about {address}. We have cash buyers ready. If you ever want to sell, my offer stands. Just reply anytime.`,
      },
    ];

    for (const tmpl of sellerTemplates) {
      await sql`
        INSERT INTO campaign_message_templates (
          id, campaign_id, kind, channel, sequence_order, subject, body, is_active
        ) VALUES (
          ${crypto.randomUUID()},
          ${sellerCampaignId},
          ${tmpl.kind},
          ${tmpl.channel},
          ${tmpl.sequenceOrder},
          ${tmpl.subject},
          ${tmpl.body},
          true
        )
      `.catch(console.error);
    }

    // Create message templates for buyer campaign
    const buyerTemplates = [
      {
        kind: 'OPENING',
        channel: 'email',
        sequenceOrder: 1,
        subject: 'Investment Opportunity in {region}',
        body: `Hi {first_name},\n\nI noticed you're an active investor in the {region} area. We consistently source off-market deals at 20-30% below market value.\n\nWe're looking for reliable cash buyers to add to our VIP list for first access to deals.\n\nInterested in seeing what we have? Just reply "YES" and I'll send over our current inventory.\n\nBest,\n{sender_name}`,
      },
      {
        kind: 'FOLLOW_UP',
        channel: 'sms',
        sequenceOrder: 2,
        subject: null,
        body: `Hi {first_name}, I sent you an email about off-market deals in {region}. We have properties 20-30% below market. Reply YES if you want first access.`,
      },
      {
        kind: 'FOLLOW_UP',
        channel: 'email',
        sequenceOrder: 3,
        subject: 'Re: Investment Opportunity in {region}',
        body: `Hi {first_name},\n\nJust following up on my previous message. We're actively working with investors who can close in 2-3 weeks with cash.\n\nOur current deal flow includes:\n- Single family rehabs\n- Rental-ready properties\n- Wholesale assignments\n\nWhat's your buy criteria? I'll match you with deals that fit.\n\nBest,\n{sender_name}`,
      },
      {
        kind: 'FOLLOW_UP',
        channel: 'sms',
        sequenceOrder: 4,
        subject: null,
        body: `{first_name}, we just locked up a deal in {region}. Looking for a cash buyer who can close in 2 weeks. Interested?`,
      },
    ];

    for (const tmpl of buyerTemplates) {
      await sql`
        INSERT INTO campaign_message_templates (
          id, campaign_id, kind, channel, sequence_order, subject, body, is_active
        ) VALUES (
          ${crypto.randomUUID()},
          ${buyerCampaignId},
          ${tmpl.kind},
          ${tmpl.channel},
          ${tmpl.sequenceOrder},
          ${tmpl.subject},
          ${tmpl.body},
          true
        )
      `.catch(console.error);
    }

    // Queue campaign start jobs
    await enqueueJob('start_campaign', {
      campaignId: sellerCampaignId,
      organizationId: organization.id,
      type: 'seller',
    }, {
      runAt: new Date(Date.now() + 5000), // Start in 5 seconds
      maxAttempts: 3,
    });

    await enqueueJob('start_campaign', {
      campaignId: buyerCampaignId,
      organizationId: organization.id,
      type: 'buyer',
    }, {
      runAt: new Date(Date.now() + 10000), // Start in 10 seconds
      maxAttempts: 3,
    });

    // Log the launch
    await logEvent('campaign_auto_launched', 'campaign', sellerCampaignId, {
      targetDeals,
      regions,
      sellersNeeded,
      buyersNeeded,
      sellersGenerated,
      buyersGenerated,
      sellerCampaignId,
      buyerCampaignId,
    }, organization.id);

    return Response.json({
      success: true,
      targetDeals,
      campaigns: {
        seller: {
          id: sellerCampaignId,
          leadsNeeded: sellersNeeded,
          leadsGenerated: sellersGenerated,
        },
        buyer: {
          id: buyerCampaignId,
          leadsNeeded: buyersNeeded,
          leadsGenerated: buyersGenerated,
        },
      },
      regions,
      estimatedRevenue: targetDeals * (assignmentFee / 100),
    });
  } catch (error: any) {
    console.error('[AUTO-LAUNCH] Error:', error);
    return Response.json({ error: error.message || 'Failed to launch campaign' }, { status: 500 });
  }
}
