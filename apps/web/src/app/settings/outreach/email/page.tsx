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
  Send,
  Zap,
  Cloud,
  Server,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================
type EmailProvider = 'platform' | 'ses' | 'smtp' | 'sendgrid' | 'resend';

interface EmailConfig {
  provider: EmailProvider;
  fromAddress: string;
  fromName: string;
  // AWS SES
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  // SMTP
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpEncryption?: 'tls' | 'ssl' | 'none';
  // SendGrid / Resend
  apiKey?: string;
  // Status
  configured: boolean;
  verified: boolean;
  lastTestedAt?: string;
}

const PROVIDERS: { value: EmailProvider; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'platform',
    label: 'Platform Email',
    description: 'Use our built-in email service. No setup required, pay per send.',
    icon: <Zap className="h-5 w-5" />,
  },
  {
    value: 'ses',
    label: 'Amazon SES',
    description: 'High volume at $0.10 per 1,000 emails. Requires AWS account.',
    icon: <Cloud className="h-5 w-5" />,
  },
  {
    value: 'smtp',
    label: 'Custom SMTP',
    description: 'Use Gmail, Outlook, or any SMTP server you control.',
    icon: <Server className="h-5 w-5" />,
  },
  {
    value: 'sendgrid',
    label: 'SendGrid',
    description: '100 emails/day free tier. Easy setup with API key.',
    icon: <Mail className="h-5 w-5" />,
  },
  {
    value: 'resend',
    label: 'Resend',
    description: '3,000 emails/month free. Modern developer-friendly API.',
    icon: <Send className="h-5 w-5" />,
  },
];

