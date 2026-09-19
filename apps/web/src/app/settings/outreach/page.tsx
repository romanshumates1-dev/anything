'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/badge';
import {
  Settings2,
  Mail,
  MessageSquare,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  XCircle,
  Shield,
  Zap,
  ExternalLink,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================
interface OutreachConfig {
  email: {
    provider: 'platform' | 'ses' | 'smtp' | 'sendgrid' | 'resend' | 'none';
    configured: boolean;
    verified: boolean;
    fromAddress?: string;
  };
  sms: {
    provider: 'platform' | 'twilio' | 'sns' | 'none';
    configured: boolean;
    phoneNumber?: string;
    tcpaAgreed: boolean;
  };
}

// ============================================================================
// Status Components
// ============================================================================
function StatusIndicator({ status }: { status: 'connected' | 'partial' | 'not-configured' }) {
  const configs = {
    connected: {
      icon: CheckCircle,
      color: 'text-[var(--color-success)]',
      bg: 'bg-[var(--color-success)]/10',
      border: 'border-[var(--color-success)]/20',
      label: 'Connected',
    },
    partial: {
      icon: AlertCircle,
      color: 'text-[var(--color-warning)]',
      bg: 'bg-[var(--color-warning)]/10',
      border: 'border-[var(--color-warning)]/20',
      label: 'Needs Setup',
    },
    'not-configured': {
      icon: XCircle,
      color: 'text-[var(--text-muted)]',
      bg: 'bg-[var(--bg-tertiary)]',
      border: 'border-[var(--border-subtle)]',
      label: 'Not Configured',
    },
  };

  const config = configs[status];
  const Icon = config.icon;

  return (
    <Badge className={`${config.bg} ${config.color} ${config.border} border`}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  );
}

function getEmailStatus(email: OutreachConfig['email']): 'connected' | 'partial' | 'not-configured' {
  if (email.configured && email.verified) return 'connected';
  if (email.configured || email.provider !== 'none') return 'partial';
  return 'not-configured';
}

function getSmsStatus(sms: OutreachConfig['sms']): 'connected' | 'partial' | 'not-configured' {
  if (sms.configured && sms.tcpaAgreed) return 'connected';
  if (sms.configured || sms.provider !== 'none') return 'partial';
  return 'not-configured';
}

// ============================================================================
// Channel Card Component
// ============================================================================
function ChannelCard({
  title,
  description,
  icon: Icon,
  href,
  status,
  details,
  features,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  href: string;
  status: 'connected' | 'partial' | 'not-configured';
  details?: string;
  features: string[];
}) {
  return (
    <Link href={href} className="block group">
      <GlassCard variant="bordered" padding="none" className="h-full hover:border-[var(--accent-blue)]/40 transition-all">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${
                status === 'connected'
                  ? 'bg-gradient-to-br from-[var(--color-success)]/20 to-[var(--color-success)]/10'
                  : status === 'partial'
                  ? 'bg-gradient-to-br from-[var(--color-warning)]/20 to-[var(--color-warning)]/10'
                  : 'bg-[var(--bg-tertiary)]'
              }`}>
                <Icon className={`h-6 w-6 ${
                  status === 'connected'
                    ? 'text-[var(--color-success)]'
                    : status === 'partial'
                    ? 'text-[var(--color-warning)]'
                    : 'text-[var(--text-muted)]'
                }`} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">{description}</p>
              </div>
            </div>
            <StatusIndicator status={status} />
          </div>

          {/* Details */}
          {details && (
            <div className="mb-4 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
              <p className="text-sm text-[var(--text-secondary)]">{details}</p>
            </div>
          )}

          {/* Features */}
          <div className="space-y-2 mb-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Zap className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
                {feature}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[var(--bg-tertiary)]/50 border-t border-[var(--border-subtle)] flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--accent-blue)] group-hover:text-[var(--accent-blue)] transition-colors">
            {status === 'not-configured' ? 'Set Up Now' : 'Manage Settings'}
          </span>
          <ArrowRight className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent-blue)] group-hover:translate-x-1 transition-all" />
        </div>
      </GlassCard>
    </Link>
  );
}

// ============================================================================
// Main Page
// ============================================================================
export default function OutreachSettingsPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: config, isLoading: configLoading } = useQuery<OutreachConfig>({
    queryKey: ['outreach-config'],
    queryFn: async () => {
      const res = await fetch('/api/settings/outreach');
      if (!res.ok) {
        // Return defaults if not configured yet
        return {
          email: { provider: 'none', configured: false, verified: false },
          sms: { provider: 'none', configured: false, tcpaAgreed: false },
        };
      }
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading || configLoading) {
    return <OutreachSettingsSkeleton />;
  }

  if (!session) {
    redirect('/account/signin');
  }

  const emailStatus = config ? getEmailStatus(config.email) : 'not-configured';
  const smsStatus = config ? getSmsStatus(config.sms) : 'not-configured';

  return (
    <div className="space-y-8 max-w-4xl pb-12">
      {/* Page Header */}
      <header className="border-b border-[var(--border-subtle)] pb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 border border-[var(--border-subtle)]">
            <Settings2 className="h-7 w-7 text-[var(--accent-blue)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Outreach Settings
            </h1>
            <p className="text-[var(--text-secondary)] mt-0.5">
              Configure how DealFlow AI sends emails and text messages to your leads
            </p>
          </div>
        </div>
      </header>

      {/* Quick Status Banner */}
      <div className="p-5 rounded-xl bg-gradient-to-r from-[var(--accent-blue)]/5 to-[var(--accent-purple)]/5 border border-[var(--border-subtle)]">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-[var(--accent-blue)]/10">
            <Shield className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Why configure your own providers?
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Using your own email and SMS providers gives you better deliverability,
              lower costs at scale, and full control over your sender reputation.
            </p>
          </div>
        </div>
      </div>

      {/* Channel Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <ChannelCard
          title="Email"
          description="Send personalized emails to leads"
          icon={Mail}
          href="/settings/outreach/email/verify"
          status={emailStatus}
          details={
            config?.email.provider !== 'none' && config?.email.provider !== 'platform'
              ? `Using ${config?.email.provider?.toUpperCase()}${config?.email.fromAddress ? ` from ${config?.email.fromAddress}` : ''}`
              : undefined
          }
          features={[
            'Multi-touch email sequences',
            'Automatic CAN-SPAM compliance',
            'Open and click tracking',
            'Custom sender name and address',
          ]}
        />

        <ChannelCard
          title="SMS"
          description="Text message outreach to leads"
          icon={MessageSquare}
          href="/settings/outreach/sms/verify"
          status={smsStatus}
          details={
            config?.sms.provider !== 'none' && config?.sms.provider !== 'platform'
              ? `Using ${config?.sms.provider === 'sns' ? 'AWS SNS' : 'Twilio'}${config?.sms.phoneNumber ? ` from ${config?.sms.phoneNumber}` : ''}`
              : undefined
          }
          features={[
            'Automated SMS campaigns',
            'Two-way conversations',
            'TCPA compliance built-in',
            '10DLC registration support',
          ]}
        />
      </div>

      {/* Platform Option Note */}
      <GlassCard variant="bordered" padding="lg">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-lg bg-[var(--accent-purple)]/10">
            <Zap className="h-5 w-5 text-[var(--accent-purple)]" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
              Platform Email & SMS (Pay-Per-Use)
            </h3>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Don't have your own providers? Use our built-in sending infrastructure.
              No setup required - just pay for what you send.
            </p>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text-primary)]">$0.01</span> per email
              </span>
              <span className="text-[var(--border-medium)]">|</span>
              <span className="text-[var(--text-muted)]">
                <span className="font-semibold text-[var(--text-primary)]">$0.02</span> per SMS
              </span>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Help Links */}
      <div className="flex items-center justify-center gap-6 pt-4">
        <a
          href="https://docs.dealflow.ai/outreach/email"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--accent-blue)] transition-colors flex items-center gap-1"
        >
          Email Setup Guide
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <a
          href="https://docs.dealflow.ai/outreach/sms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--accent-blue)] transition-colors flex items-center gap-1"
        >
          SMS Compliance Guide
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

// ============================================================================
// Skeleton
// ============================================================================
function OutreachSettingsSkeleton() {
  return (
    <div className="space-y-8 max-w-4xl animate-pulse">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] pb-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl skeleton-dark" />
          <div>
            <div className="h-7 w-48 skeleton-dark rounded mb-2" />
            <div className="h-4 w-80 skeleton-dark rounded" />
          </div>
        </div>
      </div>

      {/* Banner */}
      <div className="h-24 skeleton-dark rounded-xl" />

      {/* Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="h-72 skeleton-dark rounded-xl" />
        <div className="h-72 skeleton-dark rounded-xl" />
      </div>

      {/* Footer */}
      <div className="h-32 skeleton-dark rounded-xl" />
    </div>
  );
}
