import { headers } from 'next/headers';

import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { ensureSubscription, getSubscription } from '@/app/api/utils/entitlement';
import { getStripe, isStripeConfigured, stripePriceId } from '@/app/api/utils/stripe';
import { getPlan, isPlanId } from '@/config/plans';

/**
 * Start a Stripe Checkout session for a self-serve plan (starter | professional).
 * Enterprise is contact-sales (no price id) and is rejected here by design.
 *
 * The code path is identical in test and live mode — only STRIPE_SECRET_KEY and
 * the STRIPE_PRICE_* ids differ. With the test key + test price ids this creates
 * a real (zero-cost) test-mode Checkout session.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return Response.json(
      { error: { code: 'BILLING_UNCONFIGURED', message: 'Billing is not configured on this environment.' } },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, { status: 400 });
  }
  const plan = (body as { plan?: unknown })?.plan;
  if (!isPlanId(plan) || plan === 'enterprise') {
    return Response.json(
      { error: { code: 'INVALID_PLAN', message: 'plan must be "starter" or "professional"' } },
      { status: 400 }
    );
  }

  const priceId = stripePriceId(plan);
  if (!priceId) {
    return Response.json(
      { error: { code: 'PRICE_UNCONFIGURED', message: `No Stripe price configured for ${plan}` } },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripe();
    await ensureSubscription(session.user.id, plan);
    const sub = await getSubscription(session.user.id);

    // Reuse the user's Stripe customer if we already made one (idempotent).
    let customerId = sub?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        metadata: { userId: session.user.id },
      });
      customerId = customer.id;
      await sql`UPDATE subscriptions SET stripe_customer_id = ${customerId}, updated_at = now() WHERE user_id = ${session.user.id}`;
    }

    const origin = new URL(request.url).origin;
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: session.user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: getPlan(plan).trialDays, metadata: { userId: session.user.id, plan } },
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    return Response.json({ url: checkout.url, id: checkout.id });
  } catch (err) {
    console.error('POST /api/billing/checkout error', err);
    return Response.json({ error: { code: 'CHECKOUT_FAILED', message: 'Could not start checkout' } }, { status: 500 });
  }
}
