/**
 * POST /api/auth/reset-password
 *
 * Validates a password reset token and updates the user's password.
 */
import { NextRequest } from 'next/server';
import sql from '@/app/api/utils/sql';
import { hashPassword } from 'better-auth/crypto';

export async function POST(req: NextRequest) {
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
    const tokens = await sql`
      SELECT id, user_id, expires_at, used_at
      FROM password_reset_tokens
      WHERE token = ${token}
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
