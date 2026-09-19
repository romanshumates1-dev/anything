/**
 * Referral Rewards System Utilities
 *
 * Manages referral codes, social share credits, and monthly bonuses.
 * Users earn credits by sharing on social media and referring friends.
 */
import sql from './sql';
import { logEvent } from './logger';
import { grantBonusCredits } from './credits';

// Credit reward amounts
export const SOCIAL_SHARE_CREDITS = 25; // Per platform, once per day
export const REFERRAL_SIGNUP_CREDITS = 100; // When referred friend makes first purchase
export const MONTHLY_BONUS_THRESHOLD = 10; // Referrals with purchases needed
export const MONTHLY_BONUS_CREDITS = 500; // Extra bonus for hitting threshold

// Supported social platforms
export const SOCIAL_PLATFORMS = ['twitter', 'facebook', 'linkedin', 'instagram', 'tiktok'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/**
 * Generate a unique referral code for a user.
 * Format: USER_INITIALS + random alphanumeric (e.g., "JS7X2K9")
 */
export function generateReferralCode(userName?: string): string {
  // Get initials or default to "DF" (DealFlow)
  const initials = userName
    ? userName
        .split(' ')
        .map((n) => n[0]?.toUpperCase() || '')
        .join('')
        .slice(0, 2)
    : 'DF';

  // Generate random alphanumeric suffix
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded confusing chars: I, O, 0, 1
  let suffix = '';
  for (let i = 0; i < 5; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }

  return `${initials}${suffix}`;
}

/**
 * Get or create a referral code for a user.
 */
export async function getOrCreateReferralCode(
  userId: string,
  organizationId: string,
  userName?: string
): Promise<{ code: string; isNew: boolean }> {
  try {
    // Check for existing code
    const [existing] = await sql`
      SELECT code FROM user_referral_codes
      WHERE user_id = ${userId}
    `;

    if (existing) {
      return { code: existing.code, isNew: false };
    }

    // Generate new code with uniqueness check
    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      code = generateReferralCode(userName);
      attempts++;

      // Check if code already exists
      const [duplicate] = await sql`
        SELECT 1 FROM user_referral_codes WHERE code = ${code}
      `;

      if (!duplicate) {
        break;
      }
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      // Fall back to UUID-based code
      code = `DF${Date.now().toString(36).toUpperCase()}`;
    }

    // Insert new code
    await sql`
      INSERT INTO user_referral_codes (user_id, organization_id, code)
      VALUES (${userId}, ${organizationId}, ${code})
      ON CONFLICT (user_id) DO UPDATE SET code = EXCLUDED.code
    `;

    await logEvent('referral_code_created', 'user', userId, { code });

    return { code, isNew: true };
  } catch (error) {
    console.error('[REFERRAL] Failed to get/create referral code:', error);
    throw error;
  }
}

/**
 * Look up a referral code and get the referrer's info.
 */
export async function lookupReferralCode(
  code: string
): Promise<{ userId: string; organizationId: string } | null> {
  try {
    const [result] = await sql`
      SELECT user_id, organization_id
      FROM user_referral_codes
      WHERE code = ${code.toUpperCase()}
    `;

    return result ? { userId: result.user_id, organizationId: result.organization_id } : null;
  } catch (error) {
    console.error('[REFERRAL] Failed to lookup referral code:', error);
    return null;
  }
}

/**
 * Record a referral signup when a new user registers with a referral code.
 */
export async function recordReferralSignup(
  referrerUserId: string,
  referredUserId: string,
  referralCode: string
): Promise<{ id: string } | null> {
  try {
    // Check if this referral already exists
    const [existing] = await sql`
      SELECT id FROM referral_signups
      WHERE referrer_user_id = ${referrerUserId}
        AND referred_user_id = ${referredUserId}
    `;

    if (existing) {
      return { id: existing.id };
    }

    // Create referral record
    const [result] = await sql`
      INSERT INTO referral_signups (
        referrer_user_id,
        referred_user_id,
        referral_code
      )
      VALUES (${referrerUserId}, ${referredUserId}, ${referralCode.toUpperCase()})
      RETURNING id
    `;

    await logEvent('referral_signup_recorded', 'user', referredUserId, {
      referrerUserId,
      referralCode,
    });

    return { id: result.id };
  } catch (error) {
    console.error('[REFERRAL] Failed to record referral signup:', error);
    return null;
  }
}

/**
 * Award referral credits when a referred user makes their first purchase.
 * Returns the credits awarded (0 if already awarded).
 */
