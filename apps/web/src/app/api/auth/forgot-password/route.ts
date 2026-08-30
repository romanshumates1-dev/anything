/**
 * POST /api/auth/forgot-password
 *
 * Sends a password reset email with a time-limited token.
 * Uses the same email driver as outbound campaigns.
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import crypto from 'crypto';
import { rateLimitByUser } from '@/app/api/utils/rateLimit';

const TOKEN_EXPIRY_HOURS = 1;

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return Response.json({ error: 'Valid email required' }, { status: 400 });
  }

  // Rate limit: 3 reset requests per email per hour
  const rateLimit = await rateLimitByUser(email, 'password_reset', 3, 3600);
  if (!rateLimit.allowed) {
    return Response.json({ ok: true }); // Don't reveal rate limit (enumeration prevention)
  }

  try {
    const [user] = await sql`
      SELECT id, email, name FROM "user" WHERE lower(email) = ${email} LIMIT 1
    `;

    if (!user) {
      return Response.json({ ok: true });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await sql`
      INSERT INTO password_reset_tokens (id, user_id, token, expires_at)
      VALUES (${crypto.randomUUID()}, ${user.id}, ${tokenHash}, ${expiresAt})
    `;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || 'http://localhost:4000';
  const resetUrl = `${baseUrl}/account/reset-password?token=${token}`;

  const emailProviderUrl = process.env.EMAIL_PROVIDER_URL;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'noreply@dealswiftautomation.com';

  if (emailProviderUrl) {
    try {
      await fetch(emailProviderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EMAIL_PROVIDER_API_KEY
            ? { Authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          from: fromAddress,
          to: user.email,
          subject: 'Reset your password',
          text: `Hi ${user.name || 'there'},

You requested a password reset. Click the link below to set a new password:

${resetUrl}

This link expires in ${TOKEN_EXPIRY_HOURS} hour(s).

If you didn't request this, you can safely ignore this email.

---
DealFlow AI`,
        }),
      });
    } catch (error) {
      console.error('Failed to send password reset email:', error);
    }
  } else {
    console.log('[DEV] Password reset link:', resetUrl);
  }

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    return Response.json({ ok: true });
  }
}
