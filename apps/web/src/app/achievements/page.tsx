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
  unlockedAt?: string;
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

const mockAchievements: Achievement[] = [
  // Getting Started
  { id: '1', name: 'First Steps', description: 'Complete your profile setup', category: 'Getting Started', rarity: 'common', points: 50, icon: 'star', unlockedAt: '2024-01-15' },
  { id: '2', name: 'Hello World', description: 'Send your first campaign message', category: 'Getting Started', rarity: 'common', points: 100, icon: 'message', unlockedAt: '2024-01-16' },
  { id: '3', name: 'Contact Collector', description: 'Import your first 100 contacts', category: 'Getting Started', rarity: 'common', points: 75, icon: 'users', progress: 67, maxProgress: 100 },

  // Campaign Master
  { id: '4', name: 'Campaign Creator', description: 'Launch 5 campaigns', category: 'Campaign Master', rarity: 'uncommon', points: 150, icon: 'rocket', progress: 3, maxProgress: 5 },
  { id: '5', name: 'Message Maven', description: 'Send 1,000 messages', category: 'Campaign Master', rarity: 'uncommon', points: 200, icon: 'message', progress: 456, maxProgress: 1000 },
  { id: '6', name: 'Response Magnet', description: 'Get 100 responses', category: 'Campaign Master', rarity: 'rare', points: 250, icon: 'zap', progress: 42, maxProgress: 100 },
  { id: '7', name: 'Engagement Expert', description: 'Achieve 30% response rate on a campaign', category: 'Campaign Master', rarity: 'rare', points: 300, icon: 'target' },

  // Deal Closer
  { id: '8', name: 'First Blood', description: 'Close your first deal', category: 'Deal Closer', rarity: 'uncommon', points: 500, icon: 'trophy', unlockedAt: '2024-02-01' },
  { id: '9', name: 'Dealmaker', description: 'Close 10 deals', category: 'Deal Closer', rarity: 'rare', points: 1000, icon: 'trophy', progress: 4, maxProgress: 10 },
  { id: '10', name: 'Whale Hunter', description: 'Close a deal over $50,000', category: 'Deal Closer', rarity: 'epic', points: 750, icon: 'dollar' },
  { id: '11', name: 'Revenue Machine', description: 'Generate $100,000 in total revenue', category: 'Deal Closer', rarity: 'epic', points: 1500, icon: 'dollar', progress: 58000, maxProgress: 100000 },

  // Networking Pro
  { id: '12', name: 'Network Builder', description: 'Add 500 contacts', category: 'Networking Pro', rarity: 'uncommon', points: 200, icon: 'users', progress: 234, maxProgress: 500 },
  { id: '13', name: 'Conversation Starter', description: 'Have 50 active conversations', category: 'Networking Pro', rarity: 'rare', points: 300, icon: 'message' },
  { id: '14', name: 'Relationship Master', description: 'Convert 25 leads to deals', category: 'Networking Pro', rarity: 'epic', points: 600, icon: 'users', progress: 8, maxProgress: 25 },

  // Power User
  { id: '15', name: 'Daily Driver', description: 'Log in 30 consecutive days', category: 'Power User', rarity: 'rare', points: 400, icon: 'flame', progress: 12, maxProgress: 30 },
  { id: '16', name: 'Automation Expert', description: 'Set up 10 automated sequences', category: 'Power User', rarity: 'uncommon', points: 350, icon: 'zap' },
  { id: '17', name: 'Data Analyst', description: 'Export 50 analytics reports', category: 'Power User', rarity: 'uncommon', points: 200, icon: 'target' },

  // Rare & Legendary
  { id: '18', name: 'Platinum Club', description: 'Generate $500,000 in total revenue', category: 'Rare & Legendary', rarity: 'legendary', points: 2000, icon: 'crown' },
  { id: '19', name: 'Legend', description: 'Reach #1 on the leaderboard', category: 'Rare & Legendary', rarity: 'legendary', points: 1500, icon: 'crown' },
  { id: '20', name: 'Perfectionist', description: 'Achieve 50% response rate on 5 campaigns', category: 'Rare & Legendary', rarity: 'legendary', points: 2500, icon: 'sparkles' },
];

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const isUnlocked = !!achievement.unlockedAt;
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

  const { data: achievements, isLoading } = useQuery({
    queryKey: ['achievements'],
    queryFn: async () => {
      await new Promise((r) => setTimeout(r, 500));
      return mockAchievements;
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

  const categories = ['all', ...new Set(achievements?.map((a) => a.category) || [])];
  const filtered = selectedCategory === 'all'
    ? achievements
    : achievements?.filter((a) => a.category === selectedCategory);

  const totalPoints = achievements?.reduce((sum, a) => sum + (a.unlockedAt ? a.points : 0), 0) || 0;
  const totalUnlocked = achievements?.filter((a) => a.unlockedAt).length || 0;
  const totalAchievements = achievements?.length || 0;
  const progressPercent = Math.round((totalUnlocked / totalAchievements) * 100);

  const pointsByCategory = achievements?.reduce((acc, a) => {
    if (!acc[a.category]) acc[a.category] = { earned: 0, total: 0 };
    acc[a.category].total += a.points;
    if (a.unlockedAt) acc[a.category].earned += a.points;
    return acc;
  }, {} as Record<string, { earned: number; total: number }>) || {};

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
                  ?.filter((a) => a.unlockedAt)
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
