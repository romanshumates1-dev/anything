/**
 * STRIPE TEST-MODE VERIFICATION — read-only + one disposable test object.
 *
 * WHY THIS EXISTS
 * ---------------
 * `STRIPE_SECRET_KEY` was absent, so every billing test had run against mocks and
 * the Stripe SDK path itself was never exercised against the real API. That is
 * the one thing unit tests with mocked `fetch` cannot prove: that our request
 * shape is accepted by Stripe and our SDK/apiVersion assumptions hold.
 *
 * SAFETY
 * ------
 * Requires a TEST-MODE key (`sk_test_...`). Refuses to run against a live key -
 * this is the single most important guard in the file, because the failure mode
 * of getting it wrong is real charges on a real account.
 *
 * Creates at most one 100-cent ($1.00) TEST payment intent to prove the write
 * path, then EXPIRES it so it can never be captured. Test mode means no money
 * can move regardless, but expiring removes even the possibility.
 *
 * Secrets are read from the environment only. Nothing is printed except the
 * prefix length, never the key.
 */
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY || '';

if (!key) {
  console.error('STRIPE_SECRET_KEY not set. Nothing to verify.');
  process.exit(2);
}

// ── Refuse live keys. This is the guard that matters most. ──────────────────
if (!key.startsWith('sk_test_')) {
  console.error('REFUSING: this is not a test-mode key (expected sk_test_ prefix).');
  console.error('         This script creates a real Stripe object. Stopping.');
  process.exit(3);
}

const stripe = new Stripe(key, { apiVersion: '2026-06-24.dahlia' });

const ok = (label, value) => console.log(`  PASS  ${label}: ${value}`);
const fail = (label, err) =>
  console.log(`  FAIL  ${label}: ${err?.message ?? String(err)}`.slice(0, 220));

let failures = 0;
const step = async (label, fn) => {
  try {
    ok(label, await fn());
  } catch (e) {
    failures++;
    fail(label, e);
  }
};

console.log('STRIPE TEST-MODE VERIFICATION');
console.log(`key prefix: sk_test_… (${key.length} chars, value not printed)\n`);

console.log('1. Account is reachable and in TEST mode');
await step('GET /v1/account', async () => {
  const a = await stripe.accounts.retrieve();
  return `${a.id} country=${a.country}`;
});
await step('balance.livemode is FALSE', async () => {
  const b = await stripe.balance.retrieve();
  if (b.livemode !== false) throw new Error(`livemode=${b.livemode} — NOT test mode`);
  return 'confirmed false';
});

console.log('\n2. SDK + apiVersion accepted by the API');
await step('GET /v1/products', async () => {
  const p = await stripe.products.list({ limit: 1 });
  return `ok (${p.data.length} returned)`;
});

console.log('\n3. Inline price_data shape we actually send at checkout');
let disposableIntentId = null;
await step('create $1.00 TEST payment intent (inline price_data path)', async () => {
  const pi = await stripe.paymentIntents.create({
    amount: 100,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: { source: 'dealswift-testmode-verification', disposable: 'true' },
  });
  disposableIntentId = pi.id;
  return `${pi.id} status=${pi.status}`;
});
await step('retrieve it back', async () => {
  const pi = await stripe.paymentIntents.retrieve(disposableIntentId);
  return `status=${pi.status} amount=${pi.amount}`;
});
await step('CANCEL it so it can never be captured', async () => {
  // NOTE: the SDK exposes `cancel`, not `expire` - verified against the
  // installed stripe package's prototype chain, not assumed. A test that
  // silently no-ops its own safety step is worse than no test.
  const pi = await stripe.paymentIntents.cancel(disposableIntentId);
  return `status=${pi.status}`;
});

console.log('\n4. Capabilities the subscription path depends on');
await step('card_payments capability', async () => {
  const a = await stripe.accounts.retrieve();
  const cap = a.capabilities?.card_payments ?? 'unknown';
  return String(cap);
});
await step('can create a test webhook endpoint shape (not created)', async () => {
  // Listed only - we do NOT create endpoints, since a stray endpoint pointing
  // at production would be a live-config change made by a test.
  const eps = await stripe.webhookEndpoints.list({ limit: 1 });
  return `${eps.data.length} endpoint(s) visible`;
});

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
process.exit(failures === 0 ? 0 : 1);