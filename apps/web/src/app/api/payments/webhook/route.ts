/**
 * Phase P2 — Stripe payment webhook receiver.
 *
 * THE ONLY PLACE PAID ACCESS IS GRANTED.
 *
 * Validates the webhook signature, then dispatches:
 *
 *   checkout.session.completed           → plan activation / credit grant
 *   checkout.session.async_payment_succeeded → same handler (settled later)
 *   payment_intent.succeeded             → contract assignment-fee ledger
 *   payment_intent.payment_failed        → mark the ledger entry failed
 *   payment_intent.refunded              → mark the ledger entry refunded
 *   charge.refunded                      → mark the ledger entry refunded
 *
 * Contract payments cross-check the Stripe amount against the ledger; on a
 * mismatch the payment is HELD (not auto-marked) and an alert is logged.
 *
 * Billing purchases never trust the amount or the buyer from the request: the
 * organization and the product come from Stripe `metadata`, which is covered by
 * the signature, and every write is idempotent on a Stripe object id.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { enqueueJob } from '@/app/api/utils/jobs';
import { getStripeProvider, type StripeProviderType } from '@/app/api/services/stripeProvider';
import { activatePlan, grantCreditPack } from '@/app/api/utils/billingEntitlements';
import type Stripe from 'stripe';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}


export async function POST(request: Request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature') || '';
    const providerType = (process.env.STRIPE_PROVIDER || 'mock') as StripeProviderType;

    // SECURITY (production hardening): the mock provider accepts ANY signature
    // (documented in stripeProvider.ts). A publicly reachable webhook running
    // in mock mode would let anyone forge payment_intent.succeeded events and
    // flip a ledger entry to 'paid'. Fail closed in production unless the
    // operator has explicitly opted in — same NODE_ENV boundary as the
    // mock-checkout pages (BREAKAGE_TABLE #34). The mock checkout simulation
    // does NOT go through this route (mock-checkout/complete updates the
    // ledger directly), so this guard breaks no legitimate flow.
    if (
      providerType === 'mock' &&
      process.env.NODE_ENV === 'production' &&
      process.env.ALLOW_MOCK_PAYMENT_WEBHOOKS !== '1'
    ) {
      return new Response(JSON.stringify({ error: 'Payment provider not configured' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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
    let event: Stripe.Event;
    try {
      event = provider.parseWebhookEvent(body, signature);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid event body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // The SDK types the full event union it knows about, but the wire can
    // carry events the SDK version predates or models differently (e.g.
    // payment_intent.refunded arrives as a Charge refund object). The
    // signature is already verified above; at this layer event.type is
    // untrusted wire data, not a compile-time enum — narrow the union to
    // string before comparing.
    const eventType: string = event.type;

    // Billing purchases are keyed by Stripe object ids; contract payments by the
    // payments_ledger. Dispatch first, so a checkout event never falls through to
    // the ledger lookup (which would 404 for having no ledger row).
    if (
      eventType === 'checkout.session.completed' ||
      eventType === 'checkout.session.async_payment_succeeded'
    ) {
      return await handleCheckoutCompleted(event);
    }

    // SUBSCRIPTION LIFECYCLE.
    //
    // Before this, every event below was acknowledged and DROPPED - the comment
    // even named `customer.subscription.deleted` as an example. Entitlements are
    // read from `organization_subscriptions.status` (subscriptionGuard.ts), and
    // that row is written ONLY by activatePlan on checkout. Nothing ever wrote
    // it back, so a customer could cancel in the Stripe dashboard - or let a
    // renewal fail - and the organization kept `status = 'active'` and its paid
    // tier indefinitely. The schema already permitted 'past_due' / 'canceled'
    // / 'expired' (migration 026); those states were designed and never wired.
    if (
      eventType === 'customer.subscription.deleted' ||
      eventType === 'customer.subscription.updated' ||
      eventType === 'invoice.payment_failed' ||
      eventType === 'invoice.paid'
    ) {
      return await handleSubscriptionEvent(eventType, event);
    }

    // Only payment-intent and charge events touch the ledger. Everything else
    // (account.updated, etc.) is acknowledged so Stripe does not redeliver.
    if (
      !['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.refunded', 'charge.refunded'].includes(
        eventType
      )
    ) {
      console.log(`[payments/webhook] Ignoring unhandled event type: ${eventType}`);
      return json({ received: true });
    }

    // Idempotency: check if this event was already processed
    const existing = await sql`
      SELECT 1 FROM payments_ledger
      WHERE ${event.id} = ANY(stripe_event_ids)
      LIMIT 1
    `;

    if (existing.length > 0) {
      return json({ received: true, idempotent: true });
    }

    const pi = event.data.object as Stripe.PaymentIntent;
    const paymentIntentId = pi.id;

    // Find the ledger entry for this payment intent
    const ledgerRows = await sql`
      SELECT pl.id, pl.contract_id, pl.amount_cents, pl.status, c.organization_id
      FROM payments_ledger pl
      JOIN contracts c ON c.id = pl.contract_id
      WHERE pl.stripe_payment_intent_id = ${paymentIntentId}
      LIMIT 1
    `;

    if (ledgerRows.length === 0) {
      // A billing purchase also emits `payment_intent.succeeded` for the same
      // money. `checkout.session.completed` has already provisioned it, so
      // acknowledge rather than 404 — a 404 makes Stripe redeliver this event
      // forever.
      if (isBillingPaymentIntent(pi)) {
        console.log(
          `[payments/webhook] PI ${paymentIntentId} belongs to a billing checkout; already handled by the checkout handler`
        );
        return json({ received: true, handledBy: 'checkout.session.completed' });
      }
      console.warn(`[payments/webhook] No ledger entry for PI ${paymentIntentId}`);
      return json({ error: 'Payment intent not found in ledger' }, 404);
    }

    const ledger = ledgerRows[0];

    switch (eventType) {
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
          return json({ received: true, held: true, reason: 'amount_mismatch' });
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

        // P2: Notify owner on success
        await enqueueJob(
          'send_owner_notification',
          {
            message: `✅ Payment of $${(ledger.amount_cents / 100).toFixed(2)} for contract ${ledger.contract_id} has been received.`,
            organizationId: ledger.organization_id,
          },
          { dedupeKey: `payment-succeeded-notification-${paymentIntentId}` }
        );

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

        // P2: Notify owner on failure
        await enqueueJob(
          'send_owner_notification',
          {
            message: `❌ Payment for contract ${ledger.contract_id} has failed.`,
            organizationId: ledger.organization_id,
          },
          { dedupeKey: `payment-failed-notification-${paymentIntentId}` }
        );

        break;
      }

      case 'payment_intent.refunded':
      case 'charge.refunded': {
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
        console.log(`[payments/webhook] Unhandled event type: ${eventType}`);
    }

    return json({ received: true });
  } catch (error: any) {
    console.error('[payments/webhook] Error', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Map a Stripe subscription/invoice event onto our subscription status.
 *
 * WHY THIS EXISTS: entitlements are read from `organization_subscriptions.status`
 * and that row was only ever written by `activatePlan` at checkout. Stripe's
 * cancellation and dunning events were acknowledged and discarded, so a customer
 * who cancelled - or whose renewal failed - kept a paid tier forever.
 *
 * The organization is resolved ONLY from `organizations.stripe_customer_id`,
 * i.e. from data Stripe itself wrote at checkout. It is never taken from the
 * request, so a forged or replayed payload cannot redirect a status change onto
 * another tenant. Signature verification has already run.
 *
 * A customer that matches no organization is acknowledged (200) rather than
 * rejected: it is almost always an unrelated Stripe account, and a 4xx would
 * make Stripe retry forever for something redelivery can never fix.
 */
