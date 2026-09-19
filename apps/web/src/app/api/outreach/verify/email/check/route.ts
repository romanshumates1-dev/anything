/**
 * POST /api/outreach/verify/email/check
 *
 * Check DNS propagation for email verification.
 */

import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import { checkEmailDns } from '@/app/api/utils/outreachVerification';
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
    const result = await checkEmailDns(organization.id, session.userId);

    await logEvent(
      result.success ? 'email_dns_verified' : 'email_dns_check',
      'outreach_verification',
      organization.id,
      {
        status: result.status,
        dnsRecords: result.dnsRecords?.map(r => ({ type: r.type, verified: r.verified })),
      },
      session.userId
    );

    return Response.json(result);
  } catch (error: any) {
    console.error('[Email DNS Check] Error:', error);
    return Response.json(
      { error: 'Failed to check DNS records', message: error.message },
      { status: 500 }
    );
  }
}
