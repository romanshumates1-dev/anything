'use client';

/**
 * Referral Dashboard Component
 *
 * Displays user's referral code, social share buttons, referral stats,
 * and progress toward monthly bonus. Users can earn credits by:
 * - Sharing on social media (25 credits per platform per day)
 * - Referring friends who make purchases (100 credits each)
 * - Monthly bonus: 500 credits for 10+ successful referrals
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from 'sonner';
import {
  Gift,
  Link as LinkIcon,
  Copy,
  Check,
  Share2,
  Users,
  Coins,
  Trophy,
  MessageCircle,
  Briefcase,
  Globe,
  Camera,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useState } from 'react';

interface ReferralStats {
  referralCode: string;
  referralLink: string;
  stats: {
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    totalCreditsEarned: number;
  };
  monthlyProgress: {
    count: number;
    threshold: number;
    bonusAwarded: boolean;
    bonusCredits: number;
  };
  rewards: {
    socialShareCredits: number;
    referralSignupCredits: number;
    monthlyBonusCredits: number;
    monthlyBonusThreshold: number;
  };
  recentReferrals: Array<{
    id: string;
    signedUpAt: string;
    hasConverted: boolean;
    creditsAwarded: number;
  }>;
  socialShares: Array<{
    platform: string;
    sharedToday: boolean;
    creditsEarned: number;
  }>;
}

const SOCIAL_PLATFORMS = [
  {
    id: 'twitter',
    name: 'Twitter/X',
    icon: MessageCircle,
    color: 'hover:bg-sky-500/10 hover:text-sky-500',
    shareUrl: (link: string, text: string) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: Briefcase,
    color: 'hover:bg-blue-600/10 hover:text-blue-600',
    shareUrl: (link: string) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
  },
  {
    id: 'facebook',
    name: 'Facebook',
    icon: Globe,
    color: 'hover:bg-blue-500/10 hover:text-blue-500',
    shareUrl: (link: string) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    icon: Camera,
    color: 'hover:bg-pink-500/10 hover:text-pink-500',
    shareUrl: null, // Instagram doesn't support direct sharing
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: () => (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
      </svg>
    ),
    color: 'hover:bg-neutral-800/10 hover:text-neutral-800 dark:hover:bg-white/10 dark:hover:text-white',
    shareUrl: null, // TikTok doesn't support direct sharing
  },
];

export function ReferralDashboard() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [claimingPlatform, setClaimingPlatform] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<ReferralStats>({
    queryKey: ['referrals'],
    queryFn: async () => {
      const res = await fetch('/api/referrals');
      if (!res.ok) throw new Error('Failed to load referral data');
      return res.json();
    },
  });

  const claimMutation = useMutation({
    mutationFn: async (platform: string) => {
      const res = await fetch('/api/referrals/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to claim');
      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        queryClient.invalidateQueries({ queryKey: ['referrals'] });
        queryClient.invalidateQueries({ queryKey: ['credits'] });
      } else {
        toast.info(data.message);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to claim credits');
    },
    onSettled: () => {
      setClaimingPlatform(null);
    },
  });

  const handleCopyLink = async () => {
    if (!data?.referralLink) return;
    try {
      await navigator.clipboard.writeText(data.referralLink);
      setCopied(true);
      toast.success('Referral link copied!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleShare = (platformId: string) => {
    const platform = SOCIAL_PLATFORMS.find((p) => p.id === platformId);
    if (!platform || !data?.referralLink) return;

    const shareText = 'I am using DealFlow AI for real estate wholesaling automation. Join me and we both get rewards!';

    // Open share URL if available
    if (platform.shareUrl) {
      const url = platform.shareUrl(data.referralLink, shareText);
      window.open(url, '_blank', 'width=600,height=400');
    }

    // Claim credits
    setClaimingPlatform(platformId);
    claimMutation.mutate(platformId);
  };

  const handleManualClaim = (platformId: string) => {
    setClaimingPlatform(platformId);
    claimMutation.mutate(platformId);
  };

  if (error) {
    return (
      <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <CardContent className="py-8 text-center">
          <p className="text-[var(--text-muted)]">Failed to load referral data. Please try again.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const progressPercent = data ? (data.monthlyProgress.count / data.monthlyProgress.threshold) * 100 : 0;
  const socialShareMap = new Map(data?.socialShares.map((s) => [s.platform, s]) || []);

  return (
    <div className="space-y-6">
      {/* Referral Code Card */}
      <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
            <Gift className="h-5 w-5 text-[var(--accent-purple)]" />
            Refer Friends, Earn Credits
          </CardTitle>
          <CardDescription className="text-[var(--text-muted)]">
            Share your unique link and earn {data?.rewards.referralSignupCredits} credits when friends sign up and make their first purchase.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Referral Code Display */}
          <div className="flex items-center gap-3 p-4 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-subtle)]">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--text-muted)] mb-1">Your Referral Code</p>
              <p className="font-mono text-lg font-semibold text-[var(--accent-blue)]">
                {data?.referralCode}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-[var(--color-success)]" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span className="ml-2">{copied ? 'Copied' : 'Copy Link'}</span>
              </Button>
            </div>
          </div>

          {/* Referral Link */}
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <LinkIcon className="h-4 w-4 shrink-0" />
            <code className="truncate flex-1 bg-[var(--bg-tertiary)] px-2 py-1 rounded text-xs">
              {data?.referralLink}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Social Share Card */}
      <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
            <Share2 className="h-5 w-5 text-[var(--accent-blue)]" />
            Share on Social Media
          </CardTitle>
          <CardDescription className="text-[var(--text-muted)]">
            Earn {data?.rewards.socialShareCredits} credits per platform, once per day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {SOCIAL_PLATFORMS.map((platform) => {
              const shareInfo = socialShareMap.get(platform.id);
              const sharedToday = shareInfo?.sharedToday || false;
              const Icon = platform.icon;
              const isLoading = claimingPlatform === platform.id && claimMutation.isPending;

              return (
                <div
                  key={platform.id}
                  className={`relative flex flex-col items-center p-3 rounded-lg border transition-all ${
                    sharedToday
                      ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/5'
                      : `border-[var(--border-subtle)] bg-[var(--bg-tertiary)] ${platform.color}`
                  }`}
                >
                  {sharedToday && (
                    <Badge className="absolute -top-2 -right-2 bg-[var(--color-success)] text-white text-[10px]">
                      Done
                    </Badge>
                  )}
                  <div className="mb-2">
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Icon className={`h-5 w-5 ${sharedToday ? 'text-[var(--color-success)]' : ''}`} />
                    )}
                  </div>
                  <span className="text-xs font-medium text-[var(--text-primary)] mb-2">
                    {platform.name}
                  </span>
                  {sharedToday ? (
                    <span className="text-[10px] text-[var(--color-success)]">
                      +{data?.rewards.socialShareCredits} earned
                    </span>
                  ) : platform.shareUrl ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleShare(platform.id)}
                      disabled={isLoading}
                      className="h-7 text-xs"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Share
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleManualClaim(platform.id)}
                      disabled={isLoading}
                      className="h-7 text-xs"
                    >
                      Claim
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-3 text-center">
            Share resets daily at midnight UTC
          </p>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <Users className="h-4 w-4" />
              <span className="text-xs">Total Referrals</span>
            </div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {data?.stats.totalReferrals || 0}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <Check className="h-4 w-4 text-[var(--color-success)]" />
              <span className="text-xs">Converted</span>
            </div>
            <p className="text-2xl font-bold text-[var(--color-success)]">
              {data?.stats.successfulReferrals || 0}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <Loader2 className="h-4 w-4" />
              <span className="text-xs">Pending</span>
            </div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">
              {data?.stats.pendingReferrals || 0}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
              <Coins className="h-4 w-4 text-[var(--accent-purple)]" />
              <span className="text-xs">Credits Earned</span>
            </div>
            <p className="text-2xl font-bold text-[var(--accent-purple)]">
              {data?.stats.totalCreditsEarned || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Bonus Progress */}
      <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
            <Trophy className="h-5 w-5 text-yellow-500" />
            Monthly Bonus Challenge
          </CardTitle>
          <CardDescription className="text-[var(--text-muted)]">
            Get {data?.monthlyProgress.threshold} successful referrals this month to earn {data?.monthlyProgress.bonusCredits} bonus credits!
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-muted)]">Progress</span>
              <span className="font-medium text-[var(--text-primary)]">
                {data?.monthlyProgress.count || 0} / {data?.monthlyProgress.threshold || 10}
              </span>
            </div>
            <Progress
              value={Math.min(progressPercent, 100)}
              className="h-3 bg-[var(--bg-tertiary)]"
            />
            {data?.monthlyProgress.bonusAwarded ? (
              <div className="flex items-center gap-2 p-3 bg-[var(--color-success)]/10 rounded-lg border border-[var(--color-success)]/30">
                <Trophy className="h-5 w-5 text-[var(--color-success)]" />
                <div>
                  <p className="text-sm font-medium text-[var(--color-success)]">
                    Congratulations! Bonus Claimed!
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    You earned {data.monthlyProgress.bonusCredits} bonus credits this month
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] text-center">
                {data?.monthlyProgress.threshold
                  ? data.monthlyProgress.threshold - (data?.monthlyProgress.count || 0)
                  : 10}{' '}
                more successful referrals needed
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Referrals */}
      {data?.recentReferrals && data.recentReferrals.length > 0 && (
        <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
          <CardHeader>
            <CardTitle className="text-[var(--text-primary)]">Recent Referrals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.recentReferrals.map((referral) => (
                <div
                  key={referral.id}
                  className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-subtle)]"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        referral.hasConverted ? 'bg-[var(--color-success)]' : 'bg-[var(--text-muted)]'
                      }`}
                    />
                    <div>
                      <p className="text-sm text-[var(--text-primary)]">
                        Referral #{referral.id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        Signed up {new Date(referral.signedUpAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {referral.hasConverted ? (
                      <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)]">
                        +{referral.creditsAwarded} credits
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-[var(--border-subtle)] text-[var(--text-muted)]">
                        Pending
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rewards Summary */}
      <Card className="border-[var(--border-subtle)] bg-gradient-to-br from-[var(--accent-blue)]/5 to-[var(--accent-purple)]/5">
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-4">How to Earn Credits</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--accent-blue)]/10 flex items-center justify-center shrink-0">
                <Share2 className="h-4 w-4 text-[var(--accent-blue)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Social Shares</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {data?.rewards.socialShareCredits} credits per platform daily
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[var(--accent-purple)]/10 flex items-center justify-center shrink-0">
                <Users className="h-4 w-4 text-[var(--accent-purple)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Friend Purchases</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {data?.rewards.referralSignupCredits} credits when friend buys
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-yellow-500/10 flex items-center justify-center shrink-0">
                <Trophy className="h-4 w-4 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Monthly Bonus</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {data?.rewards.monthlyBonusCredits} credits for {data?.rewards.monthlyBonusThreshold}+ referrals
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default ReferralDashboard;
