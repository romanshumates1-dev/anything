<!-- TEMPLATE — requires owner execution against real infrastructure before launch -->
# GO_LIVE_CHECKLIST.md — DealFlow AI production validation runbook

_Author: session (p), 2026-07-20. Scope: what "true production validation" requires, who must
perform each step, the exact verification that proves it, and the honest gaps that currently block
parts of it._

## 0. Read this first — assurance tiers (no rounding up)

There are three distinct tiers of assurance. Do not conflate them.

| Tier | What it proves | Status in repo |
|---|---|---|
| **Pre-prod verification** | Code compiles, pure logic is correct, unit/integration green | ✅ done — `tsc` exit 0; vitest 511 passed / 46 skipped / 0 failed |
| **Zero-cost pipeline proof** | The *real* send/webhook/metering code path executes against Twilio **test credentials** + Stripe **test mode** — no billable traffic | ⚠️ partial — see §3 and the Gap Register (§6) |
| **Production validation** | Live infra, live keys, an **approved 10DLC campaign**, one real delivered SMS, metering + billing observed on real data | ❌ not done — owner-only; requires steps §5 |

**This runbook cannot be executed by the coding agent.** It requires production credentials (secrets),
financial actions (funding Twilio, live Stripe), and a carrier-gated regulatory process (10DLC) that
is external and multi-week. Every step below is marked with its actor.

---

## 1. The go-live argument — zero application code differs between modes

**Claim:** flipping DealFlow from mock → Twilio-test → live SMS, and from Stripe test → live, is a
**credentials change, not a code change.** Proof by file/line:

### SMS
- The send path selects transport **only on the presence of Twilio env**, nothing else:
  [`jobs.ts:135`](../apps/web/src/app/api/utils/jobs.ts:135) — `if (payload.channel === 'sms' && getTwilioConfig())` → `SMSGateway.send()`; else the mock `sendMessage()` fallback.
