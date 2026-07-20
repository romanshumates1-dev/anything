/**
 * Phase P1 — Dev-only mock-sign endpoint.
 *
 * This simulates an e-sign provider firing a webhook. In dev, the mock provider
 * generates a signing link pointing here. Clicking "simulate sign" triggers this
 * endpoint, which behaves identically to the real e-sign webhook path.
 *
 * In production/CI this route is inert — it only responds to mock envelope IDs.
 */
import sql from '@/app/api/utils/sql';
import { logEvent } from '@/app/api/utils/logger';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const envelopeId = searchParams.get('envelopeId');
  const contractId = searchParams.get('contractId');

  if (!envelopeId || !contractId) {
    return new Response(JSON.stringify({ error: 'Missing envelopeId or contractId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Only process mock envelope IDs (safety check — real providers never use mock_ prefix)
  if (!envelopeId.startsWith('mock_env_')) {
    return new Response(JSON.stringify({ error: 'Invalid envelope ID for mock endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Record the signed event (same logic as the real webhook handler)
    const eventId = `mock_sign_${crypto.randomUUID()}`;

    await sql`
      INSERT INTO esign_events (id, contract_id, event_type, external_event_id, event_data)
      VALUES (${eventId}, ${contractId}, 'signed', ${envelopeId}, ${JSON.stringify({
        envelopeId,
        signedAt: new Date().toISOString(),
        source: 'mock-simulate',
      })})
      ON CONFLICT (contract_id, external_event_id) WHERE external_event_id IS NOT NULL
      DO NOTHING
    `;

    // Update contract esign_status
    await sql`
      UPDATE contracts SET esign_status = 'signed', signed_at = NOW()
      WHERE id = ${contractId}
    `;

    await logEvent('contract_signed', 'contract', contractId, {
      envelopeId,
      source: 'mock-simulate',
    });

    // Return a simple HTML page with success + a close button
    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>Contract Signed</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
  h1 { color: #16a34a; margin-bottom: 0.5rem; }
  p { color: #555; margin-bottom: 1.5rem; }
  .badge { background: #dcfce7; color: #15803d; padding: 0.5rem 1rem; border-radius: 999px; font-weight: 600; display: inline-block; margin-bottom: 1rem; }
</style></head>
<body>
  <div class="card">
    <div class="badge">✓ SIGNED</div>
    <h1>Document Signed</h1>
    <p>The contract has been signed successfully. This window can be closed.</p>
    <p style="font-size: 0.875rem; color: #999;">Contract: ${contractId.slice(0, 8)}… | Envelope: ${envelopeId.slice(0, 16)}…</p>
  </div>
</body>
</html>`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  } catch (error: any) {
    console.error('mock-sign error', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}