import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import { requireGamificationEnabled } from '@/app/api/utils/gamification.server';
import sql from '@/app/api/utils/sql';

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Set V: "When OFF — hide gamification features, avoid unnecessary queries."
  // Server-side as well as in the nav, so the achievements query is not merely
  // unlinked but never issued. Returns 404 rather than 403, and deliberately
  // does NOT touch `user_achievements`: a user who earned progress while the
  // feature was off keeps it when they switch it back on ("do not penalize").
  const disabled = await requireGamificationEnabled(session.userId);
  if (disabled) return disabled;

  try {
    // Get all achievements with user's progress
    const achievements = await sql`
      SELECT
        a.id,
        a.key,
        a.name,
        a.description,
        a.category,
        a.rarity,
        a.points,
        a.icon,
        a.max_progress,
        COALESCE(ua.progress, 0) as progress,
        COALESCE(ua.unlocked, false) as unlocked,
        ua.unlocked_at
      FROM achievements a
      LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = ${session.userId}
      ORDER BY
        CASE a.rarity
          WHEN 'common' THEN 1
          WHEN 'uncommon' THEN 2
          WHEN 'rare' THEN 3
          WHEN 'epic' THEN 4
          WHEN 'legendary' THEN 5
        END,
        a.category,
        a.id
    `;

    // Calculate summary stats
    const totalPoints = achievements.reduce((sum, a) => sum + (a.unlocked ? a.points : 0), 0);
    const totalUnlocked = achievements.filter(a => a.unlocked).length;
    const totalAchievements = achievements.length;

    // Group by category for stats
    const byCategory = achievements.reduce((acc, a) => {
      if (!acc[a.category]) {
        acc[a.category] = { earned: 0, total: 0 };
      }
      acc[a.category].total += a.points;
      if (a.unlocked) {
        acc[a.category].earned += a.points;
      }
      return acc;
    }, {} as Record<string, { earned: number; total: number }>);

    return NextResponse.json({
      achievements: achievements.map(a => ({
        id: a.id.toString(),
        key: a.key,
        name: a.name,
        description: a.description,
        category: a.category,
        rarity: a.rarity,
        points: a.points,
        icon: a.icon,
        progress: a.progress,
        maxProgress: a.max_progress,
        // `unlocked` is sent explicitly so the client never has to infer state
        // from `unlocked_at`. An unlocked row may legitimately carry a null
        // timestamp, and inferring "locked" from a missing date would silently
        // under-count a user's real progress.
        unlocked: Boolean(a.unlocked),
        unlockedAt: a.unlocked_at?.toISOString() || null,
      })),
      summary: {
        totalPoints,
        totalUnlocked,
        totalAchievements,
        progressPercent: Math.round((totalUnlocked / totalAchievements) * 100) || 0,
        byCategory,
      },
    });
  } catch (error) {
    console.error('[ACHIEVEMENTS] Error fetching achievements:', error);
    return NextResponse.json({ error: 'Failed to fetch achievements' }, { status: 500 });
  }
}

