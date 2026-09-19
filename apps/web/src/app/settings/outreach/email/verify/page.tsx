'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Mail,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  XCircle,
  Eye,
  EyeOff,
  Zap,
  Cloud,
  Server,
  Info,
  ExternalLink,
  RefreshCw,
  Copy,
  CreditCard,
  Globe,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================
type EmailProvider = 'platform' | 'aws_ses' | 'smtp' | 'sendgrid' | 'resend';

interface EmailCredentials {
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpEncryption?: 'tls' | 'ssl' | 'none';
  apiKey?: string;
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  verified: boolean;
}

interface VerificationStatus {
  status: string;
  provider: string;
  isActive: boolean;
  needsVerification: boolean;
  verifiedAt?: string;
  metadata: {
    domain?: string;
    fromAddress?: string;
    fromName?: string;
    dnsRecords?: DnsRecord[];
    spfVerified?: boolean;
    dkimVerified?: boolean;
    dmarcVerified?: boolean;
  };
  nextStep?: string;
}

const PROVIDERS: { value: EmailProvider; label: string; description: string; icon: React.ReactNode; needsVerification: boolean }[] = [
  {
    value: 'platform',
    label: 'Platform Email',
    description: 'Use our built-in email service. No setup required, pay per send.',
    icon: <Zap className="h-5 w-5" />,
    needsVerification: false,
  },
  {
    value: 'aws_ses',
    label: 'Amazon SES',
    description: 'High volume at $0.10 per 1,000 emails. Requires AWS account.',
    icon: <Cloud className="h-5 w-5" />,
    needsVerification: true,
  },
  {
    value: 'smtp',
    label: 'Custom SMTP',
    description: 'Use Gmail, Outlook, or any SMTP server you control.',
    icon: <Server className="h-5 w-5" />,
    needsVerification: true,
  },
  {
    value: 'sendgrid',
    label: 'SendGrid',
    description: '100 emails/day free tier. Easy setup with API key.',
    icon: <Mail className="h-5 w-5" />,
    needsVerification: true,
  },
  {
    value: 'resend',
    label: 'Resend',
    description: '3,000 emails/month free. Modern developer-friendly API.',
    icon: <Mail className="h-5 w-5" />,
    needsVerification: true,
  },
];

const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
];

