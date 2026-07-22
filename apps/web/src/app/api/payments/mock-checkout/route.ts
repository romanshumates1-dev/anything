/**
 * Phase P2 — Dev-only mock checkout endpoint.
 *
 * Simulates a Stripe hosted checkout page. In dev, the mock provider generates
 * a link pointing here. The user clicks "Pay Now" to simulate a successful
 * payment, which fires the same webhook path production would.
 */
import { escapeHtml } from '@/app/api/utils/escapeHtml';

export async function GET(request: Request) {
  // Hard production gate (BREAKAGE_TABLE #34): STRIPE_PROVIDER defaults to
  // 'mock', so this page and /complete were reachable — and would actually
  // flip a payment to paid — in a production deploy that hadn't explicitly
  // configured live Stripe. The pi_mock_ prefix check alone is not a real
  // gate once mock is the default provider.
  if (process.env.NODE_ENV === 'production') {
    return new Response(JSON.stringify({ error: 'Not available in production' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(request.url);
  const paymentIntentId = searchParams.get('pi');
  const contractId = searchParams.get('contractId');
  const amount = searchParams.get('amount');

  if (!paymentIntentId || !contractId || !amount) {
    return new Response(JSON.stringify({ error: 'Missing required params' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only process mock PI IDs (defense in depth — the real gate is the
  // NODE_ENV check above).
  if (!paymentIntentId.startsWith('pi_mock_')) {
    return new Response(JSON.stringify({ error: 'Invalid PI ID for mock endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const amountDollars = (Number(amount) / 100).toFixed(2);

  return new Response(
    `<!DOCTYPE html>
<html>
<head><title>Mock Checkout</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 420px; }
  h1 { color: #1a1a1a; margin-bottom: 0.5rem; font-size: 1.5rem; }
  .amount { font-size: 2rem; font-weight: 700; color: #16a34a; margin: 1rem 0; }
  p { color: #555; margin-bottom: 1.5rem; }
  .btn { display: inline-block; padding: 0.75rem 2rem; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; font-size: 1rem; margin: 0.5rem; }
  .btn-primary { background: #16a34a; color: white; }
  .btn-primary:hover { background: #15803d; }
  .btn-secondary { background: #e5e7eb; color: #374151; }
  .btn-secondary:hover { background: #d1d5db; }
  .badge { background: #fef3c7; color: #92400e; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.75rem; display: inline-block; margin-bottom: 1rem; }
  .note { font-size: 0.75rem; color: #999; margin-top: 1rem; }
</style></head>
<body>
  <div class="card">
    <div class="badge">🧪 MOCK CHECKOUT</div>
    <h1>Assignment Fee Payment</h1>
    <p>Contract #${escapeHtml(contractId.slice(0, 8))}…</p>
    <div class="amount">$${amountDollars}</div>
    <p>This is a mock payment page for development.</p>
    <form action="/api/payments/mock-checkout/complete" method="POST">
      <input type="hidden" name="pi" value="${escapeHtml(paymentIntentId)}" />
      <input type="hidden" name="contractId" value="${escapeHtml(contractId)}" />
      <input type="hidden" name="amount" value="${escapeHtml(amount)}" />
      <button type="submit" class="btn btn-primary">Pay $${amountDollars}</button>
    </form>
    <p class="note">No real payment will be processed. This simulates a successful Stripe Checkout session.</p>
  </div>
</body>
</html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }
  );
}