/**
 * Deal Completion API
 * Enforces payment before assignment contract signing
 * Generates simple contract summaries
 * Handles the full buyer → payment → sign → confirm flow
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { sendEmailAuto as sendEmail } from '@/app/api/utils/emailProviders';

interface ContractSummary {
  dealId: string;
  propertyAddress: string;
  purchasePrice: number;
  assignmentFee: number;
  buyerPays: number;
  sellerReceives: number;
  closingDate: string;
  whyGoodDeal: string[];
}

function generateSimpleSummary(deal: any): ContractSummary {
  const purchasePrice = deal.metadata?.purchase_price || deal.metadata?.offer_price || 100000;
  const arv = deal.metadata?.arv || deal.metadata?.estimated_value || purchasePrice * 1.4;
  const assignmentFee = deal.metadata?.assignment_fee || Math.min(20000, purchasePrice * 0.1);
  const buyerPays = purchasePrice + assignmentFee;
  const potentialProfit = arv - buyerPays;

  const whyGoodDeal = [
    `You pay $${buyerPays.toLocaleString()} total`,
    `Property worth ~$${arv.toLocaleString()} after repairs`,
    `Potential profit: $${potentialProfit.toLocaleString()}`,
    `No competition - deal is locked`,
    `Close in ${deal.metadata?.closing_days || 14} days`,
  ];

  return {
    dealId: deal.id,
    propertyAddress: deal.metadata?.address || deal.metadata?.property_address || 'Property Address',
    purchasePrice,
    assignmentFee,
    buyerPays,
    sellerReceives: purchasePrice,
    closingDate: deal.metadata?.closing_date || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    whyGoodDeal,
  };
}

// Check if buyer can proceed (payment verified)
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization' }, { status: 403 });
  }

  const url = new URL(req.url);
  const dealId = url.searchParams.get('dealId');

  if (!dealId) {
    return Response.json({ error: 'dealId required' }, { status: 400 });
  }

  try {
    // Get deal info
    const [deal] = await sql`
      SELECT * FROM leads WHERE id = ${dealId} AND organization_id = ${organization.id}
    `;

    if (!deal) {
      return Response.json({ error: 'Deal not found' }, { status: 404 });
    }

    // Check payment status
    const [payment] = await sql`
      SELECT * FROM payments WHERE deal_id = ${dealId}
      ORDER BY created_at DESC LIMIT 1
    `.catch(() => [null]);

    const paymentVerified = payment && ['paid', 'verified'].includes(payment.status);

    // Generate simple summary
    const summary = generateSimpleSummary(deal);

    return Response.json({
      dealId,
      status: deal.status,
      paymentRequired: !paymentVerified,
      paymentStatus: payment?.status || 'unpaid',
      canSign: paymentVerified,
      canConfirm: paymentVerified && deal.status === 'ASSIGNED',
      summary,
    });
  } catch (error: any) {
    console.error('[DEAL-COMPLETE] Error:', error);
    return Response.json({ error: 'Failed to check deal status' }, { status: 500 });
  }
}

// Complete the deal (buyer confirms after signing)
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

  const { dealId, buyerId, action } = body;

  if (!dealId || !action) {
    return Response.json({ error: 'dealId and action required' }, { status: 400 });
  }

  try {
    // Get deal
    const [deal] = await sql`
      SELECT * FROM leads WHERE id = ${dealId} AND organization_id = ${organization.id}
    `;

    if (!deal) {
      return Response.json({ error: 'Deal not found' }, { status: 404 });
    }

    // CRITICAL: Check payment before allowing any action
    const [payment] = await sql`
      SELECT * FROM payments WHERE deal_id = ${dealId}
      ORDER BY created_at DESC LIMIT 1
    `.catch(() => [null]);

    const paymentVerified = payment && ['paid', 'verified'].includes(payment.status);

    if (action === 'sign' && !paymentVerified) {
      console.log(`[PAYMENT-GATE] BLOCKED: Deal ${dealId} - payment not verified`);
      return Response.json({
        error: 'PAYMENT REQUIRED',
        message: 'You must complete payment before signing the assignment contract',
        paymentStatus: payment?.status || 'unpaid',
        blocked: true,
      }, { status: 403 });
    }

    if (action === 'confirm' && !paymentVerified) {
      console.log(`[PAYMENT-GATE] BLOCKED: Deal ${dealId} - payment not verified`);
      return Response.json({
        error: 'PAYMENT REQUIRED',
        message: 'Payment must be verified before confirming the deal',
        blocked: true,
      }, { status: 403 });
    }

    // Handle sign action
    if (action === 'sign') {
      await sql`
        UPDATE leads SET status = 'ASSIGNED', updated_at = NOW()
        WHERE id = ${dealId}
      `;

      // [MEDIUM FIX] Schema correction: use lead_id not deal_id (matches buyer_assignments schema)
      if (buyerId) {
        await sql`
          INSERT INTO buyer_assignments (id, lead_id, buyer_id, status, created_at)
          VALUES (${crypto.randomUUID()}, ${dealId}, ${buyerId}, 'signed', NOW())
          ON CONFLICT (lead_id, buyer_id) DO UPDATE SET
            status = 'signed',
            updated_at = NOW()
        `.catch(console.error);
      }

      console.log(`[DEAL] ${dealId} signed by buyer ${buyerId}`);
      return Response.json({ status: 'ASSIGNED', message: 'Assignment contract signed' });
    }

    // Handle confirm action (final step)
    if (action === 'confirm') {
      if (deal.status !== 'ASSIGNED') {
        return Response.json({ error: 'Deal must be signed before confirming' }, { status: 400 });
      }

      await sql`
        UPDATE leads SET status = 'CLOSED_WON', updated_at = NOW()
        WHERE id = ${dealId}
      `;

      // [MEDIUM FIX] Schema correction: use lead_id not deal_id
      await sql`
        UPDATE buyer_assignments SET status = 'confirmed', updated_at = NOW()
        WHERE lead_id = ${dealId}
      `.catch(console.error);

      const summary = generateSimpleSummary(deal);

      // Send confirmation email with assignment fee notification
      await sendEmail(organization.id, {
        to: 'roman.shumate@dealswiftautomation.com',
        subject: `[DealFlow] DEAL CLOSED - Assignment Fee: $${summary.assignmentFee.toLocaleString()}`,
        text: `Deal closed for ${summary.propertyAddress}. Assignment Fee: $${summary.assignmentFee.toLocaleString()}`,
        html: `
          <h2 style="color: green;">Deal Closed Successfully!</h2>

          <h3>Assignment Fee Collected</h3>
          <p style="font-size: 24px; font-weight: bold; color: green;">$${summary.assignmentFee.toLocaleString()}</p>

          <h3>Deal Summary</h3>
          <table style="border-collapse: collapse; width: 100%;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Property</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${summary.propertyAddress}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Purchase Price</strong></td><td style="padding: 8px; border: 1px solid #ddd;">$${summary.purchasePrice.toLocaleString()}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Assignment Fee</strong></td><td style="padding: 8px; border: 1px solid #ddd;">$${summary.assignmentFee.toLocaleString()}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Buyer Total</strong></td><td style="padding: 8px; border: 1px solid #ddd;">$${summary.buyerPays.toLocaleString()}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Closing Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${summary.closingDate}</td></tr>
          </table>

          <p style="margin-top: 20px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
        `,
      }).catch(console.error);

      console.log(`[DEAL] ${dealId} CLOSED_WON - Fee: $${summary.assignmentFee}`);

      return Response.json({
        status: 'CLOSED_WON',
        message: 'Deal confirmed and closed!',
        assignmentFee: summary.assignmentFee,
        summary,
      });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[DEAL-COMPLETE] Error:', error);
    return Response.json({ error: 'Failed to complete deal' }, { status: 500 });
  }
}