// ============================================================================
// Step Components
// ============================================================================
function ProviderSelector({
  value,
  onChange,
}: {
  value: EmailProvider;
  onChange: (v: EmailProvider) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          Choose Your Email Provider
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Select how you want to send emails to your leads.
        </p>
      </div>

      <div className="grid gap-3">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.value}
            type="button"
            onClick={() => onChange(provider.value)}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              value === provider.value
                ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/5'
                : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)]/50 hover:border-[var(--border-medium)]'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className={`p-2.5 rounded-lg ${
                value === provider.value
                  ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
              }`}>
                {provider.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--text-primary)]">{provider.label}</span>
                  {value === provider.value && (
                    <CheckCircle className="h-4 w-4 text-[var(--accent-blue)]" />
                  )}
                  {!provider.needsVerification && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-success)]/10 text-[var(--color-success)]">
                      No verification needed
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{provider.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Credit System Notice */}
      <div className="p-4 rounded-lg bg-gradient-to-r from-[var(--accent-blue)]/5 to-[var(--accent-purple)]/5 border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <CreditCard className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Your Credentials, Our Credits</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Your credentials ensure deliverability with your domain reputation. All usage is metered through our credit system,
              giving you control over costs while we handle the infrastructure.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CredentialsForm({
  provider,
  credentials,
  fromAddress,
  fromName,
  domain,
  onChange,
  onFromAddressChange,
  onFromNameChange,
  onDomainChange,
  errors,
}: {
  provider: EmailProvider;
  credentials: EmailCredentials;
  fromAddress: string;
  fromName: string;
  domain: string;
  onChange: (updates: Partial<EmailCredentials>) => void;
  onFromAddressChange: (email: string) => void;
  onFromNameChange: (name: string) => void;
  onDomainChange: (domain: string) => void;
  errors: Record<string, string>;
}) {
  const [showSecrets, setShowSecrets] = useState(false);

  // Auto-extract domain from email
  useEffect(() => {
    if (fromAddress && fromAddress.includes('@')) {
      const emailDomain = fromAddress.split('@')[1];
      if (emailDomain && emailDomain !== domain) {
        onDomainChange(emailDomain);
      }
    }
  }, [fromAddress, domain, onDomainChange]);

  if (provider === 'platform') {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-gradient-to-r from-[var(--accent-blue)]/5 to-[var(--accent-purple)]/5 border border-[var(--border-subtle)]">
          <div className="flex items-start gap-3">
            <Zap className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Ready to Go!</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Platform email is pre-configured. Just set your sender details below
                and you're ready to start sending.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Sender Name</Label>
            <Input
              value={fromName}
              onChange={(e) => onFromNameChange(e.target.value)}
              placeholder="Your Company Name"
              className="mt-1.5 bg-[var(--bg-primary)]"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              This name appears as the "from" name in emails
            </p>
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Reply-To Email</Label>
            <Input
              type="email"
              value={fromAddress}
              onChange={(e) => onFromAddressChange(e.target.value)}
              placeholder="replies@yourcompany.com"
              className={`mt-1.5 bg-[var(--bg-primary)] ${errors.fromAddress ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.fromAddress && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.fromAddress}</p>
            )}
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Lead replies will go to this address
            </p>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Platform Email Pricing</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">Deducted from your credit balance</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-[var(--text-primary)]">1 credit</p>
              <p className="text-xs text-[var(--text-muted)]">per email</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (provider === 'aws_ses') {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">AWS SES Setup</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Create an IAM user with SES permissions. After credentials, you'll verify
                domain ownership via DNS records.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">AWS Access Key ID</Label>
            <Input
              value={credentials.awsAccessKeyId || ''}
              onChange={(e) => onChange({ awsAccessKeyId: e.target.value })}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              className={`mt-1.5 bg-[var(--bg-primary)] font-mono text-sm ${errors.awsAccessKeyId ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.awsAccessKeyId && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.awsAccessKeyId}</p>
            )}
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">AWS Region</Label>
            <Select
              value={credentials.awsRegion || 'us-east-1'}
              onValueChange={(v) => onChange({ awsRegion: v })}
            >
              <SelectTrigger className="mt-1.5 bg-[var(--bg-primary)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AWS_REGIONS.map((region) => (
                  <SelectItem key={region.value} value={region.value}>
                    {region.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-sm text-[var(--text-secondary)]">AWS Secret Access Key</Label>
          <div className="relative mt-1.5">
            <Input
              type={showSecrets ? 'text' : 'password'}
              value={credentials.awsSecretAccessKey || ''}
              onChange={(e) => onChange({ awsSecretAccessKey: e.target.value })}
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              className={`bg-[var(--bg-primary)] font-mono text-sm pr-10 ${errors.awsSecretAccessKey ? 'border-[var(--color-error)]' : ''}`}
            />
            <button
              type="button"
              onClick={() => setShowSecrets(!showSecrets)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.awsSecretAccessKey && (
            <p className="text-xs text-[var(--color-error)] mt-1">{errors.awsSecretAccessKey}</p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">From Email Address</Label>
            <Input
              type="email"
              value={fromAddress}
              onChange={(e) => onFromAddressChange(e.target.value)}
              placeholder="outreach@yourcompany.com"
              className={`mt-1.5 bg-[var(--bg-primary)] ${errors.fromAddress ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.fromAddress && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.fromAddress}</p>
            )}
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Sender Name</Label>
            <Input
              value={fromName}
              onChange={(e) => onFromNameChange(e.target.value)}
              placeholder="Your Company Name"
              className="mt-1.5 bg-[var(--bg-primary)]"
            />
          </div>
        </div>

        <div>
          <Label className="text-sm text-[var(--text-secondary)]">Domain (for DNS verification)</Label>
          <Input
            value={domain}
            onChange={(e) => onDomainChange(e.target.value)}
            placeholder="yourcompany.com"
            className="mt-1.5 bg-[var(--bg-primary)]"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Auto-filled from your email address. You'll add DNS records to this domain.
          </p>
        </div>
      </div>
    );
  }

  if (provider === 'smtp') {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">SMTP Configuration</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                For Gmail, use smtp.gmail.com with an App Password.
                For Outlook, use smtp-mail.outlook.com.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">SMTP Host</Label>
            <Input
              value={credentials.smtpHost || ''}
              onChange={(e) => onChange({ smtpHost: e.target.value })}
              placeholder="smtp.gmail.com"
              className={`mt-1.5 bg-[var(--bg-primary)] ${errors.smtpHost ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.smtpHost && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.smtpHost}</p>
            )}
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Port</Label>
            <Input
              value={credentials.smtpPort || '587'}
              onChange={(e) => onChange({ smtpPort: e.target.value })}
              placeholder="587"
              className="mt-1.5 bg-[var(--bg-primary)]"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Username</Label>
            <Input
              value={credentials.smtpUser || ''}
              onChange={(e) => onChange({ smtpUser: e.target.value })}
              placeholder="your@email.com"
              className={`mt-1.5 bg-[var(--bg-primary)] ${errors.smtpUser ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.smtpUser && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.smtpUser}</p>
            )}
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Password / App Password</Label>
            <div className="relative mt-1.5">
              <Input
                type={showSecrets ? 'text' : 'password'}
                value={credentials.smtpPass || ''}
                onChange={(e) => onChange({ smtpPass: e.target.value })}
                placeholder="Your app password"
                className={`bg-[var(--bg-primary)] pr-10 ${errors.smtpPass ? 'border-[var(--color-error)]' : ''}`}
              />
              <button
                type="button"
                onClick={() => setShowSecrets(!showSecrets)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.smtpPass && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.smtpPass}</p>
            )}
          </div>
        </div>

        <div>
          <Label className="text-sm text-[var(--text-secondary)]">Encryption</Label>
          <Select
            value={credentials.smtpEncryption || 'tls'}
            onValueChange={(v) => onChange({ smtpEncryption: v as 'tls' | 'ssl' | 'none' })}
          >
            <SelectTrigger className="mt-1.5 bg-[var(--bg-primary)] w-full md:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tls">TLS (Recommended)</SelectItem>
              <SelectItem value="ssl">SSL</SelectItem>
              <SelectItem value="none">None</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">From Email Address</Label>
            <Input
              type="email"
              value={fromAddress}
              onChange={(e) => onFromAddressChange(e.target.value)}
              placeholder="outreach@yourcompany.com"
              className={`mt-1.5 bg-[var(--bg-primary)] ${errors.fromAddress ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.fromAddress && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.fromAddress}</p>
            )}
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Sender Name</Label>
            <Input
              value={fromName}
              onChange={(e) => onFromNameChange(e.target.value)}
              placeholder="Your Company Name"
              className="mt-1.5 bg-[var(--bg-primary)]"
            />
          </div>
        </div>

        <div>
          <Label className="text-sm text-[var(--text-secondary)]">Domain (for DNS verification)</Label>
          <Input
            value={domain}
            onChange={(e) => onDomainChange(e.target.value)}
            placeholder="yourcompany.com"
            className="mt-1.5 bg-[var(--bg-primary)]"
          />
        </div>
      </div>
    );
  }

  // SendGrid or Resend
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {provider === 'sendgrid' ? 'SendGrid' : 'Resend'} Setup
            </p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              {provider === 'sendgrid'
                ? 'Create an API key in your SendGrid dashboard with "Mail Send" permissions.'
                : 'Create an API key in your Resend dashboard and verify your sending domain.'}
            </p>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-sm text-[var(--text-secondary)]">API Key</Label>
        <div className="relative mt-1.5">
          <Input
            type={showSecrets ? 'text' : 'password'}
            value={credentials.apiKey || ''}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder={provider === 'sendgrid' ? 'SG.xxxxxxxxxxxxxxxx' : 're_xxxxxxxxxxxxxxxx'}
            className={`bg-[var(--bg-primary)] font-mono text-sm pr-10 ${errors.apiKey ? 'border-[var(--color-error)]' : ''}`}
          />
          <button
            type="button"
            onClick={() => setShowSecrets(!showSecrets)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.apiKey && (
          <p className="text-xs text-[var(--color-error)] mt-1">{errors.apiKey}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label className="text-sm text-[var(--text-secondary)]">From Email Address</Label>
          <Input
            type="email"
            value={fromAddress}
            onChange={(e) => onFromAddressChange(e.target.value)}
            placeholder="outreach@yourcompany.com"
            className={`mt-1.5 bg-[var(--bg-primary)] ${errors.fromAddress ? 'border-[var(--color-error)]' : ''}`}
          />
          {errors.fromAddress && (
            <p className="text-xs text-[var(--color-error)] mt-1">{errors.fromAddress}</p>
          )}
        </div>
        <div>
          <Label className="text-sm text-[var(--text-secondary)]">Sender Name</Label>
          <Input
            value={fromName}
            onChange={(e) => onFromNameChange(e.target.value)}
            placeholder="Your Company Name"
            className="mt-1.5 bg-[var(--bg-primary)]"
          />
        </div>
      </div>

      <div>
        <Label className="text-sm text-[var(--text-secondary)]">Domain (for DNS verification)</Label>
        <Input
          value={domain}
          onChange={(e) => onDomainChange(e.target.value)}
          placeholder="yourcompany.com"
          className="mt-1.5 bg-[var(--bg-primary)]"
        />
      </div>
    </div>
  );
}

function DnsVerificationStep({
  dnsRecords,
  domain,
  onCheck,
  isChecking,
}: {
  dnsRecords: DnsRecord[];
  domain: string;
  onCheck: () => void;
  isChecking: boolean;
}) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const allVerified = dnsRecords.every(r => r.verified);
  const verifiedCount = dnsRecords.filter(r => r.verified).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          Verify Domain Ownership
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Add the following DNS records to <span className="font-medium text-[var(--text-primary)]">{domain}</span> to verify ownership and improve deliverability.
        </p>
      </div>

      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <Globe className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Why DNS Records?</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              SPF, DKIM, and DMARC records prove you own the domain and help prevent your emails
              from being marked as spam. This is industry standard for business email.
            </p>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">Verification Progress</span>
          <span className="text-sm text-[var(--text-muted)]">{verifiedCount} / {dnsRecords.length}</span>
        </div>
        <div className="h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent-blue)] transition-all"
            style={{ width: `${(verifiedCount / dnsRecords.length) * 100}%` }}
          />
        </div>
      </div>

      {/* DNS Records */}
      <div className="space-y-3">
        {dnsRecords.map((record, index) => (
          <div
            key={index}
            className={`p-4 rounded-lg border ${
              record.verified
                ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/5'
                : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-tertiary)]">
                  {record.type}
                </span>
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {record.type === 'TXT' && record.name.includes('_domainkey') ? 'DKIM' :
                   record.type === 'TXT' && record.name.includes('_dmarc') ? 'DMARC' :
                   record.type === 'TXT' ? 'SPF' : record.type}
                </span>
              </div>
              {record.verified ? (
                <span className="flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <CheckCircle className="h-3.5 w-3.5" />
                  Verified
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-[var(--color-warning)]">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Pending
                </span>
              )}
            </div>

            <div className="space-y-2">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Name / Host</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-[var(--bg-tertiary)] px-2 py-1.5 rounded font-mono overflow-x-auto">
                    {record.name}
                  </code>
                  <button
                    onClick={() => copyToClipboard(record.name)}
                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">Value</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-[var(--bg-tertiary)] px-2 py-1.5 rounded font-mono overflow-x-auto break-all">
                    {record.value}
                  </code>
                  <button
                    onClick={() => copyToClipboard(record.value)}
                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-[var(--color-warning)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--color-warning)]">DNS Propagation Time</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              DNS changes can take up to 48 hours to propagate. If verification fails,
              wait a few hours and try again.
            </p>
          </div>
        </div>
      </div>

      <Button onClick={onCheck} disabled={isChecking} className="w-full">
        {isChecking ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Checking DNS Records...
          </>
        ) : allVerified ? (
          <>
            <CheckCircle className="h-4 w-4 mr-2" />
            All Records Verified
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-2" />
            Check DNS Records
          </>
        )}
      </Button>
    </div>
  );
}

