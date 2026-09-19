/**
 * POST /api/outreach/verify/sms/confirm
 *
 * Verify the SMS code entered by the user.
 */

import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import { verifySmsCode } from '@/app/api/utils/outreachVerification';
import { logEvent } from '@/app/api/utils/logger';

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== 'string') {
      return Response.json({ error: 'Verification code is required' }, { status: 400 });
    }

    // Clean up the code (remove spaces/dashes)
    const cleanCode = code.replace(/[\s-]/g, '');

    if (!/^\d{6}$/.test(cleanCode)) {
      return Response.json(
        { error: 'Invalid code format. Please enter the 6-digit code.' },
        { status: 400 }
      );
    }

    const result = await verifySmsCode(organization.id, cleanCode, session.userId);

    await logEvent(
      result.success ? 'sms_verification_confirmed' : 'sms_verification_failed',
      'outreach_verification',
      organization.id,
      { status: result.status },
      session.userId
    );

    if (!result.success) {
      return Response.json(result, { status: 400 });
    }

    return Response.json(result);
  } catch (error: any) {
    console.error('[SMS Verification Confirm] Error:', error);
    return Response.json(
      { error: 'Failed to verify code', message: error.message },
      { status: 500 }
    );
  }
}
