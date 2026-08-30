'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Trophy,
  Medal,
  Crown,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Target,
  Zap,
  Star,
  Info,
  Flame,
  Award,
} from 'lucide-react';

type TimePeriod = 'week' | 'month' | 'all';

/**
 * Mock leaderboard data for development.
 *
 * Future API endpoint: GET /api/leaderboard
 * Query params:
 *   - period: 'week' | 'month' | 'all' (default: 'month')
 *   - limit: number (default: 20)
 *   - offset: number (default: 0)
 *
 * Response: {
 *   leaderboard: LeaderboardEntry[],
 *   currentUser: { rank: number, entry: LeaderboardEntry },
 *   totalUsers: number
 * }
 */
const mockLeaderboard = [
  { id: '1', name: 'Alex Johnson', avatar: 'AJ', deals: 24, revenue: 125000, responseRate: 42, points: 4850, trend: 'up' as const, streak: 15, rankChange: 2 },
  { id: '2', name: 'Sarah Chen', avatar: 'SC', deals: 21, revenue: 98000, responseRate: 38, points: 4200, trend: 'up' as const, streak: 12, rankChange: 1 },
  { id: '3', name: 'Mike Williams', avatar: 'MW', deals: 18, revenue: 87000, responseRate: 35, points: 3600, trend: 'same' as const, streak: 8, rankChange: 0 },
  { id: '4', name: 'Emily Davis', avatar: 'ED', deals: 16, revenue: 76000, responseRate: 33, points: 3200, trend: 'down' as const, streak: 5, rankChange: -2 },
  { id: '5', name: 'David Brown', avatar: 'DB', deals: 15, revenue: 72000, responseRate: 31, points: 3000, trend: 'up' as const, streak: 10, rankChange: 3 },
  { id: '6', name: 'Lisa Anderson', avatar: 'LA', deals: 14, revenue: 68000, responseRate: 30, points: 2800, trend: 'same' as const, streak: 6, rankChange: 0 },
  { id: '7', name: 'James Wilson', avatar: 'JW', deals: 13, revenue: 64000, responseRate: 28, points: 2600, trend: 'up' as const, streak: 4, rankChange: 1 },
  { id: '8', name: 'current_user', avatar: 'YU', deals: 12, revenue: 58000, responseRate: 27, points: 2400, trend: 'up' as const, streak: 7, isCurrentUser: true, rankChange: 2 },
  { id: '9', name: 'Jennifer Martinez', avatar: 'JM', deals: 11, revenue: 52000, responseRate: 25, points: 2200, trend: 'down' as const, streak: 3, rankChange: -1 },
  { id: '10', name: 'Robert Taylor', avatar: 'RT', deals: 10, revenue: 48000, responseRate: 24, points: 2000, trend: 'same' as const, streak: 2, rankChange: 0 },
  { id: '11', name: 'Amanda Thomas', avatar: 'AT', deals: 9, revenue: 44000, responseRate: 22, points: 1800, trend: 'up' as const, streak: 5, rankChange: 2 },
  { id: '12', name: 'Chris Jackson', avatar: 'CJ', deals: 8, revenue: 40000, responseRate: 20, points: 1600, trend: 'down' as const, streak: 1, rankChange: -3 },
  { id: '13', name: 'Nicole White', avatar: 'NW', deals: 7, revenue: 35000, responseRate: 18, points: 1400, trend: 'same' as const, streak: 4, rankChange: 0 },
  { id: '14', name: 'Kevin Harris', avatar: 'KH', deals: 6, revenue: 30000, responseRate: 16, points: 1200, trend: 'up' as const, streak: 2, rankChange: 1 },
  { id: '15', name: 'Melissa Clark', avatar: 'MC', deals: 5, revenue: 25000, responseRate: 15, points: 1000, trend: 'down' as const, streak: 1, rankChange: -1 },
  { id: '16', name: 'Brandon Lee', avatar: 'BL', deals: 4, revenue: 22000, responseRate: 14, points: 880, trend: 'up' as const, streak: 3, rankChange: 2 },
  { id: '17', name: 'Rachel Green', avatar: 'RG', deals: 4, revenue: 20000, responseRate: 13, points: 800, trend: 'same' as const, streak: 2, rankChange: 0 },
  { id: '18', name: 'Tyler Ross', avatar: 'TR', deals: 3, revenue: 18000, responseRate: 12, points: 680, trend: 'down' as const, streak: 1, rankChange: -2 },
  { id: '19', name: 'Samantha Hill', avatar: 'SH', deals: 3, revenue: 15000, responseRate: 11, points: 550, trend: 'up' as const, streak: 2, rankChange: 1 },
  { id: '20', name: 'Derek Stone', avatar: 'DS', deals: 2, revenue: 12000, responseRate: 10, points: 420, trend: 'same' as const, streak: 1, rankChange: 0 },
];

