/**
 * Phase P2 — Dev-only mock checkout completion endpoint.
 *
 * Simulates a successful Stripe Checkout session completion. Fires the same
 * webhook event that Stripe would send in production.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';
import { escapeHtml } from '@/app/api/utils/escapeHtml';

export async function POST(request: Request) {
  // Hard production gate (BREAKAGE_TABLE #34) — see mock-checkout/route.ts
  // for why the pi_mock_ prefix alone was never a real safety boundary.
  if (process.env.NODE_ENV === 'production') {
    return new Response(JSON.stringify({ error: 'Not available in production' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await request.formData();
    const paymentIntentId = formData.get('pi') as string;
    const contractId = formData.get('contractId') as string;
    const amount = formData.get('amount') as string;

    if (!paymentIntentId || !contractId || !amount) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // The GET page checks this prefix, but /complete itself never did — this
    // endpoint alone could flip ANY payment intent id to paid.
    if (!paymentIntentId.startsWith('pi_mock_')) {
      return new Response(JSON.stringify({ error: 'Invalid PI ID for mock endpoint' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Simulate a payment_intent.succeeded webhook event
    const eventId = `evt_mock_${crypto.randomUUID()}`;

    // Update the ledger
    await sql`
      UPDATE payments_ledger
      SET status = 'paid',
          stripe_event_ids = array_append(stripe_event_ids, ${eventId}),
          paid_at = NOW()
      WHERE stripe_payment_intent_id = ${paymentIntentId} AND status = 'sent'
    `;

    await logEvent('payment_paid', 'contract', contractId, {
      paymentIntentId,
      amountCents: Number(amount),
      source: 'mock-checkout',
    });

    // Return success page
    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>Payment Successful</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
  h1 { color: #16a34a; margin-bottom: 0.5rem; }
  .badge { background: #dcfce7; color: #15803d; padding: 0.5rem 1rem; border-radius: 999px; font-weight: 600; display: inline-block; margin-bottom: 1rem; }
  p { color: #555; }
</style></head>
<body>
  <div class="card">
    <div class="badge">✓ PAID</div>
    <h1>Payment Successful</h1>
    <p>Your assignment fee has been processed. This window can be closed.</p>
    <p style="font-size: 0.875rem; color: #999;">Contract: ${escapeHtml(contractId.slice(0, 8))}… | Amount: $${(Number(amount) / 100).toFixed(2)}</p>
  </div>
</body>
</html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error: any) {
    console.error('mock-checkout complete error', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}