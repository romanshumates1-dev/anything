/**
 * Referrals Claim API - POST to claim social media share credits
 *
 * Verifies and awards credits for sharing on social media platforms.
 * Limited to once per platform per day.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { getOrganization } from '@/lib/organization-context';
import {
  awardSocialShareCredits,
  SOCIAL_PLATFORMS,
  SOCIAL_SHARE_CREDITS,
  type SocialPlatform,
} from '@/app/api/utils/referralRewards';

interface ClaimRequest {
  platform: SocialPlatform;
  shareUrl?: string;
}

interface ClaimResponse {
  success: boolean;
  creditsAwarded: number;
  message: string;
  platform: string;
}

/**
 * POST /api/referrals/claim
 * Claim social media share credits for a specific platform
 *
 * Body:
 *   - platform: 'twitter' | 'facebook' | 'linkedin' | 'instagram' | 'tiktok'
 *   - shareUrl: (optional) URL of the shared post for verification
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
    const body: ClaimRequest = await req.json();
    const { platform, shareUrl } = body;

    // Validate platform
    if (!platform || !SOCIAL_PLATFORMS.includes(platform)) {
      return NextResponse.json(
        {
          error: 'Invalid platform',
          validPlatforms: SOCIAL_PLATFORMS,
        },
        { status: 400 }
      );
    }

    const userId = session.user.id;

    // Award credits
    const result = await awardSocialShareCredits(userId, organization.id, platform, shareUrl);

    if (result.alreadyClaimed) {
      const response: ClaimResponse = {
        success: false,
        creditsAwarded: 0,
        message: `You've already claimed credits for ${platform} today. Try again tomorrow!`,
        platform,
      };
      return NextResponse.json(response, { status: 409 });
    }

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to claim credits' },
        { status: 500 }
      );
    }

    const response: ClaimResponse = {
      success: true,
      creditsAwarded: result.creditsAwarded,
      message: `You earned ${SOCIAL_SHARE_CREDITS} credits for sharing on ${platform}!`,
      platform,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('[REFERRALS/CLAIM] POST error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to claim credits' }, { status: 500 });
  }
}