function SuccessStep() {
  const router = useRouter();

  return (
    <div className="space-y-4 text-center">
      <div className="flex justify-center">
        <div className="p-4 rounded-full bg-[var(--color-success)]/10">
          <CheckCircle className="h-12 w-12 text-[var(--color-success)]" />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          Email Outreach is Active!
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          You can now send email campaigns to your leads. Your credentials ensure deliverability,
          and all usage is metered through our credit system.
        </p>
      </div>

      <div className="flex items-center justify-center gap-3 pt-4">
        <Button variant="outline" onClick={() => router.push('/settings/outreach')}>
          Back to Settings
        </Button>
        <Button onClick={() => router.push('/campaigns')}>
          Create Campaign
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================
export default function EmailVerifyPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending: authLoading } = useSession();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<EmailProvider>('platform');
  const [credentials, setCredentials] = useState<EmailCredentials>({});
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [domain, setDomain] = useState('');
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load existing status
  const { data: status, isLoading: statusLoading } = useQuery<VerificationStatus>({
    queryKey: ['outreach-status-email'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/status');
      if (!res.ok) return null;
      const data = await res.json();
      return data.email;
    },
    enabled: !!session,
  });

  // Initialize from existing status
  useEffect(() => {
    if (status) {
      if (status.isActive) {
        setStep(4); // Already active
      } else if (status.status === 'DNS_PENDING') {
        setStep(3); // Waiting for DNS
        setDomain(status.metadata?.domain || '');
        setDnsRecords(status.metadata?.dnsRecords || []);
      }
    }
  }, [status]);

  // Start verification mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/outreach/verify/email/dns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, credentials, domain, fromAddress, fromName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['outreach-status-email'] });

      if (data.status === 'ACTIVE') {
        // Platform provider
        setStep(4);
        toast.success('Email outreach activated!');
      } else if (data.status === 'DNS_PENDING') {
        // BYOP - go to DNS step
        setDnsRecords(data.dnsRecords || []);
        setStep(3);
        toast.success('Add the DNS records to your domain');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Check DNS mutation
  const checkDnsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/outreach/verify/email/check', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['outreach-status-email'] });

      if (data.dnsRecords) {
        setDnsRecords(data.dnsRecords);
      }

      if (data.status === 'ACTIVE') {
        setStep(4);
        toast.success('All DNS records verified! Email outreach is active.');
      } else {
        toast.info(data.message || 'Some DNS records are still pending');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!fromAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
      newErrors.fromAddress = 'Please enter a valid email address';
    }

    if (provider === 'aws_ses') {
      if (!credentials.awsAccessKeyId) newErrors.awsAccessKeyId = 'Access Key ID is required';
      if (!credentials.awsSecretAccessKey) newErrors.awsSecretAccessKey = 'Secret Access Key is required';
    }

    if (provider === 'smtp') {
      if (!credentials.smtpHost) newErrors.smtpHost = 'SMTP host is required';
      if (!credentials.smtpUser) newErrors.smtpUser = 'Username is required';
      if (!credentials.smtpPass) newErrors.smtpPass = 'Password is required';
    }

    if (provider === 'sendgrid' || provider === 'resend') {
      if (!credentials.apiKey) newErrors.apiKey = 'API key is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      if (provider === 'platform' || validateStep2()) {
        startMutation.mutate();
      }
    }
  };

  const handleBack = () => {
    if (step > 1 && step < 4) {
      setStep(step - 1);
      setErrors({});
    }
  };

  if (authLoading || statusLoading) {
    return <EmailVerifySkeleton />;
  }

  if (!session) {
    redirect('/account/signin');
  }

  const totalSteps = provider === 'platform' ? 2 : 3;
  const stepLabels = provider === 'platform'
    ? ['Provider', 'Configure']
    : ['Provider', 'Credentials', 'DNS Verification'];

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      {/* Header */}
      <header className="flex items-center gap-4">
        <Link
          href="/settings/outreach"
          className="p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-[var(--text-muted)]" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Email Verification</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Set up and verify your email outreach credentials
          </p>
        </div>
      </header>

      {/* Progress Steps */}
      {step < 4 && (
        <div className="flex items-center justify-between px-4">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    step > i + 1
                      ? 'bg-[var(--accent-blue)] text-white'
                      : step === i + 1
                      ? 'bg-[var(--accent-blue)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                  }`}
                >
                  {step > i + 1 ? <Check className="h-4 w-4" /> : i + 1}
                </div>
                <span className="text-xs text-[var(--text-muted)] mt-1">{label}</span>
              </div>
              {i < stepLabels.length - 1 && (
                <div
                  className={`w-16 md:w-24 h-0.5 mx-2 ${
                    step > i + 1 ? 'bg-[var(--accent-blue)]' : 'bg-[var(--bg-tertiary)]'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Step Content */}
      <GlassCard variant="bordered" padding="lg">
        {step === 1 && (
          <ProviderSelector
            value={provider}
            onChange={(v) => {
              setProvider(v);
              setCredentials({});
              setErrors({});
            }}
          />
        )}

        {step === 2 && (
          <CredentialsForm
            provider={provider}
            credentials={credentials}
            fromAddress={fromAddress}
            fromName={fromName}
            domain={domain}
            onChange={(updates) => setCredentials({ ...credentials, ...updates })}
            onFromAddressChange={setFromAddress}
            onFromNameChange={setFromName}
            onDomainChange={setDomain}
            errors={errors}
          />
        )}

        {step === 3 && (
          <DnsVerificationStep
            dnsRecords={dnsRecords}
            domain={domain}
            onCheck={() => checkDnsMutation.mutate()}
            isChecking={checkDnsMutation.isPending}
          />
        )}

        {step === 4 && <SuccessStep />}
      </GlassCard>

      {/* Navigation */}
      {step < 4 && step !== 3 && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} disabled={step === 1}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <Button onClick={handleNext} disabled={startMutation.isPending}>
            {startMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {provider === 'platform' ? 'Activating...' : 'Validating Credentials...'}
              </>
            ) : step === 2 && provider !== 'platform' ? (
              <>
                Generate DNS Records
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="flex justify-start">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Credentials
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Skeleton
// ============================================================================
function EmailVerifySkeleton() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 skeleton-dark rounded-lg" />
        <div>
          <div className="h-6 w-48 skeleton-dark rounded mb-2" />
          <div className="h-4 w-64 skeleton-dark rounded" />
        </div>
      </div>
      <div className="flex items-center justify-between px-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center">
            <div className="h-8 w-8 skeleton-dark rounded-full" />
            {i < 3 && <div className="w-24 h-0.5 skeleton-dark mx-2" />}
          </div>
        ))}
      </div>
      <div className="h-96 skeleton-dark rounded-xl" />
    </div>
  );
}
