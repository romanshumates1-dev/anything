/**
 * GET /api/contracts/step-out/confirm?token=xxx
 *
 * Confirms a step-out request. Called when user clicks the link in their email.
 * Processes the step-out, notifies all parties, and updates contract status.
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { sendEmailAuto } from '@/app/api/utils/emailProviders';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';
import {
  generateSellerCancellationConfirmedEmail,
  generateBuyerNotificationOfSellerCancellation,
  generateSellerNotificationOfBuyerCancellation,
  generateDealEndedEmail,
  type StepOutParty,
} from '@/app/api/utils/step-out-engine';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return Response.json({ error: 'Confirmation token required' }, { status: 400 });
  }

  try {
    // Find the step-out request
    const [request] = await sql`
      SELECT
        r.id, r.organization_id, r.contract_id, r.party, r.reason,
        r.expires_at, r.status
      FROM step_out_requests r
      WHERE r.confirmation_token = ${token}
    `.catch(() => []);

    if (!request) {
      return Response.json({
        error: 'Invalid or expired confirmation link',
        detail: 'This link may have already been used or has expired.',
      }, { status: 404 });
    }

    if (request.status === 'confirmed') {
      return Response.json({
        error: 'Already confirmed',
        detail: 'This step-out request has already been processed.',
      }, { status: 400 });
    }

    if (new Date(request.expires_at) < new Date()) {
      return Response.json({
        error: 'Link expired',
        detail: 'This confirmation link has expired. Please submit a new step-out request.',
      }, { status: 400 });
    }

    // Get contract and party details
    const [contract] = await sql`
      SELECT
        c.id, c.status, c.inspection_days, c.created_at,
        c.seller_lead_id, c.buyer_lead_id, c.assigned_at,
        l.name as seller_name, l.email as seller_email,
        l.metadata->>'address' as property_address,
        b.name as buyer_name, b.email as buyer_email
      FROM contracts c
      LEFT JOIN leads l ON l.id = c.seller_lead_id
      LEFT JOIN buyer_leads b ON b.id = c.buyer_lead_id
      WHERE c.id = ${request.contract_id}
    `;

    if (!contract) {
      return Response.json({ error: 'Contract not found' }, { status: 404 });
    }

    const party = request.party as StepOutParty;
    const propertyAddress = contract.property_address || 'Property';

    // Mark request as confirmed
    await sql`
      UPDATE step_out_requests
      SET status = 'confirmed', confirmed_at = now()
      WHERE id = ${request.id}
    `;

    // Update contract status based on who stepped out
    // Seller step-out = CANCELLED (deal is dead)
    // Buyer step-out = PENDING_BUYER (can find replacement buyer)
    if (party === 'seller') {
      await sql`
        UPDATE contracts
        SET status = 'CANCELLED',
            cancelled_at = now(),
            cancelled_by = ${party},
            cancelled_reason = ${request.reason || 'Step-out during inspection period'}
        WHERE id = ${contract.id}
      `;
    }
    // Note: buyer step-out updates status to PENDING_BUYER below after finding replacement job is queued

    // Send appropriate emails based on who stepped out
    if (party === 'seller') {
      // Seller stepped out

      // 1. Confirm to seller
      if (contract.seller_email) {
        const sellerEmail = generateSellerCancellationConfirmedEmail({
          sellerName: contract.seller_name || 'Seller',
          propertyAddress,
        });
        await sendEmailAuto(request.organization_id, {
          to: contract.seller_email,
          subject: sellerEmail.subject,
          html: sellerEmail.bodyHtml,
          text: sellerEmail.bodyText,
        });
      }

      // 2. Notify buyer (if assigned) with empathetic explanation
      if (contract.buyer_email && contract.assigned_at) {
        const buyerEmail = generateBuyerNotificationOfSellerCancellation({
          buyerName: contract.buyer_name || 'Investor',
          sellerName: contract.seller_name || 'Seller',
          propertyAddress,
        });
        await sendEmailAuto(request.organization_id, {
          to: contract.buyer_email,
          subject: buyerEmail.subject,
          html: buyerEmail.bodyHtml,
          text: buyerEmail.bodyText,
        });

        // Queue earnest money refund if applicable
        await enqueueJob('process_earnest_money_refund', {
          organizationId: request.organization_id,
          contractId: contract.id,
          buyerId: contract.buyer_lead_id,
          reason: 'seller_step_out',
        }).catch(() => {});
      }

    } else {
      // Buyer stepped out

      // 1. Notify seller that we're finding a new buyer
      if (contract.seller_email) {
        const sellerEmail = generateSellerNotificationOfBuyerCancellation({
          sellerName: contract.seller_name || 'Seller',
          buyerName: contract.buyer_name || 'Buyer',
          propertyAddress,
        });
        await sendEmailAuto(request.organization_id, {
          to: contract.seller_email,
          subject: sellerEmail.subject,
          html: sellerEmail.bodyHtml,
          text: sellerEmail.bodyText,
        });
      }

      // 2. Queue job to find replacement buyer
      await enqueueJob('find_replacement_buyer', {
        organizationId: request.organization_id,
        contractId: contract.id,
        leadId: contract.seller_lead_id,
        previousBuyerId: contract.buyer_lead_id,
        reason: 'buyer_step_out',
      }).catch(() => {});

      // 3. Mark contract as unassigned but still active
      await sql`
        UPDATE contracts
        SET status = 'PENDING_BUYER',
            buyer_lead_id = NULL,
            assigned_at = NULL
        WHERE id = ${contract.id}
      `;
    }

    // Send deal-ended confirmation to initiator
    const initiatorEmail = party === 'seller' ? contract.seller_email : contract.buyer_email;
    const initiatorName = party === 'seller' ? contract.seller_name : contract.buyer_name;

    if (initiatorEmail) {
      const endedEmail = generateDealEndedEmail({
        recipientName: initiatorName || party,
        propertyAddress,
        party,
        initiatedBy: party,
      });
      await sendEmailAuto(request.organization_id, {
        to: initiatorEmail,
        subject: endedEmail.subject,
        html: endedEmail.bodyHtml,
        text: endedEmail.bodyText,
      });
    }

    // Log the event
    await logEvent('step_out_confirmed', 'contract', contract.id, {
      party,
      reason: request.reason,
      hadAssignedBuyer: !!contract.assigned_at,
    }, request.organization_id);

    // Return success page (or redirect)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000';

    return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>Step-Out Confirmed</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .success { color: #16a34a; }
    .box { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1 class="success">Step-Out Confirmed</h1>
  <p>Your request to step out of the contract has been processed.</p>
  <div class="box">
    <strong>Property:</strong> ${propertyAddress}<br>
    <strong>Status:</strong> Contract Terminated
  </div>
  <p>All parties have been notified. You should receive a confirmation email shortly.</p>
  <p><a href="${baseUrl}/contracts">Return to Dashboard</a></p>
</body>
</html>
    `, {
      headers: { 'Content-Type': 'text/html' },
    });

  } catch (error: any) {
    console.error('GET /api/contracts/step-out/confirm error', error);
    return Response.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
