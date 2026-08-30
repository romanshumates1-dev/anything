import { NextResponse } from 'next/server';
import { requireSession } from '@/app/api/utils/auth';
import sql from '@/app/api/utils/sql';

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

    if (!achievementKey) {
      return NextResponse.json({ error: 'Achievement key required' }, { status: 400 });
    }

    // Get achievement definition
    const [achievement] = await sql`
      SELECT id, max_progress, points FROM achievements WHERE key = ${achievementKey}
    `;

    if (!achievement) {
      return NextResponse.json({ error: 'Achievement not found' }, { status: 404 });
    }

    // Upsert user achievement
    const shouldUnlock = unlock || (achievement.max_progress && progress >= achievement.max_progress);

    await sql`
      INSERT INTO user_achievements (user_id, achievement_id, progress, unlocked, unlocked_at)
      VALUES (
        ${session.userId},
        ${achievement.id},
        ${progress || 0},
        ${shouldUnlock || false},
        ${shouldUnlock ? sql`NOW()` : null}
      )
      ON CONFLICT (user_id, achievement_id) DO UPDATE SET
        progress = GREATEST(user_achievements.progress, EXCLUDED.progress),
        unlocked = user_achievements.unlocked OR EXCLUDED.unlocked,
        unlocked_at = COALESCE(user_achievements.unlocked_at, EXCLUDED.unlocked_at),
        updated_at = NOW()
    `;

    // If unlocked, update user points
    if (shouldUnlock) {
      await sql`
        INSERT INTO user_stats (user_id, points)
        VALUES (${session.userId}, ${achievement.points})
        ON CONFLICT (user_id) DO UPDATE SET
          points = user_stats.points + ${achievement.points},
          updated_at = NOW()
      `;
    }

    return NextResponse.json({ success: true, unlocked: shouldUnlock });
  } catch (error) {
    console.error('[ACHIEVEMENTS] Error updating achievement:', error);
    return NextResponse.json({ error: 'Failed to update achievement' }, { status: 500 });
  }
}
