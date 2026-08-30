import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';

// Valid timezones for the application
const VALID_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'UTC',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney'
];

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Query from better-auth's "user" table with optional profile fields
    // The user table schema: id, name, email, emailVerified, image, role, createdAt, updatedAt
    // Extended fields may include: phone, timezone, credits_balance, subscription_tier
    const [user] = await sql`
      SELECT
        id, name, email, role, image,
        "createdAt" as created_at, "updatedAt" as updated_at,
        COALESCE(phone, '') as phone,
        COALESCE(timezone, 'America/New_York') as timezone,
        COALESCE(credits_balance, 0) as credits_balance,
        COALESCE(subscription_tier, 'free') as subscription_tier
      FROM "user"
      WHERE id = ${session.userId}
      LIMIT 1
    `;

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'MEMBER',
      image: user.image || null,
      phone: user.phone || null,
      timezone: user.timezone || 'America/New_York',
      created_at: user.created_at,
      updated_at: user.updated_at,
      credits_balance: parseInt(user.credits_balance) || 0,
      subscription_tier: user.subscription_tier || 'free',
    });
  } catch (error) {
    console.error('[PROFILE] Error fetching profile:', error);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, phone, timezone } = body;

    // Validate inputs
    if (name !== undefined && typeof name !== 'string') {
      return NextResponse.json({ error: 'Invalid name format' }, { status: 400 });
    }

    if (name !== undefined && name.trim().length < 2) {
      return NextResponse.json({ error: 'Name must be at least 2 characters' }, { status: 400 });
    }

    if (phone !== undefined && typeof phone !== 'string') {
      return NextResponse.json({ error: 'Invalid phone format' }, { status: 400 });
    }

    // Validate timezone - default to existing or America/New_York
    const tz = VALID_TIMEZONES.includes(timezone) ? timezone : 'America/New_York';

    // Sanitize phone: allow only digits, spaces, dashes, plus, parentheses
    const sanitizedPhone = phone ? phone.replace(/[^\d\s\-+()]/g, '').slice(0, 20) : null;

    // Update the user table with profile fields
    await sql`
      UPDATE "user"
      SET
        name = COALESCE(${name?.trim() || null}, name),
        phone = ${sanitizedPhone},
        timezone = ${tz},
        "updatedAt" = NOW()
      WHERE id = ${session.userId}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PROFILE] Error updating profile:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
