/**
 * Phase P2 — Stripe payment webhook receiver.
 *
 * Receives payment events from Stripe (or mock). Validates the webhook
 * signature, idempotently processes events, and updates the payments ledger.
 *
 * Events handled:
 *   payment_intent.succeeded  → cross-check amount → mark paid
 *   payment_intent.payment_failed → mark failed
 *   payment_intent.refunded   → mark refunded
 *
 * Amount cross-check: if the Stripe amount doesn't match the ledger, the
 * payment is HELD (not auto-marked) and an alert is logged.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { getStripeProvider, type StripeProviderType } from '@/app/api/services/stripeProvider';

export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature') || '';
    const providerType = (process.env.STRIPE_PROVIDER || 'mock') as StripeProviderType;

    const provider = getStripeProvider({ type: providerType });

    // Verify webhook signature
    if (!provider.verifyWebhook({ body, signature })) {
      console.warn('[payments/webhook] Invalid signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse the event
    let event;
    try {
      event = provider.parseWebhookEvent(body, signature);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid event body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Idempotency: check if this event was already processed
    const existing = await sql`
      SELECT 1 FROM payments_ledger
      WHERE ${event.id} = ANY(stripe_event_ids)
      LIMIT 1
    `;

    if (existing.length > 0) {
      return new Response(JSON.stringify({ ok: true, idempotent: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pi = event.data.object;
    const paymentIntentId = pi.id;

    // Find the ledger entry for this payment intent
    const ledgerRows = await sql`
      SELECT id, contract_id, amount_cents, status
      FROM payments_ledger
      WHERE stripe_payment_intent_id = ${paymentIntentId}
      LIMIT 1
    `;

    if (ledgerRows.length === 0) {
      console.warn(`[payments/webhook] No ledger entry for PI ${paymentIntentId}`);
      return new Response(JSON.stringify({ error: 'Payment intent not found in ledger' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const ledger = ledgerRows[0];

    switch (event.type) {
      case 'payment_intent.succeeded': {
        // Cross-check amount against ledger
        if (pi.amount !== ledger.amount_cents) {
          console.error(`[payments/webhook] AMOUNT MISMATCH: PI ${paymentIntentId}: Stripe ${pi.amount} vs ledger ${ledger.amount_cents}`);
          await logEvent('payment_amount_mismatch', 'contract', ledger.contract_id, {
            paymentIntentId,
            stripeAmount: pi.amount,
            ledgerAmount: ledger.amount_cents,
          });
          // Hold — do not auto-mark paid
          return new Response(JSON.stringify({ ok: true, held: true, reason: 'amount_mismatch' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Mark paid
        await sql`
          UPDATE payments_ledger
          SET status = 'paid',
              stripe_event_ids = array_append(stripe_event_ids, ${event.id}),
              paid_at = NOW()
          WHERE id = ${ledger.id} AND status = 'sent'
        `;

        await logEvent('payment_paid', 'contract', ledger.contract_id, {
          paymentIntentId,
          amountCents: ledger.amount_cents,
        });

        break;
      }

      case 'payment_intent.payment_failed': {
        await sql`
          UPDATE payments_ledger
          SET status = 'failed',
              stripe_event_ids = array_append(stripe_event_ids, ${event.id})
          WHERE id = ${ledger.id} AND status = 'sent'
        `;

        await logEvent('payment_failed', 'contract', ledger.contract_id, {
          paymentIntentId,
        });

        break;
      }

      case 'payment_intent.refunded': {
        await sql`
          UPDATE payments_ledger
          SET status = 'refunded',
              stripe_event_ids = array_append(stripe_event_ids, ${event.id}),
              refunded_at = NOW()
          WHERE id = ${ledger.id} AND status = 'paid'
        `;

        await logEvent('payment_refunded', 'contract', ledger.contract_id, {
          paymentIntentId,
        });

        break;
      }

      default:
        // Unknown event type — acknowledge but don't process
        console.log(`[payments/webhook] Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[payments/webhook] Error', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}