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

/**
 * CONTEXT-TRUTHFUL contract summary for the deal-completion flow.
 *
 * This used to INVENT numbers: when `deal.metadata` lacked a recorded price it
 * defaulted to `100000`, fabricated an ARV of `price * 1.4`, invented an
 * assignment fee of `Math.min(20000, price * 0.1)`, a fake `'Property Address'`,
 * and a `+14 days` closing date — then the confirm path emailed those invented
 * figures as if they were the deal's real "Assignment Fee". That is exactly the
 * fabricated-data defect class the matrix flags as unacceptable (SET H2, R1–R7):
 * a page/email that returns 200 while showing numbers the system never knew.
 *
 * RULE (matches `plainContractSummary.ts`): every financial field is either the
 * value the system actually recorded or `null`. Nothing is derived from a
 * guessed price, and no derived figure (ARV, fee, buyer total, profit, closing
 * date) is asserted when its inputs are unknown. `hasCompleteFinancials` lets
 * callers tell an honest "not recorded" apart from a real number so a UI/email
 * can never present a guess as fact.
 */
export interface ContractSummary {
  dealId: string;
  propertyAddress: string | null;
  purchasePrice: number | null;
  assignmentFee: number | null;
  buyerPays: number | null;
  sellerReceives: number | null;
  potentialProfit: number | null;
  closingDate: string | null;
  whyGoodDeal: string[];
  hasCompleteFinancials: boolean;
}

