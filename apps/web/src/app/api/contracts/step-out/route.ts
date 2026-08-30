/**
 * POST /api/contracts/step-out
 *
 * Initiates a step-out request from buyer or seller during inspection period.
 * Sends confirmation email - they must confirm before the step-out is processed.
 *
 * POST body:
 *   contractId: string
 *   party: 'seller' | 'buyer'
 *   reason?: string
 */
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getOrganization } from '@/lib/organization-context';
import { sendEmailAuto } from '@/app/api/utils/emailProviders';
import { logEvent } from '@/app/api/utils/logger';
import { clockState } from '@/app/api/utils/inspectionClockCore';
import {
  generateStepOutConfirmationEmail,
  type StepOutParty,
} from '@/app/api/utils/step-out-engine';

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  let body: { contractId: string; party: StepOutParty; reason?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { contractId, party, reason } = body;

  if (!contractId || !party || !['seller', 'buyer'].includes(party)) {
    return Response.json({ error: 'contractId and party (seller/buyer) required' }, { status: 400 });
  }

  try {
    // Get contract details
    const [contract] = await sql`
      SELECT
        c.id, c.status, c.inspection_days, c.created_at,
        c.seller_lead_id, c.buyer_lead_id,
        l.name as seller_name, l.email as seller_email,
        l.metadata->>'address' as property_address,
        b.name as buyer_name, b.email as buyer_email
      FROM contracts c
      LEFT JOIN leads l ON l.id = c.seller_lead_id
      LEFT JOIN buyer_leads b ON b.id = c.buyer_lead_id
      WHERE c.id = ${contractId} AND c.organization_id = ${organization.id}
    `;

    if (!contract) {
      return Response.json({ error: 'Contract not found' }, { status: 404 });
    }

    // Check if still in inspection period
    const clock = clockState(
      new Date(contract.created_at),
      contract.inspection_days || 14,
      new Date()
    );

    if (clock.stage === 'expired') {
      return Response.json({
        error: 'Inspection period has expired',
        detail: 'Step-out is no longer available after the inspection period ends',
      }, { status: 400 });
    }

    // Determine who is stepping out
    const partyName = party === 'seller' ? contract.seller_name : contract.buyer_name;
    const partyEmail = party === 'seller' ? contract.seller_email : contract.buyer_email;

    if (!partyEmail) {
      return Response.json({
        error: `No email on file for ${party}`,
      }, { status: 400 });
    }

    // Generate confirmation token
    const confirmationToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Store pending step-out request
    // Note: step_out_requests table created via migration 056_step_out_requests.sql
    await sql`
      INSERT INTO step_out_requests (
        id, organization_id, contract_id, party, reason,
        confirmation_token, expires_at, status, created_at
      ) VALUES (
        ${crypto.randomUUID()}, ${organization.id}, ${contractId}, ${party},
        ${reason || null}, ${confirmationToken}, ${expiresAt}, 'pending', now()
      )
    `;

    // Send confirmation email
    const email = generateStepOutConfirmationEmail({
      organizationId: organization.id,
      contractId,
      party,
      partyName: partyName || party,
      partyEmail,
      propertyAddress: contract.property_address || 'Property',
      inspectionDaysRemaining: clock.daysRemaining,
      confirmationToken,
    });

    await sendEmailAuto(organization.id, {
      to: partyEmail,
      subject: email.subject,
      html: email.bodyHtml,
      text: email.bodyText,
    });

    await logEvent('step_out_requested', 'contract', contractId, {
      party,
      partyEmail,
      daysRemaining: clock.daysRemaining,
      reason,
    }, organization.id);

    return Response.json({
      ok: true,
      message: `Confirmation email sent to ${partyEmail}`,
      expiresAt: expiresAt.toISOString(),
      inspectionDaysRemaining: clock.daysRemaining,
    });

  } catch (error: any) {
    console.error('POST /api/contracts/step-out error', error);
    return Response.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