const TrendIcon = ({ trend, rankChange }: { trend: 'up' | 'down' | 'same'; rankChange?: number }) => {
  if (trend === 'up') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[var(--color-success)] animate-pulse">
        <TrendingUp className="h-4 w-4" />
        {rankChange !== undefined && rankChange > 0 && (
          <span className="text-xs font-mono">+{rankChange}</span>
        )}
      </span>
    );
  }
  if (trend === 'down') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[var(--color-error)]">
        <TrendingDown className="h-4 w-4" />
        {rankChange !== undefined && rankChange < 0 && (
          <span className="text-xs font-mono">{rankChange}</span>
        )}
      </span>
    );
  }
  return <Minus className="h-4 w-4 text-[var(--text-muted)]" />;
};

function PodiumCard({
  rank,
  user,
  currentUserEmail,
}: {
  rank: 1 | 2 | 3;
  user: typeof mockLeaderboard[0];
  currentUserEmail?: string;
}) {
  const config = {
    1: {
      color: 'from-yellow-400 to-amber-500',
      textColor: 'text-amber-400',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-400/30',
      glowColor: 'shadow-amber-500/20',
      icon: Crown,
      label: '1st Place',
      height: 'h-32',
    },
    2: {
      color: 'from-gray-300 to-gray-400',
      textColor: 'text-gray-300',
      bgColor: 'bg-gray-500/10',
      borderColor: 'border-gray-400/30',
      glowColor: 'shadow-gray-400/20',
      icon: Medal,
      label: '2nd Place',
      height: 'h-24',
    },
    3: {
      color: 'from-amber-600 to-amber-700',
      textColor: 'text-amber-600',
      bgColor: 'bg-amber-700/10',
      borderColor: 'border-amber-600/30',
      glowColor: 'shadow-amber-600/20',
      icon: Medal,
      label: '3rd Place',
      height: 'h-20',
    },
  };

  const c = config[rank];
  const Icon = c.icon;
  const isCurrentUser = user.isCurrentUser || user.name.includes(currentUserEmail?.split('@')[0] || 'impossible');
  const displayName = isCurrentUser ? 'You' : user.name;

  return (
    <div className={`flex flex-col items-center transition-all duration-300 hover:scale-105 ${rank === 1 ? 'order-2' : rank === 2 ? 'order-1' : 'order-3'}`}>
      <div className="relative mb-3">
        <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${c.color} flex items-center justify-center shadow-lg ${c.glowColor} shadow-xl ${isCurrentUser ? 'ring-2 ring-[var(--accent-blue)] ring-offset-2 ring-offset-[var(--bg-primary)]' : ''} ${rank === 1 ? 'animate-pulse' : ''}`}>
          <span className="text-white text-lg font-bold">{user.avatar}</span>
        </div>
        {rank === 1 && (
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 animate-bounce">
            <Crown className="h-7 w-7 text-amber-400 drop-shadow-lg" />
          </div>
        )}
        {rank === 2 && (
          <div className="absolute -top-2 -right-2">
            <Award className="h-5 w-5 text-gray-300 drop-shadow" />
          </div>
        )}
        {rank === 3 && (
          <div className="absolute -top-2 -right-2">
            <Award className="h-5 w-5 text-amber-600 drop-shadow" />
          </div>
        )}
      </div>
      <p className={`font-semibold ${isCurrentUser ? 'text-[var(--accent-blue)]' : 'text-[var(--text-primary)]'}`}>
        {displayName}
      </p>
      <div className="flex items-center gap-1">
        <p className={`text-2xl font-bold font-mono ${c.textColor}`}>{user.points.toLocaleString()}</p>
        {user.trend !== 'same' && (
          <TrendIcon trend={user.trend} rankChange={user.rankChange} />
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)]">points</p>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-xs text-[var(--text-muted)]">{user.deals} deals</span>
        <span className="text-[var(--text-muted)]">|</span>
        <span className="text-xs text-[var(--color-success)]">${(user.revenue / 1000).toFixed(0)}k</span>
      </div>
      <div className={`mt-3 ${c.height} w-24 rounded-t-xl ${c.bgColor} border-t border-x ${c.borderColor} flex flex-col items-center justify-end pb-3 backdrop-blur-sm`}>
        <Icon className={`h-6 w-6 ${c.textColor} mb-1`} />
        <span className={`text-xs font-medium ${c.textColor}`}>{c.label}</span>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [period, setPeriod] = useState<TimePeriod>('month');

  // In production, this would fetch from API
  const { data: leaderboard, isLoading } = useQuery({
    queryKey: ['leaderboard', period],
    queryFn: async () => {
      // Simulate API call
      await new Promise((r) => setTimeout(r, 500));
      return mockLeaderboard;
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

  const top3 = leaderboard?.slice(0, 3) || [];
  const rest = leaderboard?.slice(3) || [];
  const currentUser = leaderboard?.find((u) => u.isCurrentUser);
  const currentUserRank = currentUser ? leaderboard!.indexOf(currentUser) + 1 : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Trophy className="h-6 w-6 text-amber-400" />
            Leaderboard
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Top performers {period === 'week' ? 'this week' : period === 'month' ? 'this month' : 'of all time'}
          </p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
          <SelectTrigger className="w-[150px] bg-[var(--bg-tertiary)] border-[var(--border-subtle)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="all">All Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : (
        <>
          {/* Podium */}
          <GlassCard variant="elevated" className="pt-8 pb-4">
            <div className="flex justify-center items-end gap-4">
              {top3[1] && <PodiumCard rank={2} user={top3[1]} currentUserEmail={session.user?.email || ''} />}
              {top3[0] && <PodiumCard rank={1} user={top3[0]} currentUserEmail={session.user?.email || ''} />}
              {top3[2] && <PodiumCard rank={3} user={top3[2]} currentUserEmail={session.user?.email || ''} />}
            </div>
          </GlassCard>

          {/* Your Position */}
          {currentUser && currentUserRank > 3 && (
            <GlassCard className="border-l-4 border-l-[var(--accent-blue)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
                    <span className="text-white font-bold">#{currentUserRank}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">Your Position</p>
                    <p className="text-sm text-[var(--text-muted)]">
                      {currentUserRank <= 10 ? 'Top 10!' : `${(leaderboard?.length || 0) - currentUserRank} spots to climb`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold font-mono text-[var(--accent-blue)]">
                    {currentUser.points.toLocaleString()}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {currentUserRank > 1 ? `${(leaderboard![currentUserRank - 2].points - currentUser.points).toLocaleString()} pts to next rank` : 'You\'re #1!'}
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          {/* Full Leaderboard */}
          <GlassCard padding="none">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left">
                    <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase">Rank</th>
                    <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase">User</th>
                    <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase text-center">
                      <Target className="h-4 w-4 inline" /> Deals
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase text-center">
                      <DollarSign className="h-4 w-4 inline" /> Revenue
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase text-center">
                      <Zap className="h-4 w-4 inline" /> Response
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase text-center">
                      <Star className="h-4 w-4 inline" /> Streak
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-[var(--text-muted)] uppercase text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((user, idx) => {
                    const rank = idx + 4;
                    const isCurrentUser = user.isCurrentUser;
                    return (
                      <tr
                        key={user.id}
                        className={`border-b border-[var(--border-subtle)] last:border-0 transition-colors ${
                          isCurrentUser
                            ? 'bg-[var(--accent-blue)]/5 hover:bg-[var(--accent-blue)]/10'
                            : 'hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono font-bold ${isCurrentUser ? 'text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}`}>
                              #{rank}
                            </span>
                            <TrendIcon trend={user.trend} rankChange={user.rankChange} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                              isCurrentUser
                                ? 'bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                            }`}>
                              {user.avatar}
                            </div>
                            <span className={`font-medium ${isCurrentUser ? 'text-[var(--accent-blue)]' : 'text-[var(--text-primary)]'}`}>
                              {isCurrentUser ? 'You' : user.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-[var(--text-secondary)]">{user.deals}</td>
                        <td className="px-4 py-3 text-center font-mono text-[var(--color-success)]">
                          ${(user.revenue / 1000).toFixed(0)}k
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-[var(--text-secondary)]">{user.responseRate}%</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className="bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                            🔥 {user.streak}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[var(--text-primary)]">
                          {user.points.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </GlassCard>

          {/* Scoring Info */}
          <GlassCard>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">How Points Are Calculated</h3>
            <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[var(--accent-blue)]" />
                <span className="text-[var(--text-secondary)]">Deal closed: <span className="font-mono font-bold text-[var(--text-primary)]">+100 pts</span></span>
              </div>
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[var(--color-success)]" />
                <span className="text-[var(--text-secondary)]">Revenue: <span className="font-mono font-bold text-[var(--text-primary)]">+1 pt/$100</span></span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-[var(--accent-purple)]" />
                <span className="text-[var(--text-secondary)]">Response rate: <span className="font-mono font-bold text-[var(--text-primary)]">x1.5 bonus</span></span>
              </div>
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-[var(--color-warning)]" />
                <span className="text-[var(--text-secondary)]">Streak bonus: <span className="font-mono font-bold text-[var(--text-primary)]">+10 pts/day</span></span>
              </div>
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}