- `getTwilioConfig()` reads only env (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`) — see [`jobs.ts:80-96`](../apps/web/src/app/api/utils/jobs.ts:80).
- The gateway itself is **mode-agnostic** — it calls `provider.send()` through the `ISMSProvider`
  interface and never inspects credentials or mode: [`sms-gateway.ts:129-373`](../apps/web/src/app/api/gateway/sms-gateway.ts:129).
- The **only** place transport differs is inside `TwilioAdapter.send()` → `client.messages.create()`:
  [`providers.ts:69-97`](../apps/web/src/app/api/gateway/providers.ts:69). Test creds and live creds
  hit the identical call; Twilio decides billing server-side by the key type.

**Therefore:** `twilio_test` and `live` run the *same* gateway + adapter code. Only the values of
`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` (+ a Messaging Service bound to an approved 10DLC campaign)
change. ✅ This property holds today for test↔live.

### Stripe
- One Stripe client, one code path; mode is derived from the key prefix, and nothing branches on it:
  [`stripe.ts:getStripe()/stripeMode()`](../apps/web/src/app/api/utils/stripe.ts:30). `sk_test_…` → test,
  `sk_live_…` → live. Checkout, portal, and webhook routes are byte-identical across modes.

---

## 2. The three SMS modes (all selected by env only)

| Mode | Env | Hits Twilio API? | Bills? | Purpose |
|---|---|---|---|---|
| `mock` | no Twilio creds | no | no | CI default; simulated delivery via `sendMessage()` fallback |
| `twilio_test` | `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` = **Test** creds | yes (validated, never sent) | **no** | zero-cost proof of the real gateway + adapter |
| `live` | Live creds + Messaging Service SID (approved 10DLC) | yes | **yes** | production |

**Twilio magic numbers (twilio_test)** — prove success + each error class through the real pipeline:
`+15005550006` (from) → valid SID · `+15005550001` (to) → error 21211 invalid · `+15005550004` (to)
→ 21610 blocked/unsubscribed · `+15005550008` (from) → queue-full/backoff.

---

## 3. Zero-cost proof (do this BEFORE live — no billable traffic)

Actor: **owner/dev**, locally or in staging, with Twilio **Test** credentials in `.env.test`.

1. Set `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` to the Test SID/token from the Twilio console;
   set `TWILIO_FROM_NUMBER=+15005550006`.
2. Migrate a scratch DB from empty: `node apps/web/scripts/migrate.mjs` → expect `014_billing` applied.
3. Create a campaign, add a lead with `to=+15005550006`, launch it, run the worker.
4. **Verify (SQL):**
   ```sql
   SELECT id, status, provider, metadata->>'providerMessageId' AS sid
   FROM message_events WHERE direction='outbound' ORDER BY created_at DESC LIMIT 5;
   -- expect status='dispatched', provider='twilio', sid LIKE 'SM%'
   ```
5. Repeat with `to=+15005550001` → expect the lead marked failed/undeliverable and the worker
   continuing the batch (error 21211 caught, not a crash).

> ✅ **G-1 is fixed:** with `PUBLIC_WEBHOOK_URL`/`TWILIO_STATUS_CALLBACK_URL` set, the adapter asks
> Twilio to POST status callbacks to `/api/sms/status`, which advances `message_events`
> `dispatched`→`sent`→`delivered`. The route + signature verification are unit-verified; observing
> the transitions end-to-end needs live/twilio_test creds delivering the callbacks.

---

## 4. Stripe test-mode proof (billing, no real charge)

Actor: **owner/dev** with Stripe **test** keys.

1. `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…` (from `stripe listen`), and
   `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PROFESSIONAL` = test Price ids.
2. `stripe listen --forward-to localhost:PORT/api/billing/webhook`.
3. `POST /api/billing/checkout {plan:"starter"}` → open the returned `url`, pay with `4242 4242 4242 4242`.
4. **Verify (SQL):**
   ```sql
   SELECT plan, status, stripe_subscription_id, current_period_end
   FROM subscriptions WHERE user_id = '<uid>';         -- status='trialing'|'active'
   SELECT event_id, type FROM billing_events ORDER BY created_at DESC LIMIT 5;  -- checkout.session.completed present once
   ```
5. **Replay guard:** re-send the same event id via `stripe events resend <id>` → `billing_events` row
   count for that id stays 1; no second activation.
6. **Invalid signature:** `curl -XPOST …/api/billing/webhook -d '{}'` (no/garbage `stripe-signature`)
   → **403**.

---

## 5. Production validation runbook (owner-only) — mapped to your 12 steps

Each step: **actor · action · verification-that-proves-it.**

| # | Your step | Actor | Action | Verification (proof) |
|---|---|---|---|---|
| 1 | Deploy production backend | owner | Deploy web + worker to the platform (Docker/compose exists — see `SESSION_HANDOFF`) with the prod origin set | `GET /api/system/health` → `{ok:true,...,services:{db,jobs,ai,sms}}` |
| 2 | Connect production database | owner | Set `DATABASE_URL` to prod Neon; run `node apps/web/scripts/migrate.mjs` | Migrate log shows `001`→`014` applied; `SELECT count(*) FROM subscriptions` succeeds |
| 3 | Production env vars | owner | Fill every var in `.env.example` in the platform secret store (never in git) | Boot succeeds; **see Gap G-4** (no boot-time env validation yet — a missing var may surface late) |
| 4 | Stripe live mode | **owner only** | Put `sk_live_…` + live `whsec_…` + live Price ids in secrets; add the live webhook endpoint in the Stripe dashboard | `stripeMode()` returns `live`; a live webhook test delivery → 200 |
| 5 | Production Twilio | **owner only** | Live Account SID/Auth Token; **fund the account / enable auto-recharge** | Twilio console balance > 0; `getTwilioConfig()` truthy in prod |
| 6 | Complete 10DLC approval | **owner + carriers** | Register Brand + Campaign in The Campaign Registry; attach purchased numbers to a Messaging Service; set `TWILIO_MESSAGING_SERVICE_SID` | Twilio console: campaign status **APPROVED**; numbers attached to the service |
| 7 | Send one real SMS | **owner only** | With consent, launch a 1-lead campaign to a number you own | `message_events.status='dispatched'`, `sid LIKE 'SM%'`; phone receives it |
| 8 | Verify delivery callback | owner | Set `PUBLIC_WEBHOOK_URL` (or `TWILIO_STATUS_CALLBACK_URL`) so the adapter tells Twilio to call `…/api/sms/status` | ✅ route built + unit-verified (G-1 fixed). After a real send, `message_events.status` advances `dispatched`→`sent`→`delivered`; `audit_logs.action='message_status_callback'`. End-to-end observation still needs live/twilio_test creds |
| 9 | Verify usage metering | owner | After the send, check the period counter | `SELECT count FROM usage_counters WHERE user_id='<uid>' AND metric='sms_segments' AND period=to_char(now(),'YYYY-MM')` increased by the segments sent. ⚠️ currently metered at **launch** (projected), not on delivered segment — see Gap G-5 |
| 10 | Verify billing | owner | Confirm the subscription funds the usage | `subscriptions.status IN ('trialing','active')`; entitlement `checkUsage` returns `allowed` while under cap |
| 11 | Verify subscription quota enforcement | owner | Launch a campaign that would exceed the plan's SMS allowance | Launch returns **402** with `error.code='USAGE_CAP'`; `audit_logs` has `campaign_launch_blocked`. Proven server-side at [`launch/route.ts`](../apps/web/src/app/api/campaigns/[id]/launch/route.ts) |
| 12 | Verify logs & monitoring | owner | Exercise a send + a failure | `audit_logs` rows: `message_dispatched_gateway`, `message_suppressed*`, `campaign_started`; worker logs unhandled-rejection free. ⚠️ no external APM wired (Gap G-6) |

---

## 6. Gap register — what currently blocks full production validation (honest)

These were found by reading the real code this session. Each blocks or limits a step above.

| ID | Gap | Evidence (file:line) | Blocks | Fix |
|---|---|---|---|---|
| **G-1** | ~~No Twilio delivery-status callback route.~~ **FIXED (session p) — implemented + unit-verified.** | Route [`sms/status/route.ts`](../apps/web/src/app/api/sms/status/route.ts) (signature-verified, out-of-order guarded, idempotent); `statusCallback` wired in [`providers.ts`](../apps/web/src/app/api/gateway/providers.ts:73) via `twilioStatusCallbackUrl()`; tests [`status/route.test.ts`](../apps/web/src/app/api/sms/status/route.test.ts) 5/5. | ~~Step 8~~ — now unblocked pending live/twilio_test creds | Done. Owner sets `PUBLIC_WEBHOOK_URL`/`TWILIO_STATUS_CALLBACK_URL` + registers the URL on the Messaging Service. |
| **G-2** | **No gateway-injected `MockSmsProvider`.** The "mock" mode is a *separate* seam (`messaging.ts sendMessage`), so CI never exercises the real gateway/circuit-breaker/message_events path. | mock branch at [`messaging.ts:118-131`](../apps/web/src/app/api/utils/messaging.ts:118); gateway only ever gets `TwilioAdapter` at [`jobs.ts:82`](../apps/web/src/app/api/utils/jobs.ts:82) | Part-B Mode-1 zero-cost gateway proof | Add `MockSmsProvider implements ISMSProvider`; inject into `getGateway()` when `SMS_MODE=mock`; POST simulated callbacks to the G-1 route with a valid signature. |
| **G-3** | **Idempotency is in-memory (`Map`).** Multi-instance prod deploys won't dedupe across workers. | [`sms-gateway.ts:79-84`](../apps/web/src/app/api/gateway/sms-gateway.ts:79) (comment: "for production, use Redis") | Exactly-once sends at scale | Back idempotency with `message_events.id` (unique) or a Redis key. |
| **G-4** | **No boot-time env validation.** A missing required var surfaces at first use, not at startup. | no zod env schema found | Step 3 confidence | Add a zod env schema that exits with a named error on boot (web + worker). |
| **G-5** | **Usage metered at launch (projected), not per delivered segment.** | `consumeUsage(... 'sms_segments', queued)` at [`launch/route.ts`](../apps/web/src/app/api/campaigns/[id]/launch/route.ts) | Precise metering (step 9) | Also meter on real send/segment count in the gateway result handler; reconcile against `twilio_spend_ledger`. |
| **G-6** | **No external monitoring/APM wired.** Only `audit_logs` + stdout. | grep: no Sentry/APM | Step 12 (monitoring) | Decision item — wire an error tracker + queue-depth metric, or accept audit_logs + platform logs. |
| **G-7** | **`yarn.lock` not reconciled for `stripe`.** `package.json` declares `stripe@^17.7.0`; lockfile not updated (install was TLS-blocked). | `SESSION_HANDOFF` session (p) | Clean `yarn install --immutable` in CI/deploy | Run `yarn install` where the registry is reachable. |

---

## 7. Non-code go-live items (owner)

- [ ] 10DLC Brand + Campaign **APPROVED** in The Campaign Registry (weeks; needs registered legal entity + EIN).
- [ ] Twilio balance funded / auto-recharge on.
- [ ] Webhook URLs configured on the live Messaging Service: inbound → `…/api/sms/inbound`, status → `…/api/sms/status` (after G-1).
- [ ] Stripe live webhook endpoint added; live `whsec_` in secrets.
- [ ] DNS + SSL on the production origin; `PUBLIC_WEBHOOK_URL` set (Twilio signature is computed over this exact URL — [`twilio-webhook.ts`](../apps/web/src/app/api/utils/twilio-webhook.ts)).
- [ ] Attorney sign-off on the `<!-- TEMPLATE -->` legal docs; replace `LEGAL_ENTITY_NAME` / `LEGAL_ENTITY_STATE` / `SUPPORT_EMAIL`.
- [ ] Consent records exist for every number in the first real campaign (TCPA).

---

## 8. Bottom line

The **code path is mode-invariant test↔live** (§1, proven at file:line), the **billing/quota
enforcement is real and server-side** (steps 10–11), the **Stripe test-mode round trip is runnable
now** (§4), and the **delivery-status callback route now exists and is unit-verified** (G-1 fixed).
What stands between here and a fully validated production system is: the owner-only credential +
funding + **10DLC approval** steps (§5, external and multi-week), and the remaining gaps G-2..G-7
(mock-provider fidelity, Redis idempotency, boot env validation, per-delivery metering, monitoring,
lockfile). No part of this can be truthfully marked "production-validated" until the owner runs §5
against live infra with an approved 10DLC campaign and observes one real delivered message with its
status callback and metered usage.
