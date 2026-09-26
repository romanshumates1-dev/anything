# Stripe Subscription Monetization — Decision Required

## Current state
`POST /api/billing/subscribe` activates the selected plan and credits but **does not collect money**.
The route runs in mock/degraded mode because `STRIPE_SECRET_KEY` is not set in the production
environment. Both the `wrangler tail` log and `apps/web/.dev.vars` confirm: no live Stripe key.

The warning in the boot log:
```
NOTE: STRIPE_SECRET_KEY not set — related features run in mock/degraded mode.
```

## What exists today
- `POST /api/billing/subscribe` — typed route handler, plan activation logic, credit grant logic
- `GET /api/billing/plans` — returns plan catalog
- Webhook route (`POST /api/payments/webhook`) — hardened in b15fa9f, ready to receive Stripe events
  but guarded (returns 503 in production without `ALLOW_MOCK_PAYMENT_WEBHOOKS=1`)
- `stripe` npm package — present in `apps/web/package.json`

## What's missing
1. Live Stripe account credentials (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
2. Stripe Checkout session creation in `POST /api/billing/subscribe`
3. Webhook handler logic to convert `checkout.session.completed` / `customer.subscription.*`
   events into plan activation + credit grant (currently the route self-activates without payment)
4. Plan price IDs / product IDs in Stripe (need to be created in the Stripe dashboard or via API)

## Options

### Option A: Wire real Stripe Checkout
- **Requires:** your live Stripe account with API keys added to `apps/web/.dev.vars` (dev) and
  Cloudflare Workers secret bindings (prod).
- **Scope:** modify `POST /api/billing/subscribe` to create a Stripe Checkout session; modify the
  webhook to handle `checkout.session.completed` and subscription events; add price/plan mapping.
- **Risk:** real money moves — needs your approval and Stripe account access.
- **Effort:** a few hours of implementation + Stripe dashboard setup.

### Option B: Keep mock/degraded mode (current behavior)
- Subscription UI works, plans activate, credits grant — but no money is collected.
- Acceptable if the product is free-tier-only for now or if monetization is deferred.
- The hardened webhook guard + `ALLOW_MOCK_PAYMENT_WEBHOOKS` escape hatch are already in place
  from b15fa9f in case you want to bring up a test Stripe later.

### Option C: Use Stripe test mode
- Same as Option A but with test keys (`sk_test_*` / `whsec_*`).
- No real money; lets you verify the full payment → webhook → activation flow end-to-end.
- Good middle ground: validates the integration without financial risk.

## Recommendation
If you want to validate the full payment flow before going live, **Option C (test mode)** is the
lowest-risk path. It requires only test keys from your Stripe dashboard — no live credentials.

If monetization is not a priority right now, **Option B** is fine and the code is already in place
to switch later.

**Your decision needed:** which option, and if A or C, please provide the Stripe keys (or grant
access to your Stripe account so I can create the products/prices).
