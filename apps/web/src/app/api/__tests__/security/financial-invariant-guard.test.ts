/**
 * FINANCIAL INVARIANT GUARD.
 *
 * These encode the money rules that an adversarial pass confirmed hold, so a later
 * refactor cannot quietly reintroduce the same defects. Each assertion is tied to a
 * concrete property, not to a snapshot of the current implementation.
 *
 * Classes covered:
 *   A. client-authoritative money   - no route may price/credit itself from a request field
 *   B. replay / double-apply        - financial POSTs need an idempotency mechanism
 *   C. forged provider events       - webhooks need signature verification
 *   D. non-atomic balance updates   - the ledger must guard inside the UPDATE itself
 *   E. surrogate-id replay guard    - a manual "mark paid" must be a compare-and-swap
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const R = (...p: string[]) => readFileSync(join(process.cwd(), "src", "app", ...p), "utf8");

describe("financial invariant guard", () => {
  it("E. Stripe credit grant is idempotent per PURCHASE and replays are deduplicated", () => {
    const s = R("api", "payments", "webhook", "route.ts");
    // Replay dedupe: an already-seen event id must be refused before any grant.
    expect(s).toMatch(/=\s*ANY\s*\(\s*stripe_event_ids\s*\)/i);
    // The grant must carry a deterministic idempotency key - anchored on the
    // Checkout SESSION, not the event.
    //
    // This assertion previously demanded an event-derived key. That was the
    // weaker invariant and it was wrong: one purchase produces one session but
    // MANY events (Stripe assigns a fresh evt_... id per delivery, and a
    // dashboard resend mints a new one for the SAME purchase), so an
    // event-keyed grant re-credited the customer on every re-delivery and the
    // unique index on credit_transactions.idempotency_key could never collapse
    // them. The session IS the purchase, so it is the anchor.
    expect(s).toMatch(/idempotencyKey:\s*`[^`]*\$\{session\.id\}`/);
    // Guard against regression: the credit-pack branch must never key on the
    // event again.
    expect(s).not.toMatch(/idempotencyKey:\s*`[^`]*\$\{event\.id\}`/);
    // Plan activation uses the same anchor, so the branches cannot drift apart.
    expect(s).toMatch(/processorReference:\s*session\.id/);
  });

  it("D. the credit ledger guards sufficiency inside the UPDATE, not in a prior read", () => {
    const s = R("api", "utils", "credits.ts");
    // Row lock, and the balance predicate must live in the same statement as the debit.
    // A SELECT-then-UPDATE pair lets two concurrent requests both pass the check.
    expect(s).toMatch(/FOR UPDATE/i);
    expect(s).toMatch(/UPDATE\s+credit_balances[\s\S]{0,400}?balance\s*>=/i);
    expect(s).toMatch(/available_balance\s*>=/i);
  });

  it("A. credit pricing is server-authoritative", () => {
    const s = R("api", "credits", "purchase", "route.ts");
    // Pack price/credits must come from the server-side table, keyed by a validated id.
    expect(s).toMatch(/packId\s+in\s+CREDIT_PACKS/);
    // The immediate-grant path must be unreachable in production and fail closed.
    expect(s).toMatch(/testMode\s*&&\s*process\.env\.NODE_ENV\s*!==\s*'production'/);
    expect(s).toMatch(/NODE_ENV\s*===\s*'production'\s*&&\s*\(!stripeKey\s*\|\|\s*!webhookSecret\)/);
  });

  it("C. the webhook verifies signatures and cannot run unsigned in production", () => {
    const s = R("api", "payments", "webhook", "route.ts");
    // The mock provider accepts ANY signature, so mock-in-production would be a full
    // payment-forgery primitive. It must fail closed unless explicitly opted in.
    expect(s).toMatch(/providerType\s*===\s*'mock'/);
    expect(s).toMatch(/process\.env\.NODE_ENV\s*===\s*'production'/);
    expect(s).toMatch(/ALLOW_MOCK_PAYMENT_WEBHOOKS\s*!==\s*'1'/);
    // Signature check must run for every provider, after that guard.
    expect(s).toMatch(/provider\.verifyWebhook\(\{\s*body,\s*signature\s*\}\)/);
  });

  it("E. admin mark-paid is a compare-and-swap and cannot be replayed", () => {
    const s = R("api", "payments", "mark-paid", "route.ts");
    expect(s).toMatch(/payment\.status\s*===\s*'paid'/); // refuse the second call
    expect(s).toMatch(/WHERE\s+id\s*=\s*\$\{paymentId\}\s+AND\s+status\s*!=\s*'paid'/i); // atomic guard
  });
});
