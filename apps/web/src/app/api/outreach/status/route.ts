/**
 * GET /api/outreach/status
 *
 * Get verification status for all outreach channels.
 * Returns status for both SMS and Email, including whether they're active.
 */

import { requireSession } from '@/app/api/utils/auth';
import { getOrganization } from '@/lib/organization-context';
import {
  getAllVerificationStatuses,
  isOutreachActive,
  OutreachVerification,
} from '@/app/api/utils/outreachVerification';
import sql from '@/app/api/utils/sql';

interface ChannelStatus {
  status: string;
  provider: string;
  isActive: boolean;
  needsVerification: boolean;
  verifiedAt?: string;
  metadata: Record<string, any>;
  nextStep?: string;
}

interface OutreachStatus {
  sms: ChannelStatus;
  email: ChannelStatus;
  canLaunchCampaigns: boolean;
  message?: string;
}

function mapVerificationToStatus(
  verification: OutreachVerification | null,
  isActive: boolean
): ChannelStatus {
  if (!verification) {
    return {
      status: 'NOT_CONFIGURED',
      provider: 'none',
      isActive: false,
      needsVerification: true,
      metadata: {},
      nextStep: 'configure',
    };
  }

  // Platform providers are always ready
  if (verification.provider === 'platform') {
    const needsCompliance =
      verification.channel === 'sms' && !verification.complianceAgreed;

    return {
      status: needsCompliance ? 'NEEDS_COMPLIANCE' : 'ACTIVE',
      provider: 'platform',
      isActive: isActive && !needsCompliance,
      needsVerification: false,
      verifiedAt: verification.verifiedAt?.toISOString(),
      metadata: verification.metadata,
      nextStep: needsCompliance ? 'compliance' : undefined,
    };
  }

  // BYOP providers need full verification
  let nextStep: string | undefined;

  switch (verification.status) {
    case 'PENDING':
      nextStep = 'start_verification';
      break;
    case 'VERIFYING':
      nextStep = 'enter_code';
      break;
    case 'DNS_PENDING':
      nextStep = 'check_dns';
      break;
    case 'VERIFIED':
      nextStep = verification.channel === 'sms' ? 'compliance' : undefined;
      break;
    case 'EXPIRED':
    case 'FAILED':
      nextStep = 'restart_verification';
      break;
    case 'SUSPENDED':
      nextStep = 'contact_support';
      break;
  }

  return {
    status: verification.status,
    provider: verification.provider,
    isActive,
    needsVerification: !['ACTIVE', 'VERIFIED'].includes(verification.status),
    verifiedAt: verification.verifiedAt?.toISOString(),
    metadata: verification.metadata,
    nextStep,
  };
}

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const organization = await getOrganization();
  if (!organization) {
    return Response.json({ error: 'No organization found' }, { status: 403 });
  }

  try {
    // Get verification records
    const { sms: smsVerification, email: emailVerification } = await getAllVerificationStatuses(
      organization.id
    );

    // Check if channels are active
    const [smsActive, emailActive] = await Promise.all([
      isOutreachActive(organization.id, 'sms'),
      isOutreachActive(organization.id, 'email'),
    ]);

    // If no verification records exist, check app_settings for platform config
    let smsStatus = mapVerificationToStatus(smsVerification, smsActive);
    let emailStatus = mapVerificationToStatus(emailVerification, emailActive);

    // Check app_settings if no verification record exists
    if (!smsVerification || !emailVerification) {
      const [settings] = await sql`
        SELECT value FROM app_settings WHERE key = 'outreach_config'
      `;

      if (settings?.value) {
        const config = settings.value as Record<string, any>;

        if (!smsVerification && config.sms?.configured) {
          if (config.sms.provider === 'platform') {
            smsStatus = {
              status: config.sms.tcpaAgreed ? 'ACTIVE' : 'NEEDS_COMPLIANCE',
              provider: 'platform',
              isActive: config.sms.tcpaAgreed,
              needsVerification: false,
              metadata: { phoneNumber: 'platform', tcpaAgreed: config.sms.tcpaAgreed },
              nextStep: config.sms.tcpaAgreed ? undefined : 'compliance',
            };
          } else {
            // BYOP but no verification record - needs verification
            smsStatus = {
              status: 'NEEDS_VERIFICATION',
              provider: config.sms.provider,
              isActive: false,
              needsVerification: true,
              metadata: { phoneNumber: config.sms.phoneNumber },
              nextStep: 'start_verification',
            };
          }
        }

        if (!emailVerification && config.email?.configured) {
          if (config.email.provider === 'platform') {
            emailStatus = {
              status: 'ACTIVE',
              provider: 'platform',
              isActive: true,
              needsVerification: false,
              metadata: {
                domain: 'platform',
                fromAddress: config.email.fromAddress,
                fromName: config.email.fromName,
              },
            };
          } else {
            // BYOP but no verification record - needs verification
            emailStatus = {
              status: 'NEEDS_VERIFICATION',
              provider: config.email.provider,
              isActive: false,
              needsVerification: true,
              metadata: { fromAddress: config.email.fromAddress },
              nextStep: 'start_verification',
            };
          }
        }
      }
    }

    // Determine if campaigns can be launched
    // At least one channel must be active
    const canLaunchCampaigns = smsStatus.isActive || emailStatus.isActive;

    let message: string | undefined;
    if (!canLaunchCampaigns) {
      if (smsStatus.status === 'NOT_CONFIGURED' && emailStatus.status === 'NOT_CONFIGURED') {
        message = 'Configure at least one outreach channel (SMS or Email) to launch campaigns.';
      } else if (smsStatus.needsVerification && emailStatus.needsVerification) {
        message = 'Complete verification for at least one outreach channel to launch campaigns.';
      } else if (smsStatus.status === 'NEEDS_COMPLIANCE') {
        message = 'Complete TCPA compliance acknowledgment to activate SMS outreach.';
      }
    }

    const response: OutreachStatus = {
      sms: smsStatus,
      email: emailStatus,
      canLaunchCampaigns,
      message,
    };

    return Response.json(response);
  } catch (error: any) {
    console.error('[Outreach Status] Error:', error);
    return Response.json(
      { error: 'Failed to get outreach status', message: error.message },
      { status: 500 }
    );
  }
}
