import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import crypto from 'crypto';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { code } = await request.json();
    const orgId = session.user.id;
    const phoneId = params.id;

    // Fetch the test phone record
    const [record] = await sql`
      SELECT * FROM test_phone_numbers
      WHERE id = ${phoneId} AND organization_id = ${orgId}
      LIMIT 1
    `;

    if (!record) {
      return NextResponse.json({ error: 'Test phone not found' }, { status: 404 });
    }

    if (record.verified) {
      return NextResponse.json({ error: 'Phone already verified' }, { status: 400 });
    }

    // Check expiry
    if (new Date(record.otp_expires_at) < new Date()) {
      return NextResponse.json({ error: 'OTP expired' }, { status: 400 });
    }

    // Check attempts (max 3)
    if ((record.attempts ?? 0) >= 3) {
      return NextResponse.json({ error: 'Maximum attempts exceeded. Request a new code.' }, { status: 429 });
    }

    // Verify code
    const codeHash = crypto.createHash('sha256').update(String(code)).digest('hex');
    if (codeHash !== record.otp_code) {
      // Increment attempts
      await sql`
        UPDATE test_phone_numbers SET attempts = attempts + 1 WHERE id = ${phoneId}
      `;
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
    }

    // Mark as verified
    const [updated] = await sql`
      UPDATE test_phone_numbers
      SET verified = true, verified_at = now(), otp_code = NULL, otp_expires_at = NULL
      WHERE id = ${phoneId} AND organization_id = ${orgId}
      RETURNING id, phone, verified, verified_at
    `;

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('POST /api/test-phones/[id]/verify error', error);
    return NextResponse.json({ error: 'Internal Server Error', detail: error.message }, { status: 500 });
  }
}