async function handleSubscriptionEvent(eventType: string, event: Stripe.Event): Promise<Response> {
  const object = event.data.object as Record<string, any>;
  const customerId: string | null =
    typeof object?.customer === 'string'
      ? object.customer
      : (object?.customer?.id ?? null);

  if (!customerId) {
    console.warn(`[payments/webhook] ${eventType} carried no customer; nothing to reconcile`);
    return json({ received: true, reconciled: false, reason: 'no_customer' });
  }

  const rows = await sql`
    SELECT o.id AS organization_id
    FROM organizations o
    WHERE o.stripe_customer_id = ${customerId}
    LIMIT 1
  `;
  const organizationId = rows[0]?.organization_id as string | undefined;

  if (!organizationId) {
    console.warn(
      `[payments/webhook] ${eventType} for customer ${customerId} matched no organization`
    );
    return json({ received: true, reconciled: false, reason: 'unknown_customer' });
  }

  // Derive the target status. Stripe's own vocabulary is mapped onto the CHECK
  // constraint in migration 026 rather than written through blindly.
  let status: 'active' | 'past_due' | 'canceled' | 'expired' | null = null;
  switch (eventType) {
    case 'customer.subscription.deleted':
      status = 'canceled';
      break;
    case 'customer.subscription.updated':
      status =
        object.status === 'active' || object.status === 'trialing'
          ? 'active'
          : object.status === 'past_due' || object.status === 'unpaid'
            ? 'past_due'
            : object.status === 'canceled'
              ? 'canceled'
              : object.status === 'incomplete_expired'
                ? 'expired'
                : null;
      break;
    case 'invoice.payment_failed':
      status = 'past_due';
      break;
    case 'invoice.paid':
      status = 'active';
      break;
  }

  if (!status) {
    console.log(`[payments/webhook] ${eventType} carries no mappable status; ignored`);
    return json({ received: true, reconciled: false, reason: 'unmappable_status' });
  }

  const updated = await sql`
    UPDATE organization_subscriptions
    SET status = ${status},
        current_period_end = COALESCE(
          to_timestamp(${object.current_period_end ?? null}), current_period_end
        ),
        updated_at = NOW()
    WHERE organization_id = ${organizationId}
      AND status IS DISTINCT FROM ${status}
  `;

  console.log(
    `[payments/webhook] ${eventType}: organization ${organizationId} -> ${status}`
  );
  await logEvent('billing_subscription_status_changed', 'billing', organizationId, {
    eventId: event.id,
    eventType,
    status,
    changed: updated.length > 0,
  });

  // Always 200: a repeat delivery is not an error, and the status write above is
  // idempotent because the WHERE clause excludes rows already at that status.
  return json({ received: true, reconciled: true, status, changed: updated.length > 0 });
}