const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'EU (Ireland)' },
  { value: 'eu-central-1', label: 'EU (Frankfurt)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
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
          Select how you want to send emails to your leads. You can change this later.
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
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{provider.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ProviderConfigForm({
  provider,
  config,
  onChange,
  errors,
}: {
  provider: EmailProvider;
  config: Partial<EmailConfig>;
  onChange: (updates: Partial<EmailConfig>) => void;
  errors: Record<string, string>;
}) {
  const [showSecrets, setShowSecrets] = useState(false);

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
              value={config.fromName || ''}
              onChange={(e) => onChange({ fromName: e.target.value })}
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
              value={config.fromAddress || ''}
              onChange={(e) => onChange({ fromAddress: e.target.value })}
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
      </div>
    );
  }

  if (provider === 'ses') {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">AWS SES Setup</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Create an IAM user with SES send permissions and enter the credentials below.
                Make sure your sending domain is verified in SES.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">AWS Access Key ID</Label>
            <Input
              value={config.awsAccessKeyId || ''}
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
              value={config.awsRegion || 'us-east-1'}
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
              value={config.awsSecretAccessKey || ''}
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
              value={config.fromAddress || ''}
              onChange={(e) => onChange({ fromAddress: e.target.value })}
              placeholder="outreach@yourcompany.com"
              className={`mt-1.5 bg-[var(--bg-primary)] ${errors.fromAddress ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.fromAddress && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.fromAddress}</p>
            )}
            <p className="text-xs text-[var(--text-muted)] mt-1">Must be verified in SES</p>
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Sender Name</Label>
            <Input
              value={config.fromName || ''}
              onChange={(e) => onChange({ fromName: e.target.value })}
              placeholder="Your Company Name"
              className="mt-1.5 bg-[var(--bg-primary)]"
            />
          </div>
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
              value={config.smtpHost || ''}
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
              value={config.smtpPort || '587'}
              onChange={(e) => onChange({ smtpPort: e.target.value })}
              placeholder="587"
              className="mt-1.5 bg-[var(--bg-primary)]"
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">Usually 587 (TLS) or 465 (SSL)</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Username</Label>
            <Input
              value={config.smtpUser || ''}
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
                value={config.smtpPass || ''}
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
            value={config.smtpEncryption || 'tls'}
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
              value={config.fromAddress || ''}
              onChange={(e) => onChange({ fromAddress: e.target.value })}
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
              value={config.fromName || ''}
              onChange={(e) => onChange({ fromName: e.target.value })}
              placeholder="Your Company Name"
              className="mt-1.5 bg-[var(--bg-primary)]"
            />
          </div>
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
            value={config.apiKey || ''}
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
            value={config.fromAddress || ''}
            onChange={(e) => onChange({ fromAddress: e.target.value })}
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
            value={config.fromName || ''}
            onChange={(e) => onChange({ fromName: e.target.value })}
            placeholder="Your Company Name"
            className="mt-1.5 bg-[var(--bg-primary)]"
          />
        </div>
      </div>
    </div>
  );
}

function TestEmailStep({
  config,
  userEmail,
  onTestSent,
}: {
  config: Partial<EmailConfig>;
  userEmail: string;
  onTestSent: () => void;
}) {
  const [testEmail, setTestEmail] = useState(userEmail);
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const sendTestEmail = async () => {
    setTestStatus('sending');
    setErrorMessage('');

    try {
      const res = await fetch('/api/settings/outreach/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail, config }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send test email');
      }

      setTestStatus('success');
      onTestSent();
      toast.success('Test email sent! Check your inbox.');
    } catch (err: any) {
      setTestStatus('error');
      setErrorMessage(err.message);
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          Test Your Email Configuration
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Send a test email to verify everything is working correctly.
        </p>
      </div>

      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <Mail className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">Configuration Summary</p>
            <div className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
              <p>Provider: <span className="text-[var(--text-primary)]">{config.provider?.toUpperCase()}</span></p>
              <p>From: <span className="text-[var(--text-primary)]">{config.fromName} &lt;{config.fromAddress}&gt;</span></p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-sm text-[var(--text-secondary)]">Send Test Email To</Label>
        <Input
          type="email"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
          placeholder="your@email.com"
          className="mt-1.5 bg-[var(--bg-primary)]"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          We'll send a test email to this address
        </p>
      </div>

      {testStatus === 'error' && (
        <div className="p-4 rounded-lg bg-[var(--color-error)]/10 border border-[var(--color-error)]/20">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-[var(--color-error)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--color-error)]">Test Failed</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {testStatus === 'success' && (
        <div className="p-4 rounded-lg bg-[var(--color-success)]/10 border border-[var(--color-success)]/20">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-[var(--color-success)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--color-success)]">Test Email Sent!</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Check your inbox at {testEmail}. If you don't see it, check spam.
              </p>
            </div>
          </div>
        </div>
      )}

      <Button
        onClick={sendTestEmail}
        disabled={testStatus === 'sending' || !testEmail}
        className="w-full"
      >
        {testStatus === 'sending' ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Sending Test Email...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Send Test Email
          </>
        )}
      </Button>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================
export default function EmailSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending: authLoading } = useSession();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<EmailProvider>('platform');
  const [config, setConfig] = useState<Partial<EmailConfig>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testPassed, setTestPassed] = useState(false);

  // Load existing config
  const { data: existingConfig, isLoading: configLoading } = useQuery<EmailConfig | null>({
    queryKey: ['email-config'],
    queryFn: async () => {
      const res = await fetch('/api/settings/outreach');
      if (!res.ok) return null;
      const data = await res.json();
      return data.email?.configured ? data.email : null;
    },
    enabled: !!session,
  });

  // Initialize form with existing config
  useEffect(() => {
    if (existingConfig) {
      setProvider(existingConfig.provider);
      setConfig(existingConfig);
      if (existingConfig.verified) {
        setStep(3);
        setTestPassed(true);
      } else {
        setStep(2);
      }
    }
  }, [existingConfig]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/outreach', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: {
            ...config,
            provider,
            configured: true,
            verified: testPassed,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save configuration');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outreach-config'] });
      queryClient.invalidateQueries({ queryKey: ['email-config'] });
      toast.success('Email configuration saved!');
      router.push('/settings/outreach');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!config.fromAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.fromAddress)) {
      newErrors.fromAddress = 'Please enter a valid email address';
    }

    if (provider === 'ses') {
      if (!config.awsAccessKeyId) newErrors.awsAccessKeyId = 'Access Key ID is required';
      if (!config.awsSecretAccessKey) newErrors.awsSecretAccessKey = 'Secret Access Key is required';
    }

    if (provider === 'smtp') {
      if (!config.smtpHost) newErrors.smtpHost = 'SMTP host is required';
      if (!config.smtpUser) newErrors.smtpUser = 'Username is required';
      if (!config.smtpPass) newErrors.smtpPass = 'Password is required';
    }

    if (provider === 'sendgrid' || provider === 'resend') {
      if (!config.apiKey) newErrors.apiKey = 'API key is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      if (validateStep2()) {
        setStep(3);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  if (authLoading || configLoading) {
    return <EmailSettingsSkeleton />;
  }

  if (!session) {
    redirect('/account/signin');
  }

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
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Email Configuration</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Set up how DealFlow AI sends emails
          </p>
        </div>
      </header>

      {/* Progress Steps */}
      <div className="flex items-center justify-between px-4">
        {[
          { num: 1, label: 'Provider' },
          { num: 2, label: 'Settings' },
          { num: 3, label: 'Test' },
        ].map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step >= s.num
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                }`}
              >
                {step > s.num ? <Check className="h-4 w-4" /> : s.num}
              </div>
              <span className="text-xs text-[var(--text-muted)] mt-1">{s.label}</span>
            </div>
            {i < 2 && (
              <div
                className={`w-16 md:w-24 h-0.5 mx-2 ${
                  step > s.num ? 'bg-[var(--accent-blue)]' : 'bg-[var(--bg-tertiary)]'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step Content */}
      <GlassCard variant="bordered" padding="lg">
        {step === 1 && (
          <ProviderSelector
            value={provider}
            onChange={(v) => {
              setProvider(v);
              setConfig({ fromAddress: config.fromAddress, fromName: config.fromName });
              setErrors({});
            }}
          />
        )}

        {step === 2 && (
          <ProviderConfigForm
            provider={provider}
            config={config}
            onChange={(updates) => setConfig({ ...config, ...updates })}
            errors={errors}
          />
        )}

        {step === 3 && (
          <TestEmailStep
            config={{ ...config, provider }}
            userEmail={session.user?.email || ''}
            onTestSent={() => setTestPassed(true)}
          />
        )}
      </GlassCard>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={handleBack} disabled={step === 1}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <div className="flex items-center gap-3">
          {step === 3 && (
            <Button variant="outline" onClick={() => router.push('/settings/outreach')}>
              Skip Test
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={handleNext}>
              Next
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Save Configuration
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Skeleton
// ============================================================================
function EmailSettingsSkeleton() {
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
