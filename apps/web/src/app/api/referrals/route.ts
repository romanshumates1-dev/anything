/**
 * Referrals API - GET/POST for referral code management
 *
 * GET: Get user's referral code and statistics
 * POST: Generate referral code if doesn't exist
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import {
  getOrCreateReferralCode,
  getReferralStats,
  SOCIAL_SHARE_CREDITS,
  REFERRAL_SIGNUP_CREDITS,
  MONTHLY_BONUS_THRESHOLD,
  MONTHLY_BONUS_CREDITS,
} from '@/app/api/utils/referralRewards';

export interface ReferralStatsResponse {
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

/**
 * GET /api/referrals
 * Returns user's referral code, stats, and progress
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    const userId = session.user.id;
    const userName = session.user.name || undefined;

    // Ensure user has a referral code
    const { code } = await getOrCreateReferralCode(userId, organization.id, userName);

    // Get full stats
    const stats = await getReferralStats(userId);

    // Build referral link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dealflow.ai';
    const referralLink = `${baseUrl}/signup?ref=${code}`;

    const response: ReferralStatsResponse = {
      referralCode: code,
      referralLink,
      stats: {
        totalReferrals: stats.totalReferrals,
        successfulReferrals: stats.successfulReferrals,
        pendingReferrals: stats.pendingReferrals,
        totalCreditsEarned: stats.totalCreditsEarned,
      },
      monthlyProgress: {
        count: stats.monthlyProgress.count,
        threshold: stats.monthlyProgress.threshold,
        bonusAwarded: stats.monthlyProgress.bonusAwarded,
        bonusCredits: MONTHLY_BONUS_CREDITS,
      },
      rewards: {
        socialShareCredits: SOCIAL_SHARE_CREDITS,
        referralSignupCredits: REFERRAL_SIGNUP_CREDITS,
        monthlyBonusCredits: MONTHLY_BONUS_CREDITS,
        monthlyBonusThreshold: MONTHLY_BONUS_THRESHOLD,
      },
      recentReferrals: stats.recentReferrals.map((r) => ({
        id: r.id,
        signedUpAt: r.signedUpAt.toISOString(),
        hasConverted: r.hasConverted,
        creditsAwarded: r.creditsAwarded,
      })),
      socialShares: stats.socialShares,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[REFERRALS] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch referral data' }, { status: 500 });
  }
}

/**
 * POST /api/referrals
 * Generate a new referral code if user doesn't have one
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return NextResponse.json({ error: 'No organization' }, { status: 403 });
  }

  try {
    const userId = session.user.id;
    const userName = session.user.name || undefined;

    const { code, isNew } = await getOrCreateReferralCode(userId, organization.id, userName);

    // Build referral link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dealflow.ai';
    const referralLink = `${baseUrl}/signup?ref=${code}`;

    return NextResponse.json({
      referralCode: code,
      referralLink,
      isNew,
    });
  } catch (error: any) {
    console.error('[REFERRALS] POST error:', error);
    return NextResponse.json({ error: 'Failed to generate referral code' }, { status: 500 });
  }
}
