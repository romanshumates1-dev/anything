import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const envelopeId = searchParams.get('envelopeId');
  const contractId = searchParams.get('contractId');

  if (!envelopeId || !contractId) {
    return new Response('Missing envelopeId or contractId', { status: 400 });
  }

  const webhookUrl = new URL('/api/esign/webhook', request.url).toString();

  const signedEvent = {
    event_type: 'signed',
    envelope_id: envelopeId,
    contract_id: contractId,
    event_id: `mock_evt_signed_${crypto.randomUUID()}`,
    signed_at: new Date().toISOString(),
    event_data: {
      signer: 'Mock Signer',
      ip_address: '127.0.0.1',
    },
  };

  const viewedEvent = {
    ...signedEvent,
    event_type: 'viewed',
    event_id: `mock_evt_viewed_${crypto.randomUUID()}`,
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Mock E-Sign</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: sans-serif; max-width: 800px; margin: auto; padding: 1rem; background-color: #f7f7f7; }
        h1, h2 { color: #333; }
        pre { background-color: #eee; padding: 1rem; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; }
        button { background-color: #007bff; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; margin-top: 10px; }
        button:hover { background-color: #0056b3; }
      </style>
    </head>
    <body>
      <h1>Mock E-Sign Simulation</h1>
      <p>This page simulates the e-signing process for development purposes.</p>
      
      <h2>Contract Details</h2>
      <p><strong>Contract ID:</strong> ${contractId}</p>
      <p><strong>Envelope ID:</strong> ${envelopeId}</p>

      <h2>Simulate Webhook Events</h2>
      <p>Click a button to send a mock webhook event to the <code>/api/esign/webhook</code> endpoint.</p>

      <button id="viewedBtn">Simulate 'viewed' Event</button>
      <button id="signedBtn">Simulate 'signed' Event</button>
      
      <script>
        const webhookUrl = '${webhookUrl}';
        const viewedPayload = ${JSON.stringify(viewedEvent)};
        const signedPayload = ${JSON.stringify(signedEvent)};

        async function sendWebhook(payload) {
          try {
            const response = await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                // In a real mock, the signature would be generated. For dev,
                // we rely on the webhook handler's mock provider check because
                // process.env.ESIGN_PROVIDER is 'mock'.
                'x-esign-signature': 'mock-signature'
              },
              body: JSON.stringify(payload)
            });
            
            const result = await response.json();
            alert('Webhook sent!
Status: ' + response.status + '
Response: ' + JSON.stringify(result, null, 2));
          } catch (error) {
            alert('Error sending webhook: ' + error);
          }
        }

        document.getElementById('viewedBtn').addEventListener('click', () => sendWebhook(viewedPayload));
        document.getElementById('signedBtn').addEventListener('click', () => sendWebhook(signedPayload));
      </script>
    </body>
    </html>
  `;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
