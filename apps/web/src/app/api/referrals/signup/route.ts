/**
 * Referrals Signup API - POST when a referred user signs up
 *
 * Called during registration when a user signs up with a referral code.
 * Records the referral relationship for later credit award.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import {
  lookupReferralCode,
  recordReferralSignup,
  awardReferralCredits,
} from '@/app/api/utils/referralRewards';
import sql from '@/app/api/utils/sql';

interface SignupRequest {
  referralCode: string;
  referredUserId: string;
}

interface SignupResponse {
  success: boolean;
  message: string;
  referrerId?: string;
}

/**
 * POST /api/referrals/signup
 * Record a referral when a new user signs up with a referral code.
 *
 * This can be called in two ways:
 * 1. During signup - with referralCode and referredUserId
 * 2. After a purchase - with referredUserId to trigger credit award
 *
 * Body:
 *   - referralCode: The referral code used during signup
 *   - referredUserId: The ID of the newly registered user
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Require authentication
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: SignupRequest = await req.json();
    const { referralCode, referredUserId } = body;

    // Validate required fields
    if (!referredUserId) {
      return NextResponse.json(
        { error: 'referredUserId is required' },
        { status: 400 }
      );
    }

    // Verify that referredUserId matches the authenticated user
    if (referredUserId !== session.user.id) {
      return NextResponse.json(
        { error: 'referredUserId must match authenticated user' },
        { status: 403 }
      );
    }

    // If no referral code, check if this is a purchase notification
    // for an existing referral
    if (!referralCode) {
      // This might be a purchase event - try to award credits
      const result = await awardReferralCredits(referredUserId);

      if (result.creditsAwarded > 0) {
        return NextResponse.json({
          success: true,
          message: 'Referral credits awarded',
          creditsAwarded: result.creditsAwarded,
          bonusAwarded: result.bonusAwarded,
        });
      }

      return NextResponse.json(
        { error: 'No pending referral found or credits already awarded' },
        { status: 404 }
      );
    }

    // Lookup the referral code
    const referrer = await lookupReferralCode(referralCode);
    if (!referrer) {
      return NextResponse.json(
        { error: 'Invalid referral code' },
        { status: 400 }
      );
    }

    // Prevent self-referral
    if (referrer.userId === referredUserId) {
      return NextResponse.json(
        { error: 'Cannot use your own referral code' },
        { status: 400 }
      );
    }

    // Record the referral
    const result = await recordReferralSignup(
      referrer.userId,
      referredUserId,
      referralCode
    );

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to record referral' },
        { status: 500 }
      );
    }

    // Update the referred user's record
    await sql`
      UPDATE "user"
      SET referred_by_code = ${referralCode.toUpperCase()},
          referred_at = NOW()
      WHERE id = ${referredUserId}
    `.catch(() => {
      // Column might not exist yet, ignore
    });

    const response: SignupResponse = {
      success: true,
      message: 'Referral recorded successfully',
      referrerId: referrer.userId,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[REFERRALS/SIGNUP] POST error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to process referral' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/referrals/signup
 * Called when a referred user makes their first purchase.
 * Triggers credit award to the referrer.
 *
 * Body:
 *   - referredUserId: The ID of the user who made the purchase
 *   - purchaseId: (optional) ID of the purchase for tracking
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  // This endpoint can be called by the payment system
  // after a successful purchase to award referral credits
  const session = await auth.api.getSession({ headers: await headers() });

  try {
    const body = await req.json();
    const { referredUserId, purchaseId } = body;

    if (!referredUserId) {
      return NextResponse.json(
        { error: 'referredUserId is required' },
        { status: 400 }
      );
    }

    // If not authenticated, verify this is a valid internal call
    // (could add API key verification here for webhook calls)
    if (!session) {
      // For now, allow unauthenticated calls for webhook integration
      // In production, add proper authentication for webhooks
    }

    const result = await awardReferralCredits(referredUserId, purchaseId);

    return NextResponse.json({
      success: result.creditsAwarded > 0,
      creditsAwarded: result.creditsAwarded,
      bonusAwarded: result.bonusAwarded,
      message:
        result.creditsAwarded > 0
          ? `Awarded ${result.creditsAwarded} referral credits${result.bonusAwarded > 0 ? ` + ${result.bonusAwarded} monthly bonus` : ''}`
          : 'No credits awarded (already claimed or no referral found)',
    });
  } catch (error: any) {
    console.error('[REFERRALS/SIGNUP] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to award referral credits' },
      { status: 500 }
    );
  }
}
