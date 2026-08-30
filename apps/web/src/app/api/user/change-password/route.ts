import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Both passwords are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }

    // Get user's current password hash from account table (Better Auth stores it there)
    const accounts = await sql`
      SELECT password FROM account
      WHERE user_id = ${session.userId} AND provider_id = 'credential'
    `;
    const account = accounts[0];

    if (!account || !account.password) {
      return NextResponse.json({ error: 'Password authentication not available for this account' }, { status: 400 });
    }

    // Verify current password using better-auth's verifyPassword
    const isValid = await verifyPassword({ hash: account.password, password: currentPassword });

    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    // Hash new password using better-auth's hashPassword
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await sql`
      UPDATE account
      SET password = ${hashedPassword}, updated_at = NOW()
      WHERE user_id = ${session.userId} AND provider_id = 'credential'
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error changing password:', error);
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 });
  }
}
