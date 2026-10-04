'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { MetricValue } from '@/components/ui/MetricValue';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Award,
  Trophy,
  Star,
  Zap,
  Target,
  MessageSquare,
  Users,
  DollarSign,
  Rocket,
  Crown,
  Flame,
  Lock,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  rarity: Rarity;
  points: number;
  icon: string;
  progress?: number;
  maxProgress?: number;
  unlocked?: boolean;
  unlockedAt?: string;
}

/**
 * `unlocked` is the server's authoritative flag and decides whether the
 * achievement counts. `unlockedAt` is only a display detail — the database can
 * legitimately hold an unlocked row with a null timestamp, so it must never be
 * what decides state. `??` rather than `||` keeps a real `false` meaning false.
 */
function isUnlockedAch(a: Achievement): boolean {
  return a.unlocked ?? Boolean(a.unlockedAt);
}

const RARITY_CONFIG: Record<Rarity, { label: string; color: string; bg: string; glow: string }> = {
  common: { label: 'Common', color: 'text-gray-400', bg: 'bg-gray-500/10', glow: '' },
  uncommon: { label: 'Uncommon', color: 'text-green-400', bg: 'bg-green-500/10', glow: 'shadow-green-500/20' },
  rare: { label: 'Rare', color: 'text-blue-400', bg: 'bg-blue-500/10', glow: 'shadow-blue-500/30' },
  epic: { label: 'Epic', color: 'text-purple-400', bg: 'bg-purple-500/10', glow: 'shadow-purple-500/40' },
  legendary: { label: 'Legendary', color: 'text-amber-400', bg: 'bg-amber-500/10', glow: 'shadow-amber-500/50' },
};

const ICON_MAP: Record<string, React.ElementType> = {
  star: Star,
  trophy: Trophy,
  zap: Zap,
  target: Target,
  message: MessageSquare,
  users: Users,
  dollar: DollarSign,
  rocket: Rocket,
  crown: Crown,
  flame: Flame,
  sparkles: Sparkles,
  award: Award,
};

/** Server-computed aggregates, mirrored by `GET /api/achievements`. */
interface Summary {
  totalPoints: number;
  totalUnlocked: number;
  totalAchievements: number;
  progressPercent: number;
  byCategory: Record<string, { earned: number; total: number }>;
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const isUnlocked = isUnlockedAch(achievement);
  const isInProgress = achievement.progress !== undefined && !isUnlocked;
  const rarity = RARITY_CONFIG[achievement.rarity];
  const Icon = ICON_MAP[achievement.icon] || Award;
  const progressPercent = achievement.maxProgress
    ? Math.round((achievement.progress || 0) / achievement.maxProgress * 100)
    : 0;