/**
 * `checkout.session.completed` — grant exactly what was bought.
 *
 * Every input comes from the signature-verified event. The amount is never used
 * to infer the product, and the buyer is never taken from the request body.
 */
async function handleCheckoutCompleted(event: Stripe.Event): Promise<Response> {
  const session = event.data.object as Stripe.Checkout.Session;

  // Only a settled payment may grant anything. 'unpaid' means an async payment
  // method is still clearing — `checkout.session.async_payment_succeeded`
  // follows and arrives here again — and 'no_payment_required' means nothing was
  // ever charged.
  if (session.payment_status === 'unpaid') {
    console.log(`[payments/webhook] Session ${session.id} is not settled yet (unpaid)`);
    return json({ received: true, awaitingPayment: true });
  }
  if (session.payment_status !== 'paid') {
    console.warn(
      `[payments/webhook] Session ${session.id} has payment_status=${session.payment_status}; nothing granted`
    );
    return json({ received: true, granted: false, reason: session.payment_status ?? 'unknown' });
  }

  const metadata = (session.metadata ?? {}) as Record<string, string>;
  // snake_case is the canonical shape written by our own checkout calls. The
  // camelCase fallbacks exist because /api/credits/purchase historically wrote
  // `organizationId`/`packId`, and sessions created before that was normalised
  // may still complete.
  const organizationId = metadata.organization_id ?? metadata.organizationId;
  const planId = metadata.plan_id ?? metadata.planId;
  const creditPackId = metadata.credit_pack_id ?? metadata.creditPackId ?? metadata.packId;

  if (!organizationId || (!planId && !creditPackId)) {
    // Redelivery cannot fix a session that was created without attribution, so
    // acknowledge (200) instead of letting Stripe retry forever — but make it
    // loud, because this needs a human.
    console.error(
      `[payments/webhook] Session ${session.id} is PAID but cannot be attributed ` +
        `(organization_id=${organizationId ?? 'missing'}, plan_id=${planId ?? 'missing'}, ` +
        `credit_pack_id=${creditPackId ?? 'missing'}). Manual reconciliation required.`
    );
    await logEvent('billing_webhook_unattributable', 'billing', organizationId ?? 'unknown', {
      sessionId: session.id,
      eventId: event.id,
      amountTotal: session.amount_total ?? null,
      reason: 'missing_metadata',
    });
    return json({ received: true, granted: false, reason: 'missing_metadata' });
  }

  // Stripe supplies the customer on the session. Persisting it is what stops a
  // second Stripe customer being created for the same organization later.
  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

  if (planId) {
    const result = await activatePlan({
      organizationId,
      planId,
      // The Checkout Session id is the idempotency anchor for both the
      // subscription row and the credit grant.
      processorReference: session.id,
      stripeCustomerId,
      amountCents: session.amount_total ?? 0,
      eventId: event.id,
      status: 'active',
    });

    return json({
      received: true,
      granted: true,
      kind: 'plan',
      plan: result.planTier,
      creditsGranted: result.creditsGranted,
      alreadyProcessed: result.alreadyProcessed,
    });
  }

  const credits = await resolvePackCredits(creditPackId as string, metadata);
  if (!credits) {
    console.error(
      `[payments/webhook] Session ${session.id} is PAID but pack "${creditPackId}" is unknown ` +
        `and carries no credits value. Manual reconciliation required.`
    );
    await logEvent('billing_webhook_unattributable', 'billing', organizationId, {
      sessionId: session.id,
      eventId: event.id,
      creditPackId,
      reason: 'unknown_credit_pack',
    });
    return json({ received: true, granted: false, reason: 'unknown_credit_pack' });
  }

  const result = await grantCreditPack({
    organizationId,
    credits,
    amountCents: session.amount_total ?? 0,
    packId: creditPackId as string,
    // IDEMPOTENCY ANCHOR = the Checkout SESSION, not the event.
    //
    // These are not interchangeable. One purchase produces one session but many
    // events: Stripe assigns a fresh `evt_...` id per delivery, and an operator
    // resending an event from the dashboard mints a NEW id for the SAME
    // purchase. Keyed on the event, each delivery granted the pack again, so a
    // single $19 purchase could be credited repeatedly. The partial unique index
    // `idx_credit_transactions_idempotency` only collapses duplicates that share
    // a key, so anchoring on the event defeated it entirely.
    //
    // The session is the purchase, so it is the anchor. This also matches
    // `activatePlan` above, which already used `processorReference: session.id`
    // - the two branches had drifted, and now cannot.
    idempotencyKey: `credit-pack:${session.id}`,
    eventId: event.id,
    stripeCustomerId,
  });

  return json({
    received: true,
    granted: !result.alreadyProcessed,
    kind: 'credit_pack',
    creditsGranted: result.creditsGranted,
    alreadyProcessed: result.alreadyProcessed,
  });
}

