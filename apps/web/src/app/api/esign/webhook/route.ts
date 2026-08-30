/**
 * Phase P1 — E-Sign webhook receiver.
 *
 * Receives signing events from any configured e-sign provider (mock, documenso,
 * docusign). Validates the webhook signature, idempotently records the event,
 * and updates the contract status machine.
 *
 * Event flow: sent → viewed → signed → countersigned
 * Status regressions are impossible (no signed→sent).
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { getEsignProvider, type EsignProviderType } from '@/app/api/services/esignProvider';
import { getStripeProvider } from '@/app/api/services/stripeProvider';
import { onBuyerAssignmentSigned, sendContractAlert } from '@/app/api/services/contractNotifications';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EsignWebhookPayload {
  event_type: 'sent' | 'viewed' | 'signed' | 'countersigned';
  envelope_id: string;
  contract_id: string;
  event_id: string; // Provider's unique event ID for idempotency
  event_data?: Record<string, any>;
  signed_at?: string;
}

// ─── Status Machine ──────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['sent'],
  sent: ['viewed', 'signed'],
  viewed: ['signed'],
  signed: ['countersigned'],
  countersigned: [],
};

function isValidTransition(current: string, next: string): boolean {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) return false;
  return allowed.includes(next);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('x-esign-signature') || '';
    // The provider used for verification MUST come from server config, never
    // a client-supplied header (BREAKAGE_TABLE #34): a caller could previously
    // send `x-esign-provider: mock` to force the accept-all mock verifier
    // regardless of which real provider (documenso/docusign) the deployment
    // actually uses, bypassing signature verification entirely.
    const provider: EsignProviderType = (process.env.ESIGN_PROVIDER || 'mock') as EsignProviderType;

    // Verify webhook signature
    const provider_ = getEsignProvider({ type: provider });
    if (!provider_.verifyWebhook({ body, signature, provider })) {
      console.warn(`[esign/webhook] Invalid signature from provider ${provider}`);
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let payload: EsignWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate required fields
    if (!payload.event_type || !payload.envelope_id || !payload.contract_id || !payload.event_id) {
      return new Response(JSON.stringify({ error: 'Missing required fields: event_type, envelope_id, contract_id, event_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!['sent', 'viewed', 'signed', 'countersigned'].includes(payload.event_type)) {
      return new Response(JSON.stringify({ error: `Invalid event_type: ${payload.event_type}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Idempotency: check if this event was already processed
    const existing = await sql`
      SELECT 1 FROM esign_events
      WHERE contract_id = ${payload.contract_id} AND external_event_id = ${payload.event_id}
      LIMIT 1
    `;

    if (existing.length > 0) {
      // Already processed — return 200 (idempotent, not an error)
      return new Response(JSON.stringify({ ok: true, idempotent: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check current contract status for transition validity
    const contractRows = await sql`
      SELECT esign_status, organization_id FROM contracts WHERE id = ${payload.contract_id}
    `;

    if (contractRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Contract not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const currentStatus = contractRows[0].esign_status || 'pending';
    const orgId = contractRows[0].organization_id || 'default';

    if (!isValidTransition(currentStatus, payload.event_type)) {
      console.warn(`[esign/webhook] Invalid transition: ${currentStatus} → ${payload.event_type} for contract ${payload.contract_id}`);
      return new Response(JSON.stringify({ error: `Invalid status transition: ${currentStatus} → ${payload.event_type}` }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Record the event and update contract atomically
    const eventId = `esign_evt_${crypto.randomUUID()}`;
    await sql.transaction([
      sql`
        INSERT INTO esign_events (id, contract_id, event_type, external_event_id, event_data)
        VALUES (${eventId}, ${payload.contract_id}, ${payload.event_type}, ${payload.event_id}, ${JSON.stringify(payload.event_data || {})})
      `,
      sql`
        UPDATE contracts
        SET esign_status = ${payload.event_type},
            signed_at = CASE WHEN ${payload.event_type} = 'signed' THEN COALESCE(${payload.signed_at ? new Date(payload.signed_at) : null}::timestamptz, NOW()) ELSE signed_at END
        WHERE id = ${payload.contract_id}
      `,
    ]);

    // Log the event
    await logEvent(`esign_${payload.event_type}`, 'contract', payload.contract_id, {
      envelopeId: payload.envelope_id,
      eventType: payload.event_type,
      provider,
      eventData: payload.event_data,
    });

    // If signed, create payment if fee_collection = collect_now and send notifications
    if (payload.event_type === 'signed') {
      const contract = contractRows[0];

      // Get full contract details for notifications
      const [contractDetails] = await sql`
        SELECT
          c.*,
          ba.buyer_id,
          ba.assignment_fee_cents,
          b.name as buyer_name,
          b.email as buyer_email,
          l.id as lead_id
        FROM contracts c
        LEFT JOIN buyer_assignments ba ON ba.contract_id = c.id
        LEFT JOIN buyers b ON b.id = ba.buyer_id
        LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.id = ${payload.contract_id}
      `.catch(() => [null]);

      // Send contract signed notification
      if (contractDetails) {
        const isAssignmentContract = contractDetails.contract_type === 'assignment_contract' ||
          contractDetails.metadata?.contractType === 'ASSIGNMENT';

        if (isAssignmentContract && contractDetails.buyer_id) {
          // Assignment contract signed by buyer - send full notification flow
          await onBuyerAssignmentSigned({
            contractId: payload.contract_id,
            buyerId: contractDetails.buyer_id,
            buyerName: contractDetails.buyer_name || 'Unknown Buyer',
            buyerEmail: contractDetails.buyer_email || '',
            propertyAddress: contractDetails.property_address || 'Property',
            assignmentFee: contractDetails.assignment_fee_cents || 0,
            leadId: contractDetails.lead_id,
          });
        } else {
          // Purchase agreement or other contract signed - send general notification
          await sendContractAlert({
            type: 'ASSIGNMENT_SIGNED',
            contractId: payload.contract_id,
            propertyAddress: contractDetails.property_address || 'Property',
            buyerName: contractDetails.buyer_name,
            buyerEmail: contractDetails.buyer_email,
            assignmentFee: contractDetails.assignment_fee_cents,
            urgency: 'HIGH',
            metadata: { leadId: contractDetails.lead_id },
          });
        }
      }

      if (contract.fee_collection === 'collect_now') {
        // Query actual assignment fee from contract/negotiation - avoid hardcoded defaults
        const [feeData] = await sql`
          SELECT assignment_fee_cents FROM buyer_assignments WHERE contract_id = ${payload.contract_id}
        `.catch(() => [null]);

        const feeConfig = contract.fee_config || {};
        // Use actual assignment fee if available, otherwise fall back to fee_config
        const amountCents = feeData?.assignment_fee_cents || feeConfig.value;

        if (!amountCents) {
          console.warn(`[esign/webhook] No assignment fee found for contract ${payload.contract_id}, skipping payment creation`);
        } else {
          // Create payment via mock provider
          const stripeProvider = getStripeProvider();
          const paymentResult = await stripeProvider.createPaymentLink({
            contractId: payload.contract_id,
            organizationId: orgId,
            amountCents,
            description: `Assignment Fee - Contract ${payload.contract_id}`,
          });

          const ledgerId = `pay_${crypto.randomUUID()}`;
          await sql`
            INSERT INTO payments_ledger (id, contract_id, amount_cents, stripe_payment_intent_id, status)
            VALUES (${ledgerId}, ${payload.contract_id}, ${amountCents}, ${paymentResult.paymentIntentId}, 'sent')
          `;

          await logEvent('payment_created_on_sign', 'contract', payload.contract_id, {
            ledgerId,
            amountCents,
            paymentIntentId: paymentResult.paymentIntentId,
            source: 'esign_webhook',
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, eventId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[esign/webhook] Error processing webhook', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}