import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { logEvent } from '../utils/logger';
import crypto from 'crypto';
import { getGateway } from '@/app/api/utils/jobs';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const orgId = session.user.id;
    const phones = await sql`
      SELECT id, phone, verified, otp_expires_at, verified_at, created_at
      FROM test_phone_numbers
      WHERE organization_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return Response.json(phones);
  } catch (error: any) {
    console.error('GET /api/test-phones error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) return Response.json({ error: 'Phone is required' }, { status: 400 });

    const orgId = session.user.id;

    // Rate limit: max 3 OTP sends per number per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentSends = await sql`
      SELECT COUNT(*)::int AS cnt FROM test_phone_otp_log
      WHERE phone = ${phone} AND organization_id = ${orgId} AND created_at > ${oneHourAgo}
    `;
    if ((recentSends[0]?.cnt ?? 0) >= 3) {
      return Response.json({ error: 'OTP rate limit exceeded. Try again later.' }, { status: 429 });
    }

    // Rate limit: max 5 verified numbers per org
    const verifiedCount = await sql`
      SELECT COUNT(*)::int AS cnt FROM test_phone_numbers
      WHERE organization_id = ${orgId} AND verified = true
    `;
    if ((verifiedCount[0]?.cnt ?? 0) >= 5) {
      return Response.json({ error: 'Maximum verified test phones (5) reached for this organization' }, { status: 400 });
    }

    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const otpHash = crypto.createHash('sha256').update(otpCode).digest('hex');

    // Send OTP via gateway (exempt from campaign caps)
    try {
      const gateway = await getGateway();
      await gateway.send({
        leadId: 0,
        to: phone,
        text: `Your DealFlow verification code is: ${otpCode}. Valid for 10 minutes.`,
        campaignId: 'otp-verify',
        organizationId: orgId,
        contactId: phone,
      });
    } catch (error: any) {
      console.error('OTP send failed:', error);
      return Response.json({ error: 'Failed to send OTP', detail: error.message }, { status: 500 });
    }

    // Log the send for rate limiting
    await sql`
      INSERT INTO test_phone_otp_log (id, organization_id, phone)
      VALUES (gen_random_uuid()::text, ${orgId}, ${phone})
    `;

    await logEvent('test_phone_otp_sent', 'test_phone', phone, { phone, otp_sent: true }, orgId);

    const [record] = await sql`
      INSERT INTO test_phone_numbers (id, organization_id, phone, otp_code, otp_expires_at, attempts)
      VALUES (gen_random_uuid()::text, ${orgId}, ${phone}, ${otpHash}, ${otpExpiresAt}, 0)
      ON CONFLICT (organization_id, phone) DO UPDATE SET otp_code = ${otpHash}, otp_expires_at = ${otpExpiresAt}, verified = false, attempts = 0
      RETURNING *
    `;

    return Response.json(record);
  } catch (error: any) {
    console.error('POST /api/test-phones error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}