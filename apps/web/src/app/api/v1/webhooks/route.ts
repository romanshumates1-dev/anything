import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';
import { authenticateApiKey } from '../auth/utils';
import { encryptSensitive, safeDecrypt } from '@/app/api/utils/encryption';
import { assertSafeOutboundUrl } from '@/app/api/utils/ssrf';

/**
 * Customer-configured outbound webhook registration (v1 API).
 *
 * Auth is an API key, and every query is scoped to the key's organization.
 *
 * SSRF: the destination `url` is fully caller-controlled and will be POSTed to
 * by the delivery worker. An unvalidated URL is a stored SSRF primitive - a
 * tenant could register http://169.254.169.254/... (cloud metadata),
 * http://127.0.0.1:5432/... (internal database) or an internal admin host, and
 * have the platform fetch it from inside the network. The delivery worker does
 * not exist yet, so this is LATENT rather than live, but storing an unvalidated
 * target is a trap for whoever writes it, and the check belongs at the trust
 * boundary - on input, not at the far end of a future fetch.
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;

  try {
    const organizationId = authResult.organizationId!;
    const webhooks = await sql`
      SELECT id, url, events, active, last_delivery_at, created_at
      FROM webhooks
      WHERE organization_id = ${organizationId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ data: webhooks });
  } catch (error: any) {
    console.error('GET /api/v1/webhooks error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateApiKey(request);
  if (!authResult.valid) return authResult.response!;

  try {
    const body = await request.json();
    const { url, events = [] } = body as { url: string; events: string[] };

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // Reject a non-HTTPS or internal destination BEFORE persisting it.
    try {
      assertSafeOutboundUrl(url);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid webhook url' },
        { status: 400 }
      );
    }

    if (!Array.isArray(events) || events.some((e) => typeof e !== 'string')) {
      return NextResponse.json({ error: 'events must be an array of strings' }, { status: 400 });
    }

    const organizationId = authResult.organizationId!;
    const secret = crypto.randomBytes(16).toString('hex');
    const encryptedSecret = encryptSensitive(secret);

    const [webhook] = await sql`
      INSERT INTO webhooks (id, organization_id, url, secret, events)
      VALUES (gen_random_uuid()::text, ${organizationId}, ${url}, ${encryptedSecret}, ${events})
      RETURNING id, url, events, active, last_delivery_at, created_at
    `;

    // Return plaintext secret only on creation (user must save it)
    return NextResponse.json({ ...webhook, secret }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/v1/webhooks error', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}