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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  MessageSquare,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
  Send,
  Zap,
  Cloud,
  Shield,
  Info,
  ExternalLink,
  RefreshCw,
  CreditCard,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================
type SmsProvider = 'platform' | 'twilio' | 'aws_sns';

interface SmsCredentials {
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  twilioMessagingServiceSid?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
}

interface VerificationStatus {
  status: string;
  provider: string;
  isActive: boolean;
  needsVerification: boolean;
  verifiedAt?: string;
  metadata: Record<string, any>;
  nextStep?: string;
}

const PROVIDERS: { value: SmsProvider; label: string; description: string; icon: React.ReactNode; needsVerification: boolean }[] = [
  {
    value: 'platform',
    label: 'Platform SMS',
    description: 'Use our built-in SMS service. No setup required, pay per message.',
    icon: <Zap className="h-5 w-5" />,
    needsVerification: false,
  },
  {
    value: 'twilio',
    label: 'Twilio',
    description: 'Industry standard SMS with 10DLC support. Requires Twilio account.',
    icon: <MessageSquare className="h-5 w-5" />,
    needsVerification: true,
  },
  {
    value: 'aws_sns',
    label: 'AWS SNS',
    description: 'Low cost at ~$0.015 per SMS. Requires AWS account with SNS enabled.',
    icon: <Cloud className="h-5 w-5" />,
    needsVerification: true,
  },
];

const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
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
  value: SmsProvider;
  onChange: (v: SmsProvider) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          Choose Your SMS Provider
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Select how you want to send text messages to your leads.
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
              Your credentials ensure deliverability to your audience. All usage is metered through our credit system,
              giving you control over costs while we handle the infrastructure.
            </p>
          </div>
        </div>
      </div>

      {/* 10DLC Notice */}
      <div className="p-4 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-[var(--color-warning)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--color-warning)]">10DLC Registration Required</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              To send SMS to US numbers, you need to register your business for 10DLC (10-digit long code).
              This applies to all providers and helps ensure high deliverability.
            </p>
            <a
              href="https://www.twilio.com/docs/messaging/compliance/a2p-10dlc"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1 mt-2"
            >
              Learn about 10DLC registration
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function CredentialsForm({
  provider,
  credentials,
  phoneNumber,
  onChange,
  onPhoneChange,
  errors,
}: {
  provider: SmsProvider;
  credentials: SmsCredentials;
  phoneNumber: string;
  onChange: (updates: Partial<SmsCredentials>) => void;
  onPhoneChange: (phone: string) => void;
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
                Platform SMS is pre-configured and ready to use.
                Messages are sent from our shared 10DLC-registered number pool.
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Platform SMS Pricing</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">Deducted from your credit balance</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-[var(--text-primary)]">1 credit</p>
              <p className="text-xs text-[var(--text-muted)]">per SMS segment</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (provider === 'twilio') {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Twilio Setup</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Find your Account SID and Auth Token in the{' '}
                <a
                  href="https://console.twilio.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-blue)] hover:underline"
                >
                  Twilio Console
                </a>
                . We'll verify you own the phone number by sending a code to it.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Account SID</Label>
            <Input
              value={credentials.twilioAccountSid || ''}
              onChange={(e) => onChange({ twilioAccountSid: e.target.value })}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className={`mt-1.5 bg-[var(--bg-primary)] font-mono text-sm ${errors.twilioAccountSid ? 'border-[var(--color-error)]' : ''}`}
            />
            {errors.twilioAccountSid && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.twilioAccountSid}</p>
            )}
          </div>
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Auth Token</Label>
            <div className="relative mt-1.5">
              <Input
                type={showSecrets ? 'text' : 'password'}
                value={credentials.twilioAuthToken || ''}
                onChange={(e) => onChange({ twilioAuthToken: e.target.value })}
                placeholder="Your Twilio Auth Token"
                className={`bg-[var(--bg-primary)] font-mono text-sm pr-10 ${errors.twilioAuthToken ? 'border-[var(--color-error)]' : ''}`}
              />
              <button
                type="button"
                onClick={() => setShowSecrets(!showSecrets)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.twilioAuthToken && (
              <p className="text-xs text-[var(--color-error)] mt-1">{errors.twilioAuthToken}</p>
            )}
          </div>
        </div>

        <div>
          <Label className="text-sm text-[var(--text-secondary)]">Twilio Phone Number (for verification)</Label>
          <Input
            value={phoneNumber}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="+15551234567"
            className={`mt-1.5 bg-[var(--bg-primary)] ${errors.phoneNumber ? 'border-[var(--color-error)]' : ''}`}
          />
          {errors.phoneNumber && (
            <p className="text-xs text-[var(--color-error)] mt-1">{errors.phoneNumber}</p>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-1">
            We'll send a verification code to this number to confirm you own it
          </p>
        </div>

        <div>
          <Label className="text-sm text-[var(--text-secondary)]">Messaging Service SID (Optional)</Label>
          <Input
            value={credentials.twilioMessagingServiceSid || ''}
            onChange={(e) => onChange({ twilioMessagingServiceSid: e.target.value })}
            placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="mt-1.5 bg-[var(--bg-primary)] font-mono text-sm"
          />
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Use a Messaging Service for automatic number rotation and higher throughput
          </p>
        </div>
      </div>
    );
  }

  // AWS SNS
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">AWS SNS Setup</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Create an IAM user with SNS SMS permissions. We'll verify your setup by sending
              a code to your phone number.
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

      <div>
        <Label className="text-sm text-[var(--text-secondary)]">Your Phone Number (for verification)</Label>
        <Input
          value={phoneNumber}
          onChange={(e) => onPhoneChange(e.target.value)}
          placeholder="+15551234567"
          className={`mt-1.5 bg-[var(--bg-primary)] ${errors.phoneNumber ? 'border-[var(--color-error)]' : ''}`}
        />
        {errors.phoneNumber && (
          <p className="text-xs text-[var(--color-error)] mt-1">{errors.phoneNumber}</p>
        )}
        <p className="text-xs text-[var(--text-muted)] mt-1">
          We'll send a verification code to this number to confirm your AWS SNS is working
        </p>
      </div>
    </div>
  );
}

