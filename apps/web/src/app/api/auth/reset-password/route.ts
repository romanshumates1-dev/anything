/**
 * POST /api/auth/reset-password
 *
 * Validates a password reset token and updates the user's password.
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { hashPassword } from 'better-auth/crypto';
import crypto from 'crypto';
import { rateLimitByUser } from '@/app/api/utils/rateLimit';
import { getClientIp } from '@/app/api/utils/clientIp';

export async function POST(req: NextRequest) {
  // Resolve the client IP for rate limiting. The old leftmost-x-forwarded-for
  // read was attacker-controlled, so the 5/hour anti-brute-force limit below
  // could be reset simply by changing the header on each request. `getClientIp`
  // takes the proxy-appended entry and returns null when unidentifiable, in
  // which case rateLimitByUser fails closed.
  const ip = getClientIp(req);

  // Rate limit: 5 reset attempts per IP per hour (prevent brute force)
  const rateLimit = await rateLimitByUser(ip, 'password_reset_attempt', 5, 3600);
  if (!rateLimit.allowed) {
    return Response.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { token, password } = body;

  if (!token || typeof token !== 'string') {
    return Response.json({ error: 'Token required' }, { status: 400 });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  try {
    // Hash the incoming token to compare against stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokens = await sql`
      SELECT id, user_id, expires_at, used_at
      FROM password_reset_tokens
      WHERE token = ${tokenHash}
      LIMIT 1
    `;
    const resetToken = tokens[0];

    if (!resetToken) {
      return Response.json({ error: 'Invalid or expired token' }, { status: 400 });
    }

    if (resetToken.used_at) {
      return Response.json({ error: 'This reset link has already been used' }, { status: 400 });
    }

    if (new Date(resetToken.expires_at) < new Date()) {
      return Response.json({ error: 'This reset link has expired' }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);

    await sql`
      UPDATE "user"
      SET password = ${hashedPassword}, updated_at = now()
      WHERE id = ${resetToken.user_id}
    `;

    await sql`
      UPDATE password_reset_tokens
      SET used_at = now()
      WHERE id = ${resetToken.id}
    `;

    await sql`
      DELETE FROM session WHERE user_id = ${resetToken.user_id}
    `;

    return Response.json({ ok: true });
  } catch (error: any) {
    console.error('Reset password error:', error?.message || error);
    return Response.json({ error: 'Invalid or expired token' }, { status: 400 });
  }
}