// Update achievement progress (called by various system events)
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { achievementKey, progress, unlock } = await request.json();

    if (!achievementKey || typeof achievementKey !== 'string') {
      return NextResponse.json({ error: 'Achievement key required' }, { status: 400 });
    }

    // Progress arrives from the wire, so it is validated rather than trusted.
    // `NaN`, `'lots'`, `Infinity` and `-5` must never reach the ledger: the
    // upsert below uses GREATEST() for monotonicity, which quietly defeats a
    // malformed value rather than rejecting it.
    if (progress !== undefined && progress !== null) {
      if (typeof progress !== 'number' || !Number.isFinite(progress)) {
        return NextResponse.json({ error: 'Progress must be a finite number' }, { status: 400 });
      }
      if (progress < 0) {
        return NextResponse.json({ error: 'Progress cannot be negative' }, { status: 400 });
      }
    }

    // Set V: the same gate GET uses. POST was ungated, so a user who had turned
    // gamification off could still mint progress through a direct call — the
    // setting was enforced on display but not on write.
    const disabled = await requireGamificationEnabled(session.userId);
    if (disabled) return disabled;

    // Get achievement definition
    const [achievement] = await sql`
      SELECT id, max_progress, points FROM achievements WHERE key = ${achievementKey}
    `;

    if (!achievement) {
      return NextResponse.json({ error: 'Achievement not found' }, { status: 404 });
    }

    const maxProgress: number | null = achievement.max_progress ?? null;
    const requested = typeof progress === 'number' ? Math.floor(progress) : 0;
    // Clamping rather than rejecting: a caller that overshoots has still
    // satisfied the achievement, and refusing the write would leave a genuinely
    // earned unlock unwritable.
    const clamped = maxProgress === null ? requested : Math.min(requested, maxProgress);
    const shouldUnlock = Boolean(unlock) || (maxProgress !== null && clamped >= maxProgress);

    // ONE statement decides whether this call is the one that unlocks.
    //
    // The defect this replaces paid out whenever the REQUEST said `unlock`, not
    // when the row actually transitioned, so repeating one request credited the
    // same achievement's points indefinitely from an endpoint any authenticated
    // user can call. `was_unlocked` is captured from the pre-upsert row and
    // combined with the stored result, so the payout is a consequence of state
    // rather than of intent.
    //
    // GREATEST/OR/COALESCE keep progress monotonic and preserve the original
    // unlock timestamp, so a lower or replayed progress value cannot rewind a
    // record or restamp it.
    //
    // KNOWN LIMIT, stated rather than hidden: two callers racing on an
    // achievement that has NEVER been touched could both read `was_unlocked =
    // false` and both be credited. Closing that needs the award to live in a
    // stored function (as migration 088 does for AI credits) or a points ledger
    // keyed by unlock event. It is not fixed here, and this comment is the
    // record of it. Every sequential repeat — the actual exploit — is exact.
    const [row] = await sql`
      WITH prev AS (
        SELECT unlocked AS was_unlocked
        FROM user_achievements
        WHERE user_id = ${session.userId} AND achievement_id = ${achievement.id}
      ),
      upsert AS (
        INSERT INTO user_achievements (user_id, achievement_id, progress, unlocked, unlocked_at)
        VALUES (
          ${session.userId},
          ${achievement.id},
          ${clamped},
          ${shouldUnlock || false},
          ${shouldUnlock ? new Date() : null}
        )
        ON CONFLICT (user_id, achievement_id) DO UPDATE SET
          progress = GREATEST(user_achievements.progress, EXCLUDED.progress),
          unlocked = user_achievements.unlocked OR EXCLUDED.unlocked,
          unlocked_at = COALESCE(user_achievements.unlocked_at, EXCLUDED.unlocked_at),
          updated_at = NOW()
        RETURNING progress, unlocked
      )
      SELECT
        upsert.progress AS progress,
        upsert.unlocked AS unlocked,
        (COALESCE(prev.was_unlocked, false) = false AND upsert.unlocked) AS just_unlocked
      FROM upsert
      LEFT JOIN prev ON true
    `;

    const unlocked = Boolean(row?.unlocked ?? shouldUnlock);
    // Award ONLY on a real transition. A replayed or already-unlocked write
    // falls through here with just_unlocked = false and adds nothing.
    const justUnlocked = Boolean(row?.just_unlocked);
    const pointsAwarded = justUnlocked ? achievement.points : 0;

    // If unlocked by THIS call, update user points
    if (justUnlocked) {
      // INSERT..ON CONFLICT, not a bare UPDATE: `user_stats` has no row for a
      // user until something creates one, and this endpoint was the only thing
      // that did. A bare UPDATE would match zero rows and silently award nothing
      // to exactly the newest users. The increment stays guarded by
      // `justUnlocked`, so the upsert cannot become a second payout path.
      await sql`
        INSERT INTO user_stats (user_id, points)
        VALUES (${session.userId}, ${achievement.points})
        ON CONFLICT (user_id) DO UPDATE SET
          points = COALESCE(user_stats.points, 0) + ${achievement.points},
          updated_at = NOW()
      `;
    }

    return NextResponse.json({
      success: true,
      unlocked,
      progress: row ? row.progress : clamped,
      pointsAwarded,
    });
  } catch (error) {
    console.error('[ACHIEVEMENTS] Error updating achievement:', error);
    return NextResponse.json({ error: 'Failed to update achievement' }, { status: 500 });
  }
}