function VerificationCodeStep({
  phoneNumber,
  onVerify,
  onResend,
  isVerifying,
  isResending,
  error,
}: {
  phoneNumber: string;
  onVerify: (code: string) => void;
  onResend: () => void;
  isVerifying: boolean;
  isResending: boolean;
  error?: string;
}) {
  const [code, setCode] = useState('');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          Verify Phone Number Ownership
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          We sent a 6-digit code to <span className="font-medium text-[var(--text-primary)]">{phoneNumber}</span>.
          Enter it below to verify you own this number.
        </p>
      </div>

      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-[var(--accent-purple)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Why Verify?</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              This ensures you own the phone number you're using, preventing credential theft
              and unauthorized use of your Twilio/AWS account.
            </p>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-sm text-[var(--text-secondary)]">Verification Code</Label>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className="mt-1.5 bg-[var(--bg-primary)] text-center text-2xl tracking-[0.5em] font-mono"
          maxLength={6}
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Code expires in 15 minutes
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-[var(--color-error)]/10 border border-[var(--color-error)]/20">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 text-[var(--color-error)] mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--color-error)]">Verification Failed</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={() => onVerify(code)}
          disabled={code.length !== 6 || isVerifying}
          className="flex-1"
        >
          {isVerifying ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Verify Code
            </>
          )}
        </Button>

        <Button
          variant="outline"
          onClick={onResend}
          disabled={isResending}
        >
          {isResending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <p className="text-xs text-center text-[var(--text-muted)]">
        Didn't receive the code?{' '}
        <button
          onClick={onResend}
          disabled={isResending}
          className="text-[var(--accent-blue)] hover:underline disabled:opacity-50"
        >
          Resend code
        </button>
      </p>
    </div>
  );
}