export async function awardReferralCredits(
  referredUserId: string,
  purchaseId?: string
): Promise<{ creditsAwarded: number; bonusAwarded: number }> {
  try {
    // Find the referral record for this user
    const [referral] = await sql`
      SELECT rs.id, rs.referrer_user_id, rs.credits_awarded,
             urc.organization_id
      FROM referral_signups rs
      JOIN user_referral_codes urc ON urc.user_id = rs.referrer_user_id
      WHERE rs.referred_user_id = ${referredUserId}
        AND rs.credits_awarded = false
    `;

    if (!referral) {
      return { creditsAwarded: 0, bonusAwarded: 0 };
    }

    // Update referral record
    await sql`
      UPDATE referral_signups
      SET first_purchase_at = NOW(),
          credits_awarded = true,
          credits_awarded_at = NOW(),
          credits_amount = ${REFERRAL_SIGNUP_CREDITS}
      WHERE id = ${referral.id}
    `;

    // Award credits to referrer
    await grantBonusCredits(
      referral.organization_id,
      REFERRAL_SIGNUP_CREDITS,
      'Referral reward: friend made first purchase',
      {
        referralId: referral.id,
        referredUserId,
        purchaseId,
      }
    );

    await logEvent('referral_credits_awarded', 'user', referral.referrer_user_id, {
      referralId: referral.id,
      referredUserId,
      credits: REFERRAL_SIGNUP_CREDITS,
    });

    // Check for monthly bonus
    const bonusAwarded = await checkMonthlyBonus(referral.referrer_user_id, referral.organization_id);

    return { creditsAwarded: REFERRAL_SIGNUP_CREDITS, bonusAwarded };
  } catch (error) {
    console.error('[REFERRAL] Failed to award referral credits:', error);
    return { creditsAwarded: 0, bonusAwarded: 0 };
  }
}

/**
 * Check and award monthly bonus if threshold reached.
 */
export async function checkMonthlyBonus(
  userId: string,
  organizationId: string
): Promise<number> {
  try {
    const monthYear = new Date().toISOString().slice(0, 7); // YYYY-MM format

    // Count referrals with purchases this month
    const [stats] = await sql`
      SELECT COUNT(*)::int as count
      FROM referral_signups
      WHERE referrer_user_id = ${userId}
        AND credits_awarded = true
        AND DATE_TRUNC('month', credits_awarded_at) = DATE_TRUNC('month', NOW())
    `;

    const referralCount = stats?.count || 0;

    // Check if bonus already awarded this month
    const [existingBonus] = await sql`
      SELECT threshold_reached
      FROM monthly_referral_bonuses
      WHERE user_id = ${userId}
        AND month_year = ${monthYear}
    `;

    if (existingBonus?.threshold_reached) {
      return 0; // Already received bonus
    }

    // Update or create monthly record
    await sql`
      INSERT INTO monthly_referral_bonuses (
        user_id, organization_id, month_year, referral_count
      )
      VALUES (${userId}, ${organizationId}, ${monthYear}, ${referralCount})
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET
        referral_count = ${referralCount}
    `;

    // Check if threshold reached
    if (referralCount >= MONTHLY_BONUS_THRESHOLD) {
      // Award bonus
      await sql`
        UPDATE monthly_referral_bonuses
        SET threshold_reached = true,
            bonus_credits_awarded = ${MONTHLY_BONUS_CREDITS}
        WHERE user_id = ${userId}
          AND month_year = ${monthYear}
      `;

      await grantBonusCredits(
        organizationId,
        MONTHLY_BONUS_CREDITS,
        `Monthly referral bonus: ${referralCount} referrals in ${monthYear}`,
        {
          monthYear,
          referralCount,
        }
      );

      await logEvent('monthly_referral_bonus_awarded', 'user', userId, {
        monthYear,
        referralCount,
        bonusCredits: MONTHLY_BONUS_CREDITS,
      });

      return MONTHLY_BONUS_CREDITS;
    }

    return 0;
  } catch (error) {
    console.error('[REFERRAL] Failed to check monthly bonus:', error);
    return 0;
  }
}

/**
 * Award credits for a social media share.
 * Limited to once per platform per day.
 */
