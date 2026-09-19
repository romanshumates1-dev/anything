'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  CheckCircle,
  AlertCircle,
  XCircle,
  Clock,
  Ban,
  MessageSquare,
  Mail,
  Shield,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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

type BadgeVariant = 'active' | 'warning' | 'error' | 'pending' | 'suspended';

const STATUS_CONFIG: Record<string, { variant: BadgeVariant; label: string; icon: React.ReactNode }> = {
  ACTIVE: {
    variant: 'active',
    label: 'Active',
    icon: <CheckCircle className="h-3 w-3" />,
  },
  VERIFIED: {
    variant: 'warning',
    label: 'Verified',
    icon: <Shield className="h-3 w-3" />,
  },
  VERIFYING: {
    variant: 'pending',
    label: 'Verifying',
    icon: <Clock className="h-3 w-3" />,
  },
  DNS_PENDING: {
    variant: 'pending',
    label: 'DNS Pending',
    icon: <Clock className="h-3 w-3" />,
  },
  PENDING: {
    variant: 'pending',
    label: 'Pending',
    icon: <Clock className="h-3 w-3" />,
  },
  NEEDS_COMPLIANCE: {
    variant: 'warning',
    label: 'Needs Compliance',
    icon: <AlertCircle className="h-3 w-3" />,
  },
  NEEDS_VERIFICATION: {
    variant: 'warning',
    label: 'Needs Verification',
    icon: <AlertCircle className="h-3 w-3" />,
  },
  NOT_CONFIGURED: {
    variant: 'error',
    label: 'Not Configured',
    icon: <XCircle className="h-3 w-3" />,
  },
  FAILED: {
    variant: 'error',
    label: 'Failed',
    icon: <XCircle className="h-3 w-3" />,
  },
  EXPIRED: {
    variant: 'error',
    label: 'Expired',
    icon: <XCircle className="h-3 w-3" />,
  },
  SUSPENDED: {
    variant: 'suspended',
    label: 'Suspended',
    icon: <Ban className="h-3 w-3" />,
  },
};

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  active: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20',
  warning: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20',
  error: 'bg-[var(--color-error)]/10 text-[var(--color-error)] border-[var(--color-error)]/20',
  pending: 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-[var(--accent-blue)]/20',
  suspended: 'bg-[var(--text-muted)]/10 text-[var(--text-muted)] border-[var(--text-muted)]/20',
};

/**
 * Single channel status badge
 */
export function ChannelStatusBadge({
  channel,
  status,
  showLink = false,
  size = 'sm',
}: {
  channel: 'sms' | 'email';
  status: ChannelStatus;
  showLink?: boolean;
  size?: 'sm' | 'md';
}) {
  const config = STATUS_CONFIG[status.status] || STATUS_CONFIG.NOT_CONFIGURED;
  const Icon = channel === 'sms' ? MessageSquare : Mail;

  const badge = (
    <Badge
      className={`${VARIANT_STYLES[config.variant]} border flex items-center gap-1 ${
        size === 'md' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <Icon className={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
      {config.icon}
      <span className="capitalize">{config.label}</span>
    </Badge>
  );

  if (showLink && status.nextStep) {
    const href = channel === 'sms' ? '/settings/outreach/sms/verify' : '/settings/outreach/email/verify';
    return (
      <Link href={href} className="hover:opacity-80 transition-opacity">
        {badge}
      </Link>
    );
  }

  return badge;
}

/**
 * Combined outreach status (both channels)
 */
export function OutreachStatusSummary({
  showDetails = false,
  showLinks = true,
}: {
  showDetails?: boolean;
  showLinks?: boolean;
}) {
  const { data: status, isLoading } = useQuery<OutreachStatus>({
    queryKey: ['outreach-status'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/status');
      if (!res.ok) {
        return {
          sms: { status: 'NOT_CONFIGURED', provider: 'none', isActive: false, needsVerification: true, metadata: {} },
          email: { status: 'NOT_CONFIGURED', provider: 'none', isActive: false, needsVerification: true, metadata: {} },
          canLaunchCampaigns: false,
        };
      }
      return res.json();
    },
    staleTime: 30000, // 30 seconds
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-5 w-20 animate-pulse skeleton-dark rounded" />
        <div className="h-5 w-20 animate-pulse skeleton-dark rounded" />
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <ChannelStatusBadge channel="sms" status={status.sms} showLink={showLinks} />
        <ChannelStatusBadge channel="email" status={status.email} showLink={showLinks} />
      </div>

      {showDetails && status.message && (
        <p className="text-xs text-[var(--text-muted)]">{status.message}</p>
      )}
    </div>
  );
}

/**
 * Campaign launch gate - shows warning if outreach is not active
 */
export function CampaignLaunchGate({
  children,
  onBlocked,
}: {
  children: React.ReactNode;
  onBlocked?: () => void;
}) {
  const { data: status } = useQuery<OutreachStatus>({
    queryKey: ['outreach-status'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/status');
      if (!res.ok) return null;
      return res.json();
    },
  });

  if (!status) return <>{children}</>;

  if (!status.canLaunchCampaigns) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="cursor-not-allowed"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onBlocked?.();
              }}
            >
              <div className="opacity-50 pointer-events-none">{children}</div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="font-medium mb-1">Outreach Not Active</p>
            <p className="text-xs text-[var(--text-muted)]">
              {status.message || 'Configure and verify at least one outreach channel to launch campaigns.'}
            </p>
            <Link
              href="/settings/outreach"
              className="text-xs text-[var(--accent-blue)] hover:underline mt-2 block"
            >
              Go to Outreach Settings
            </Link>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <>{children}</>;
}

/**
 * Hook to check outreach status
 */
export function useOutreachStatus() {
  return useQuery<OutreachStatus>({
    queryKey: ['outreach-status'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/status');
      if (!res.ok) {
        return {
          sms: { status: 'NOT_CONFIGURED', provider: 'none', isActive: false, needsVerification: true, metadata: {} },
          email: { status: 'NOT_CONFIGURED', provider: 'none', isActive: false, needsVerification: true, metadata: {} },
          canLaunchCampaigns: false,
        };
      }
      return res.json();
    },
    staleTime: 30000,
  });
}
