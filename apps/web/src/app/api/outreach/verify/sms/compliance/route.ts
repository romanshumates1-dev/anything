/**
 * POST /api/outreach/verify/sms/compliance
 *
 * Complete TCPA compliance acknowledgment for SMS.
 */

import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import { completeSmsCompliance } from '@/app/api/utils/outreachVerification';
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
    const { acknowledged } = body;

    if (!acknowledged) {
      return Response.json(
        { error: 'You must acknowledge TCPA compliance to activate SMS' },
        { status: 400 }
      );
    }

    const result = await completeSmsCompliance(organization.id, session.userId);

    await logEvent(
      'sms_tcpa_compliance_agreed',
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
    console.error('[SMS Compliance] Error:', error);
    return Response.json(
      { error: 'Failed to complete compliance', message: error.message },
      { status: 500 }
    );
  }
}