export async function awardSocialShareCredits(
  userId: string,
  organizationId: string,
  platform: SocialPlatform,
  shareUrl?: string
): Promise<{ success: boolean; creditsAwarded: number; alreadyClaimed: boolean }> {
  try {
    if (!SOCIAL_PLATFORMS.includes(platform)) {
      return { success: false, creditsAwarded: 0, alreadyClaimed: false };
    }

    // Check if already shared on this platform today
    const [existing] = await sql`
      SELECT id, credits_awarded
      FROM social_media_shares
      WHERE user_id = ${userId}
        AND platform = ${platform}
        AND DATE(created_at) = DATE(NOW())
    `;

    if (existing) {
      return {
        success: false,
        creditsAwarded: 0,
        alreadyClaimed: existing.credits_awarded,
      };
    }

    // Record the share
    const [share] = await sql`
      INSERT INTO social_media_shares (
        user_id, organization_id, platform, share_url,
        verified, credits_awarded, credits_amount
      )
      VALUES (
        ${userId}, ${organizationId}, ${platform}, ${shareUrl || null},
        true, true, ${SOCIAL_SHARE_CREDITS}
      )
      RETURNING id
    `;

    // Award credits
    await grantBonusCredits(
      organizationId,
      SOCIAL_SHARE_CREDITS,
      `Social share bonus: ${platform}`,
      {
        shareId: share.id,
        platform,
        shareUrl,
      }
    );

    await logEvent('social_share_credits_awarded', 'user', userId, {
      shareId: share.id,
      platform,
      credits: SOCIAL_SHARE_CREDITS,
    });

    return { success: true, creditsAwarded: SOCIAL_SHARE_CREDITS, alreadyClaimed: false };
  } catch (error) {
    console.error('[REFERRAL] Failed to award social share credits:', error);
    return { success: false, creditsAwarded: 0, alreadyClaimed: false };
  }
}

/**
 * Get referral statistics for a user.
 */
export async function getReferralStats(userId: string): Promise<{
  referralCode: string | null;
  totalReferrals: number;
  successfulReferrals: number;
  pendingReferrals: number;
  totalCreditsEarned: number;
  monthlyProgress: {
    count: number;
    threshold: number;
    bonusAwarded: boolean;
  };
  recentReferrals: Array<{
    id: string;
    signedUpAt: Date;
    hasConverted: boolean;
    creditsAwarded: number;
  }>;
  socialShares: Array<{
    platform: SocialPlatform;
    sharedToday: boolean;
    creditsEarned: number;
  }>;
}> {
  try {
    // Get referral code
    const [codeRecord] = await sql`
      SELECT code FROM user_referral_codes
      WHERE user_id = ${userId}
    `;

    // Get referral counts
    const [stats] = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE credits_awarded = true)::int as successful,
        COUNT(*) FILTER (WHERE credits_awarded = false)::int as pending,
        COALESCE(SUM(credits_amount), 0)::int as total_credits
      FROM referral_signups
      WHERE referrer_user_id = ${userId}
    `;

    // Get monthly progress
    const monthYear = new Date().toISOString().slice(0, 7);
    const [monthly] = await sql`
      SELECT referral_count, threshold_reached, bonus_credits_awarded
      FROM monthly_referral_bonuses
      WHERE user_id = ${userId}
        AND month_year = ${monthYear}
    `;

    // Get recent referrals
    const recentReferrals = await sql`
      SELECT id, signed_up_at, credits_awarded, credits_amount
      FROM referral_signups
      WHERE referrer_user_id = ${userId}
      ORDER BY signed_up_at DESC
      LIMIT 10
    `;

    // Get social share status
    const socialSharesRaw = await sql`
      SELECT platform,
             SUM(credits_amount)::int as total_credits,
             MAX(CASE WHEN DATE(created_at) = DATE(NOW()) THEN 1 ELSE 0 END) as shared_today
      FROM social_media_shares
      WHERE user_id = ${userId}
      GROUP BY platform
    `;

    const socialSharesMap = new Map(
      socialSharesRaw.map((s: any) => [s.platform, { credits: s.total_credits, today: s.shared_today === 1 }])
    );

    const socialShares = SOCIAL_PLATFORMS.map((platform) => ({
      platform,
      sharedToday: socialSharesMap.get(platform)?.today || false,
      creditsEarned: socialSharesMap.get(platform)?.credits || 0,
    }));

    return {
      referralCode: codeRecord?.code || null,
      totalReferrals: stats?.total || 0,
      successfulReferrals: stats?.successful || 0,
      pendingReferrals: stats?.pending || 0,
      totalCreditsEarned: stats?.total_credits || 0,
      monthlyProgress: {
        count: monthly?.referral_count || 0,
        threshold: MONTHLY_BONUS_THRESHOLD,
        bonusAwarded: monthly?.threshold_reached || false,
      },
      recentReferrals: recentReferrals.map((r: any) => ({
        id: r.id,
        signedUpAt: new Date(r.signed_up_at),
        hasConverted: r.credits_awarded,
        creditsAwarded: r.credits_amount,
      })),
      socialShares,
    };
  } catch (error) {
    console.error('[REFERRAL] Failed to get referral stats:', error);
    return {
      referralCode: null,
      totalReferrals: 0,
      successfulReferrals: 0,
      pendingReferrals: 0,
      totalCreditsEarned: 0,
      monthlyProgress: {
        count: 0,
        threshold: MONTHLY_BONUS_THRESHOLD,
        bonusAwarded: false,
      },
      recentReferrals: [],
      socialShares: SOCIAL_PLATFORMS.map((platform) => ({
        platform,
        sharedToday: false,
        creditsEarned: 0,
      })),
    };
  }
}
