/**
 * stripe — the ONE Stripe client for the whole app. Server-only secret key,
 * never bundled to the client. There is no second Stripe instance anywhere.
 *
 * Mode is whatever the configured key implies: sk_test_… → test, sk_live_… →
 * live. The application code path is byte-identical in both — only the key (and
 * the price ids it references) differ. Going live is a credentials change, not a
 * code change.
 *
 * Missing key === loud throw (no silent no-op billing), consistent with the
 * repo's single-vendor / no-mock-fallback rule for the AI provider.
 */
import Stripe from 'stripe';

let _client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type StripeMode = 'test' | 'live' | 'unset';

export function stripeMode(): StripeMode {
  const k = process.env.STRIPE_SECRET_KEY ?? '';
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'live';
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test';
  return 'unset';
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured — billing is unavailable until it is set.');
  }
  if (!_client) {
    _client = new Stripe(key, {
      // Pin the API version so behavior is stable across SDK upgrades. Cast is
      // used because the SDK ships a literal union that changes each release.
      apiVersion: (process.env.STRIPE_API_VERSION as Stripe.LatestApiVersion) ?? undefined,
      appInfo: { name: 'DealFlow AI', version: '1.0.0' },
      typescript: true,
    });
  }
  return _client;
}

/** Env var name holding the Stripe Price id for a plan (test or live). */
export function stripePriceEnvVar(plan: 'starter' | 'professional'): string {
  return plan === 'starter' ? 'STRIPE_PRICE_STARTER' : 'STRIPE_PRICE_PROFESSIONAL';
}

export function stripePriceId(plan: 'starter' | 'professional'): string | null {
  return process.env[stripePriceEnvVar(plan)] ?? null;
}

/** Reverse map a Stripe price id back to a plan (for webhook subscription
 *  updates). Unknown price ids return null (leave plan unchanged). */
export function planForPriceId(priceId: string | null | undefined): 'starter' | 'professional' | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter';
  if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) return 'professional';
  return null;
}