function ComplianceStep({
  onComplete,
  isSubmitting,
}: {
  onComplete: () => void;
  isSubmitting: boolean;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          TCPA Compliance Agreement
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Before sending SMS messages, you must agree to comply with the Telephone Consumer Protection Act (TCPA).
        </p>
      </div>

      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 text-[var(--accent-purple)] mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Why This Matters</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              TCPA violations can result in fines of $500-$1,500 per message.
              DealFlow AI helps you stay compliant, but you are responsible for ensuring
              you have proper consent from recipients.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">By checking below, you agree that:</h3>
        <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-[var(--color-success)] mt-0.5 shrink-0" />
            You have obtained prior express written consent from all recipients before sending marketing messages
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-[var(--color-success)] mt-0.5 shrink-0" />
            You will honor opt-out requests immediately (STOP, UNSUBSCRIBE, etc.)
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-[var(--color-success)] mt-0.5 shrink-0" />
            You will only send messages during reasonable hours (8am-9pm recipient's local time)
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-[var(--color-success)] mt-0.5 shrink-0" />
            You will identify yourself in each message
          </li>
          <li className="flex items-start gap-2">
            <Check className="h-4 w-4 text-[var(--color-success)] mt-0.5 shrink-0" />
            You will maintain records of consent for at least 4 years
          </li>
        </ul>
      </div>

      <div className="p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              I agree to comply with TCPA and all applicable SMS regulations
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              This agreement is required to send SMS messages through DealFlow AI
            </p>
          </div>
        </label>
      </div>

      <Button
        onClick={onComplete}
        disabled={!agreed || isSubmitting}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Activating...
          </>
        ) : (
          <>
            <CheckCircle className="h-4 w-4 mr-2" />
            Activate SMS Outreach
          </>
        )}
      </Button>

      <a
        href="https://docs.dealflow.ai/compliance/tcpa"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1 justify-center"
      >
        Read our full TCPA compliance guide
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
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
          SMS Outreach is Active!
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          You can now send SMS campaigns to your leads. Your credentials ensure deliverability,
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
export default function SmsVerifyPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending: authLoading } = useSession();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<SmsProvider>('platform');
  const [credentials, setCredentials] = useState<SmsCredentials>({});
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [verificationError, setVerificationError] = useState<string>();

  // Load existing status
  const { data: status, isLoading: statusLoading } = useQuery<VerificationStatus>({
    queryKey: ['outreach-status-sms'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/status');
      if (!res.ok) return null;
      const data = await res.json();
      return data.sms;
    },
    enabled: !!session,
  });

  // Initialize from existing status
  useEffect(() => {
    if (status) {
      if (status.isActive) {
        setStep(5); // Already active
      } else if (status.status === 'VERIFIED') {
        setStep(4); // Needs compliance
      } else if (status.status === 'VERIFYING') {
        setStep(3); // Waiting for code
        setPhoneNumber(status.metadata?.phoneNumber || '');
      }
    }
  }, [status]);

  // Start verification mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/outreach/verify/sms/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, credentials, phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['outreach-status-sms'] });

      if (data.status === 'ACTIVE') {
        // Platform provider - go to compliance or success
        if (provider === 'platform') {
          setStep(4);
        } else {
          setStep(5);
        }
      } else if (data.status === 'VERIFYING') {
        // BYOP - go to code entry
        setStep(3);
        toast.success('Verification code sent to your phone!');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Verify code mutation
  const verifyMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch('/api/outreach/verify/sms/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['outreach-status-sms'] });
      setVerificationError(undefined);

      if (data.status === 'VERIFIED') {
        setStep(4);
        toast.success('Phone number verified!');
      }
    },
    onError: (err: Error) => {
      setVerificationError(err.message);
    },
  });

  // Resend code mutation
  const resendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/outreach/verify/sms/resend', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: () => {
      toast.success('Verification code resent!');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Complete compliance mutation
  const complianceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/outreach/verify/sms/compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outreach-status-sms'] });
      queryClient.invalidateQueries({ queryKey: ['outreach-status'] });
      setStep(5);
      toast.success('SMS outreach activated!');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (provider === 'twilio') {
      if (!credentials.twilioAccountSid) newErrors.twilioAccountSid = 'Account SID is required';
      if (!credentials.twilioAuthToken) newErrors.twilioAuthToken = 'Auth Token is required';
      if (!phoneNumber) newErrors.phoneNumber = 'Phone number is required for verification';
      if (!credentials.twilioPhoneNumber && !credentials.twilioMessagingServiceSid) {
        newErrors.twilioPhoneNumber = 'Phone number or Messaging Service SID is required';
      }
    }

    if (provider === 'aws_sns') {
      if (!credentials.awsAccessKeyId) newErrors.awsAccessKeyId = 'Access Key ID is required';
      if (!credentials.awsSecretAccessKey) newErrors.awsSecretAccessKey = 'Secret Access Key is required';
      if (!phoneNumber) newErrors.phoneNumber = 'Phone number is required for verification';
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
    if (step > 1 && step < 5) {
      setStep(step - 1);
      setErrors({});
      setVerificationError(undefined);
    }
  };

  if (authLoading || statusLoading) {
    return <SmsVerifySkeleton />;
  }

  if (!session) {
    redirect('/account/signin');
  }

  const totalSteps = provider === 'platform' ? 3 : 4;
  const stepLabels = provider === 'platform'
    ? ['Provider', 'Configure', 'Compliance']
    : ['Provider', 'Credentials', 'Verify', 'Compliance'];

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
          <h1 className="text-xl font-bold text-[var(--text-primary)]">SMS Verification</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Set up and verify your SMS outreach credentials
          </p>
        </div>
      </header>

      {/* Progress Steps */}
      {step < 5 && (
        <div className="flex items-center justify-between px-2">
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
                <span className="text-xs text-[var(--text-muted)] mt-1 hidden sm:block">{label}</span>
              </div>
              {i < stepLabels.length - 1 && (
                <div
                  className={`w-10 sm:w-16 h-0.5 mx-1 sm:mx-2 ${
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
              setPhoneNumber('');
              setErrors({});
            }}
          />
        )}

        {step === 2 && (
          <CredentialsForm
            provider={provider}
            credentials={credentials}
            phoneNumber={phoneNumber}
            onChange={(updates) => setCredentials({ ...credentials, ...updates })}
            onPhoneChange={setPhoneNumber}
            errors={errors}
          />
        )}

        {step === 3 && (
          <VerificationCodeStep
            phoneNumber={phoneNumber}
            onVerify={(code) => verifyMutation.mutate(code)}
            onResend={() => resendMutation.mutate()}
            isVerifying={verifyMutation.isPending}
            isResending={resendMutation.isPending}
            error={verificationError}
          />
        )}

        {step === 4 && (
          <ComplianceStep
            onComplete={() => complianceMutation.mutate()}
            isSubmitting={complianceMutation.isPending}
          />
        )}

        {step === 5 && <SuccessStep />}
      </GlassCard>

      {/* Navigation */}
      {step < 5 && step !== 3 && step !== 4 && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} disabled={step === 1}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          <Button onClick={handleNext} disabled={startMutation.isPending}>
            {startMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {step === 2 ? 'Starting Verification...' : 'Processing...'}
              </>
            ) : step === 2 && provider !== 'platform' ? (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Verification Code
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
function SmsVerifySkeleton() {
  return (
    <div className="space-y-6 max-w-2xl animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 skeleton-dark rounded-lg" />
        <div>
          <div className="h-6 w-48 skeleton-dark rounded mb-2" />
          <div className="h-4 w-64 skeleton-dark rounded" />
        </div>
      </div>
      <div className="flex items-center justify-between px-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center">
            <div className="h-8 w-8 skeleton-dark rounded-full" />
            {i < 4 && <div className="w-16 h-0.5 skeleton-dark mx-2" />}
          </div>
        ))}
      </div>
      <div className="h-96 skeleton-dark rounded-xl" />
    </div>
  );
}