/** Coerce a raw metadata value to a finite number or null (never a guess). */
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function generateSimpleSummary(deal: any): ContractSummary {
  // price: only a RECORDED purchase/offer price. No 100000 fallback.
  const purchasePrice =
    numOrNull(deal?.metadata?.purchase_price) ??
    numOrNull(deal?.metadata?.offer_price);
  const arv =
    numOrNull(deal?.metadata?.arv) ?? numOrNull(deal?.metadata?.estimated_value);
  // assignment fee: only a RECORDED fee. No Math.min(20000, price*0.1) guess.
  const assignmentFee = numOrNull(deal?.metadata?.assignment_fee);

  // Derived figures are computed only when every input is real; otherwise null.
  const buyerPays =
    purchasePrice !== null && assignmentFee !== null
      ? purchasePrice + assignmentFee
      : null;
  const potentialProfit =
    arv !== null && buyerPays !== null ? arv - buyerPays : null;

  const propertyAddress =
    deal?.metadata?.address || deal?.metadata?.property_address || null;
  const closingDate = deal?.metadata?.closing_date || null;

  const whyGoodDeal: string[] = [];
  if (buyerPays !== null) whyGoodDeal.push(`You pay $${buyerPays.toLocaleString()} total`);
  if (arv !== null) whyGoodDeal.push(`Property worth ~$${arv.toLocaleString()} after repairs`);
  if (potentialProfit !== null)
    whyGoodDeal.push(`Potential profit: $${potentialProfit.toLocaleString()}`);
  if (closingDate) whyGoodDeal.push(`Closing on ${closingDate}`);

  return {
    dealId: deal.id,
    propertyAddress,
    purchasePrice,
    assignmentFee,
    buyerPays,
    sellerReceives: purchasePrice, // seller receives the recorded contract price
    potentialProfit,
    closingDate,
    whyGoodDeal,
    hasCompleteFinancials: purchasePrice !== null && assignmentFee !== null,
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

    // Check payment status — FIX (HIGH/FIN #46): the pre-check validated the org-scoped
    // lead, so the payment lookup must be bound to the same org; otherwise tenant B's
    // payment for the same deal id authenticates tenant A's signing flow.
    const [payment] = await sql`
      SELECT * FROM payments WHERE deal_id = ${dealId}
        AND organization_id = ${organization.id}
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

    // CRITICAL: Check payment before allowing any action — FIX (HIGH/FIN #46b): same
    // org-bound guarantee as the GET gate; a foreign tenant's payment row must never
    // satisfy this tenant's payment gate.
    const [payment] = await sql`
      SELECT * FROM payments WHERE deal_id = ${dealId}
        AND organization_id = ${organization.id}
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

    // Handle sign action - ATOMIC TRANSACTION
    if (action === 'sign') {
      const assignmentId = crypto.randomUUID();

      // Use transaction for atomicity — FIX (HIGH #47): every write binds the validated
      // org (deal was fetched org-scoped at POST entry), so a bare id can never flip
      // another tenant's lead or confirm another tenant's assignment.
      await sql.transaction([
        sql`UPDATE leads SET status = 'ASSIGNED', updated_at = NOW() WHERE id = ${dealId} AND organization_id = ${organization.id}`,
        ...(buyerId ? [sql`
          INSERT INTO buyer_assignments (id, organization_id, lead_id, buyer_id, status, created_at)
          VALUES (${assignmentId}, ${organization.id}, ${dealId}, ${buyerId}, 'signed', NOW())
          ON CONFLICT (lead_id, buyer_id) DO UPDATE SET
            status = 'signed',
            updated_at = NOW()
        `] : []),
      ]);

      // Record stage transition (best-effort, outside transaction)
      const { recordStageTransition } = await import('@/app/api/services/stageTransitionRecorder');
      await recordStageTransition({
        leadId: dealId,
        fromStage: deal.status,
        toStage: 'ASSIGNED',
        channel: 'contract',
      }).catch(() => {});

      console.log(`[DEAL] ${dealId} signed by buyer ${buyerId}`);
      return Response.json({ status: 'ASSIGNED', message: 'Assignment contract signed' });
    }

    // Handle confirm action (final step) - ATOMIC TRANSACTION
    if (action === 'confirm') {
      if (deal.status !== 'ASSIGNED') {
        return Response.json({ error: 'Deal must be signed before confirming' }, { status: 400 });
      }

      // Use transaction for atomicity — FIX (HIGH #47): same org-bound guarantee as sign.
      await sql.transaction([
        sql`UPDATE leads SET status = 'CLOSED_WON', updated_at = NOW() WHERE id = ${dealId} AND organization_id = ${organization.id}`,
        sql`UPDATE buyer_assignments SET status = 'confirmed', updated_at = NOW() WHERE lead_id = ${dealId} AND organization_id = ${organization.id}`,
      ]);

      // Record stage transition (best-effort, outside transaction)
      const { recordStageTransition } = await import('@/app/api/services/stageTransitionRecorder');
      await recordStageTransition({
        leadId: dealId,
        fromStage: 'ASSIGNED',
        toStage: 'CLOSED_WON',
        channel: 'contract',
      }).catch(() => {});

      const summary = generateSimpleSummary(deal);

      // Honest email: only assert figures the system actually recorded. When the
      // assignment fee was never recorded, say so explicitly rather than emailing
      // a fabricated "$0" or invented fee as if it were collected (this path
      // previously emailed Math.min(20000, price*0.1) for a deal with no recorded
      // fee). currency() renders "not recorded" for null so the operator email
      // can never present a guess as a collected amount.
      const currency = (n: number | null) => (n === null ? 'not recorded' : `$${n.toLocaleString()}`);
      const feeLine = summary.assignmentFee === null
        ? 'not recorded — see deal metadata'
        : `$${summary.assignmentFee.toLocaleString()}`;

      // Send confirmation email with assignment fee notification
      await sendEmail(organization.id, {
        to: 'roman.shumate@dealswiftautomation.com',
        subject: `[DealFlow] DEAL CLOSED - Assignment Fee: ${feeLine}`,
        text: `Deal closed for ${summary.propertyAddress ?? 'property (address not recorded)'}. Assignment Fee: ${feeLine}`,
        html: `
          <h2 style="color: green;">Deal Closed Successfully!</h2>

          <h3>Assignment Fee Collected</h3>
          <p style="font-size: 24px; font-weight: bold; color: green;">${feeLine}</p>

          <h3>Deal Summary</h3>
          <table style="border-collapse: collapse; width: 100%;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Property</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${summary.propertyAddress ?? 'not recorded'}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Purchase Price</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${currency(summary.purchasePrice)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Assignment Fee</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${currency(summary.assignmentFee)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Buyer Total</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${currency(summary.buyerPays)}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Closing Date</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${summary.closingDate ?? 'not recorded'}</td></tr>
          </table>

          <p style="margin-top: 20px;"><strong>Time:</strong> ${new Date().toISOString()}</p>
        `,
      }).catch(console.error);

      console.log(`[DEAL] ${dealId} CLOSED_WON - Fee: ${feeLine}`);

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