/**
 * How many credits a verified credit-pack purchase should grant.
 *
 * Prefers the authoritative `credit_packs` row. The metadata fallback exists
 * because the legacy /api/billing/subscribe pack ids ('100', '5000') are not
 * rows in that table; the value is safe to trust there because it travelled in
 * the Stripe-signed session metadata. Returns null rather than guessing.
 */
async function resolvePackCredits(
  packId: string,
  metadata: Record<string, string>
): Promise<number | null> {
  const [row] = await sql`
    SELECT credits FROM credit_packs WHERE id = ${packId} LIMIT 1
  `;
  const fromDb = Number((row as { credits?: number } | undefined)?.credits ?? 0);
  if (fromDb > 0) return fromDb;

  const fromMetadata = Number(metadata.credits ?? 0);
  if (Number.isFinite(fromMetadata) && fromMetadata > 0) return fromMetadata;

  return null;
}

/**
 * True when a PaymentIntent belongs to a billing purchase rather than a contract
 * assignment fee — used to avoid 404-ing (and so retry-storming) the duplicate
 * `payment_intent.succeeded` that every Checkout payment emits.
 */
function isBillingPaymentIntent(pi: Stripe.PaymentIntent): boolean {
  const metadata = (pi.metadata ?? {}) as Record<string, string>;
  return Boolean(
    metadata.plan_id ||
      metadata.credit_pack_id ||
      metadata.organization_id ||
      metadata.type === 'credit_purchase'
  );
}
