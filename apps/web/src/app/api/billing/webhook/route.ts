import type Stripe from 'stripe';

import sql from '@/app/api/utils/sql';
import { getStripe, planForPriceId } from '@/app/api/utils/stripe';

/**
 * Stripe webhook — the ONLY place subscription state is mutated from Stripe.
 *
 * Guarantees (Phase-5 hardening + the activation bug that has bitten before):
 *   • Signature verified with STRIPE_WEBHOOK_SECRET → tampered/unsigned = 403.
 *   • Idempotent: every event id is recorded once in billing_events; a replay
 *     short-circuits BEFORE any state change, so double-activation is impossible.
 *   • Handles first purchase AND re-purchase after cancellation (a canceled row
 *     is reactivated by the same upsert path — no "already exists" dead end).
 *
 * The raw body is read with request.text() (constructEvent needs the exact
 * bytes); Next's app-router routes are not body-parsed by default.
 */
export const runtime = 'nodejs';

function isoFromUnix(sec: number | null | undefined): string | null {
  return typeof sec === 'number' && sec > 0 ? new Date(sec * 1000).toISOString() : null;
}

/** Resolve our user id for a Stripe subscription: metadata first, else the
 *  customer id we stored at checkout. */
async function resolveUserId(subMetaUserId: string | undefined, customerId: string | null): Promise<string | null> {
  if (subMetaUserId) return subMetaUserId;
  if (customerId) {
    const rows = (await sql`SELECT user_id FROM subscriptions WHERE stripe_customer_id = ${customerId} LIMIT 1`) as {
      user_id: string;
    }[];
    if (rows[0]) return rows[0].user_id;
  }
  return null;
}

/** Upsert our subscriptions row from a Stripe.Subscription. Idempotent. */
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  const userId = await resolveUserId(sub.metadata?.userId, customerId);
  if (!userId) {
    console.error('[stripe webhook] could not resolve userId for subscription', sub.id);
    return;
  }

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const plan = planForPriceId(priceId);
  // Period fields live on the item in current API versions; fall back to the
  // (deprecated) subscription-level fields for older versions.
  const periodStart = isoFromUnix(
    (item as unknown as { current_period_start?: number })?.current_period_start ??
      (sub as unknown as { current_period_start?: number }).current_period_start
  );
  const periodEnd = isoFromUnix(
    (item as unknown as { current_period_end?: number })?.current_period_end ??
      (sub as unknown as { current_period_end?: number }).current_period_end
  );
  const trialEnd = isoFromUnix(sub.trial_end);

  await sql`
    UPDATE subscriptions SET
      status = ${sub.status},
      plan = COALESCE(${plan}, plan),
      stripe_subscription_id = ${sub.id},
      stripe_customer_id = COALESCE(${customerId}, stripe_customer_id),
      stripe_price_id = COALESCE(${priceId}, stripe_price_id),
      current_period_start = COALESCE(${periodStart}, current_period_start),
      current_period_end = COALESCE(${periodEnd}, current_period_end),
      trial_end = COALESCE(${trialEnd}, trial_end),
      cancel_at_period_end = ${Boolean(sub.cancel_at_period_end)},
      updated_at = now()
    WHERE user_id = ${userId}
  `;
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = request.headers.get('stripe-signature');
  const raw = await request.text();

  if (!secret) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET not configured');
    return Response.json({ error: { code: 'BILLING_UNCONFIGURED', message: 'Webhook secret not set' } }, { status: 503 });
  }
  if (!sig) {
    return Response.json({ error: { code: 'BAD_SIGNATURE', message: 'Missing stripe-signature' } }, { status: 403 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed', (err as Error).message);
    return Response.json({ error: { code: 'BAD_SIGNATURE', message: 'Signature verification failed' } }, { status: 403 });
  }

  // Idempotency gate: claim the event id. If it already exists, this is a replay
  // — acknowledge without re-applying (no double activation).
  const claimed = (await sql`
    INSERT INTO billing_events (event_id, type, payload)
    VALUES (${event.id}, ${event.type}, ${JSON.stringify(event.data.object)}::jsonb)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `) as { event_id: string }[];
  if (claimed.length === 0) {
    return Response.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const cs = event.data.object as Stripe.Checkout.Session;
        const subId = typeof cs.subscription === 'string' ? cs.subscription : cs.subscription?.id;
        if (subId) {
          const full = await getStripe().subscriptions.retrieve(subId);
          // Carry the userId from the checkout session onto the subscription if absent.
          if (!full.metadata?.userId && cs.client_reference_id) {
            (full as Stripe.Subscription).metadata = { ...full.metadata, userId: cs.client_reference_id };
          }
          await applySubscription(full);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null;
        const userId = await resolveUserId(undefined, customerId);
        if (userId) {
          await sql`UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE user_id = ${userId}`;
        }
        break;
      }
      default:
        // Unhandled event types are recorded (billing_events) and acknowledged.
        break;
    }
    return Response.json({ received: true });
  } catch (err) {
    console.error(`[stripe webhook] handler error for ${event.type}`, err);
    // 500 so Stripe retries; the idempotency row lets the retry replay safely
    // only if this row is cleared — but since we already claimed it, clear it so
    // the retry re-processes (the state change did not complete).
    await sql`DELETE FROM billing_events WHERE event_id = ${event.id}`.catch(() => {});
    return Response.json({ error: { code: 'HANDLER_ERROR', message: 'Webhook handler failed' } }, { status: 500 });
  }
}