  return (
    <div
      className={`relative rounded-xl border transition-all duration-300 ${
        isUnlocked
          ? `bg-[var(--bg-secondary)] border-[var(--border-subtle)] shadow-lg ${rarity.glow}`
          : 'bg-[var(--bg-tertiary)]/50 border-[var(--border-subtle)]/50'
      } ${isUnlocked ? 'hover:scale-[1.02] hover:shadow-xl' : ''}`}
    >
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              isUnlocked ? rarity.bg : 'bg-[var(--bg-tertiary)]'
            }`}
          >
            {isUnlocked ? (
              <Icon className={`h-6 w-6 ${rarity.color}`} />
            ) : (
              <Lock className="h-6 w-6 text-[var(--text-muted)]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className={`font-semibold truncate ${isUnlocked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                {achievement.name}
              </h3>
              {isUnlocked && <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] shrink-0" />}
            </div>
            <p className={`text-sm ${isUnlocked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
              {achievement.description}
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        {isInProgress && achievement.maxProgress && (
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[var(--text-muted)]">Progress</span>
              <span className="text-[var(--text-secondary)] font-mono">
                {achievement.progress?.toLocaleString()} / {achievement.maxProgress.toLocaleString()}
              </span>
            </div>
            <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${rarity.bg.replace('/10', '/50')}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          <Badge className={`${rarity.bg} ${rarity.color} border-0`}>
            {rarity.label}
          </Badge>
          <div className="flex items-center gap-1">
            <Star className={`h-4 w-4 ${isUnlocked ? 'text-amber-400' : 'text-[var(--text-muted)]'}`} />
            <span className={`font-mono font-bold ${isUnlocked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
              {achievement.points}
            </span>
          </div>
        </div>

        {/* Unlock Date */}
        {isUnlocked && achievement.unlockedAt && (
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}

export default function AchievementsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Real data only. This page previously returned a hardcoded 20-row array
  // after a synthetic 500ms delay and never called the API, so every number on
  // screen — points, unlocks, a $500,000 "Platinum Club" tier — was fabricated
  // and identical for every user. The endpoint has existed, has been
  // organization/auth scoped and gamification-gated all along; it simply was
  // never called. Mirrors the /leaderboard page, which was already fixed this way.
  const { data, isLoading, isError, error } = useQuery<{
    achievements: Achievement[];
    summary: Summary;
  }>({
    queryKey: ['achievements'],
    queryFn: async () => {
      const res = await fetch('/api/achievements', { credentials: 'include' });
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'Achievements are turned off for your account.'
            : 'Could not load your achievements.',
        );
      }
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  // Totals are computed from the SERVER's numbers when available rather than
  // re-derived in the browser. The endpoint already aggregates points,
  // unlocked count and per-category totals in SQL; recomputing them here is how
  // the page and the database drift apart.
  const achievements = data?.achievements;
  const summary = data?.summary;

  const categories = ['all', ...new Set(achievements?.map((a) => a.category) || [])];
  const filtered = selectedCategory === 'all'
    ? achievements
    : achievements?.filter((a) => a.category === selectedCategory);

  const totalPoints = summary?.totalPoints
    ?? achievements?.reduce((sum, a) => sum + (isUnlockedAch(a) ? a.points : 0), 0)
    ?? 0;
  const totalUnlocked = summary?.totalUnlocked
    ?? achievements?.filter((a) => isUnlockedAch(a)).length
    ?? 0;
  const totalAchievements = summary?.totalAchievements ?? achievements?.length ?? 0;
  const progressPercent = summary?.progressPercent
    ?? Math.round((totalUnlocked / totalAchievements) * 100);

  const pointsByCategory = summary?.byCategory
    ?? achievements?.reduce((acc, a) => {
      if (!acc[a.category]) acc[a.category] = { earned: 0, total: 0 };
      acc[a.category].total += a.points;
      if (isUnlockedAch(a)) acc[a.category].earned += a.points;
      return acc;
    }, {} as Record<string, { earned: number; total: number }>)
    ?? {};

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Award className="h-6 w-6 text-[var(--accent-purple)]" />
            Achievements
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">Track your milestones and unlock rewards</p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : isError ? (
        // A 404 here means the user turned gamification OFF — the API
        // deliberately 404s rather than 403s so the feature's existence is not
        // disclosed. That case gets its own copy instead of a generic failure.
        <GlassCard className="text-center py-12">
          <p className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            {error instanceof Error ? error.message : 'Could not load your achievements.'}
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            You can turn achievements back on in Settings → Preferences.
          </p>
        </GlassCard>
      ) : !achievements?.length ? (
        <GlassCard className="text-center py-12">
          <p className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            No achievements available yet
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Achievements appear here once your account has some to work toward.
          </p>
        </GlassCard>
      ) : (
        <>
          {/* Stats Overview */}
          <div className="grid md:grid-cols-3 gap-4">
            <GlassCard className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Trophy className="h-5 w-5 text-amber-400" />
                <span className="text-sm text-[var(--text-muted)]">Total Progress</span>
              </div>
              <p className="text-3xl font-bold font-mono text-[var(--text-primary)]">
                {totalUnlocked} <span className="text-lg text-[var(--text-muted)]">/ {totalAchievements}</span>
              </p>
              <div className="mt-3 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2">{progressPercent}% complete</p>
            </GlassCard>

            <GlassCard className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Star className="h-5 w-5 text-amber-400" />
                <span className="text-sm text-[var(--text-muted)]">Points Earned</span>
              </div>
              <MetricValue value={totalPoints} size="xl" />
              <p className="text-sm text-[var(--text-muted)] mt-1">
                of {achievements?.reduce((s, a) => s + a.points, 0).toLocaleString()} total
              </p>
            </GlassCard>

            <GlassCard className="text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-[var(--accent-purple)]" />
                <span className="text-sm text-[var(--text-muted)]">Rarest Unlocked</span>
              </div>
              {(() => {
                const rarestUnlocked = achievements
                  ?.filter((a) => isUnlockedAch(a))
                  .sort((a, b) => {
                    const order = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
                    return order.indexOf(a.rarity) - order.indexOf(b.rarity);
                  })[0];
                if (!rarestUnlocked) {
                  return <p className="text-lg text-[var(--text-muted)]">None yet</p>;
                }
                const rarity = RARITY_CONFIG[rarestUnlocked.rarity];
                return (
                  <>
                    <p className={`text-lg font-semibold ${rarity.color}`}>{rarestUnlocked.name}</p>
                    <Badge className={`mt-1 ${rarity.bg} ${rarity.color}`}>{rarity.label}</Badge>
                  </>
                );
              })()}
            </GlassCard>
          </div>

          {/* Category Breakdown */}
          <GlassCard>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Points by Category</h3>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(pointsByCategory).map(([category, data]) => (
                <div key={category} className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-tertiary)]">
                  <span className="text-sm text-[var(--text-secondary)]">{category}</span>
                  <span className="font-mono text-sm">
                    <span className="text-[var(--text-primary)] font-bold">{data.earned.toLocaleString()}</span>
                    <span className="text-[var(--text-muted)]"> / {data.total.toLocaleString()}</span>
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  selectedCategory === cat
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>

          {/* Achievements Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered?.map((achievement) => (
              <AchievementCard key={achievement.id} achievement={achievement} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
