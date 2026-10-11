import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import { requireGamificationEnabled } from '@/app/api/utils/gamification.server';
import {
  CRATES,
  type CrateKey,
} from '@/app/api/utils/crates';
import {
  equipCosmetic,
  getUserCrateInventory,
  openCrateForUser,
} from '@/app/api/utils/crates.server';

const ACTIONS = ['open', 'equip'] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: unknown): value is Action {
  return ACTIONS.includes(value as Action);
}

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const disabled = await requireGamificationEnabled(session.userId);
  if (disabled) return disabled;

  try {
    const payload = await getUserCrateInventory(session.userId);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[CRATES] Error fetching crate inventory:', error);
    return NextResponse.json({ error: 'Failed to load crates' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const disabled = await requireGamificationEnabled(session.userId);
  if (disabled) return disabled;

  let body: { action?: unknown; crateKey?: unknown; cosmeticKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isAction(body.action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'open': {
        if (typeof body.crateKey !== 'string') {
          return NextResponse.json({ error: 'Invalid crateKey' }, { status: 400 });
        }

        if (!(body.crateKey in CRATES)) {
          return NextResponse.json({ error: 'Invalid crateKey' }, { status: 400 });
        }

        const result = await openCrateForUser(session.userId, body.crateKey as CrateKey);
        if (!result.ok) {
          return NextResponse.json({ error: result.reason }, { status: 409 });
        }

        return NextResponse.json({
          cosmeticKey: result.cosmeticKey,
          cosmeticName: result.cosmeticName,
          rarity: result.rarity,
          xpAwarded: result.xpAwarded,
        });
      }

      case 'equip': {
        if (typeof body.cosmeticKey !== 'string' || body.cosmeticKey.length === 0) {
          return NextResponse.json({ error: 'Invalid cosmeticKey' }, { status: 400 });
        }

        const result = await equipCosmetic(session.userId, body.cosmeticKey);
        if (!result.ok) {
          return NextResponse.json({ error: result.reason }, { status: 400 });
        }

        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    console.error('[CRATES] Route action failed:', error);
    return NextResponse.json(
      { error: 'Crate action failed', detail: error instanceof Error ? error.message : 'unknown' },
      { status: 500 },
    );
  }
}
