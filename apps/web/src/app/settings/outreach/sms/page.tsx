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
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================
type SmsProvider = 'platform' | 'twilio' | 'sns';

interface SmsConfig {
  provider: SmsProvider;
  // Twilio
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  twilioMessagingServiceSid?: string;
  // AWS SNS
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsRegion?: string;
  // Compliance
  tcpaAgreed: boolean;
  tcpaAgreedAt?: string;
  // Status
  configured: boolean;
  phoneNumber?: string;
}

const PROVIDERS: { value: SmsProvider; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'platform',
    label: 'Platform SMS',
    description: 'Use our built-in SMS service. No setup required, pay per message.',
    icon: <Zap className="h-5 w-5" />,
  },
  {
    value: 'twilio',
    label: 'Twilio',
    description: 'Industry standard SMS with 10DLC support. Requires Twilio account.',
    icon: <MessageSquare className="h-5 w-5" />,
  },
  {
    value: 'sns',
    label: 'AWS SNS',
    description: 'Low cost at ~$0.015 per SMS. Requires AWS account with SNS enabled.',
    icon: <Cloud className="h-5 w-5" />,
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
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-0.5">{provider.description}</p>
              </div>
            </div>
          </button>
        ))}
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
              href="https://docs.dealflow.ai/sms/10dlc"
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

function ProviderConfigForm({
  provider,
  config,
  onChange,
  errors,
}: {
  provider: SmsProvider;
  config: Partial<SmsConfig>;
  onChange: (updates: Partial<SmsConfig>) => void;
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
              <p className="text-sm text-[var(--text-muted)] mt-1">Pay only for what you send</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-[var(--text-primary)]">$0.02</p>
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
                . You'll also need a phone number with SMS capabilities.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-sm text-[var(--text-secondary)]">Account SID</Label>
            <Input
              value={config.twilioAccountSid || ''}
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
                value={config.twilioAuthToken || ''}
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
          <Label className="text-sm text-[var(--text-secondary)]">Twilio Phone Number</Label>
          <Input
            value={config.twilioPhoneNumber || ''}
            onChange={(e) => onChange({ twilioPhoneNumber: e.target.value })}
            placeholder="+15551234567"
            className={`mt-1.5 bg-[var(--bg-primary)] ${errors.twilioPhoneNumber ? 'border-[var(--color-error)]' : ''}`}
          />
          {errors.twilioPhoneNumber && (
            <p className="text-xs text-[var(--color-error)] mt-1">{errors.twilioPhoneNumber}</p>
          )}
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Must be a 10DLC-registered number for best deliverability
          </p>
        </div>

        <div>
          <Label className="text-sm text-[var(--text-secondary)]">Messaging Service SID (Optional)</Label>
          <Input
            value={config.twilioMessagingServiceSid || ''}
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
              Create an IAM user with SNS SMS permissions. Make sure your AWS account is out of the
              SMS sandbox for production use.
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
    </div>
  );
}

function ComplianceStep({
  config,
  onChange,
  errors,
}: {
  config: Partial<SmsConfig>;
  onChange: (updates: Partial<SmsConfig>) => void;
  errors: Record<string, string>;
}) {
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

      <div className={`p-4 rounded-lg border ${
        errors.tcpaAgreed
          ? 'border-[var(--color-error)] bg-[var(--color-error)]/5'
          : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)]'
      }`}>
        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={config.tcpaAgreed || false}
            onCheckedChange={(checked) => onChange({ tcpaAgreed: checked === true })}
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
        {errors.tcpaAgreed && (
          <p className="text-xs text-[var(--color-error)] mt-2 ml-7">{errors.tcpaAgreed}</p>
        )}
      </div>

      <a
        href="https://docs.dealflow.ai/compliance/tcpa"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1"
      >
        Read our full TCPA compliance guide
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function TestSmsStep({
  config,
  provider,
  onTestSent,
}: {
  config: Partial<SmsConfig>;
  provider: SmsProvider;
  onTestSent: () => void;
}) {
  const [testPhone, setTestPhone] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const sendTestSms = async () => {
    setTestStatus('sending');
    setErrorMessage('');

    try {
      const res = await fetch('/api/settings/outreach/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testPhone, config: { ...config, provider } }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send test SMS');
      }

      setTestStatus('success');
      onTestSent();
      toast.success('Test SMS sent! Check your phone.');
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
          Test Your SMS Configuration
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Send a test message to verify everything is working correctly.
        </p>
      </div>

      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <MessageSquare className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">Configuration Summary</p>
            <div className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
              <p>Provider: <span className="text-[var(--text-primary)]">{
                provider === 'sns' ? 'AWS SNS' : provider === 'twilio' ? 'Twilio' : 'Platform SMS'
              }</span></p>
              {provider === 'twilio' && config.twilioPhoneNumber && (
                <p>From: <span className="text-[var(--text-primary)]">{config.twilioPhoneNumber}</span></p>
              )}
              <p>TCPA Compliance: <span className="text-[var(--color-success)]">Agreed</span></p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-sm text-[var(--text-secondary)]">Send Test SMS To</Label>
        <Input
          type="tel"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
          placeholder="+1 (555) 000-0000"
          className="mt-1.5 bg-[var(--bg-primary)]"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Enter your phone number to receive a test message
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
              <p className="text-sm font-medium text-[var(--color-success)]">Test SMS Sent!</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Check your phone at {testPhone}. It may take a few seconds to arrive.
              </p>
            </div>
          </div>
        </div>
      )}

      <Button
        onClick={sendTestSms}
        disabled={testStatus === 'sending' || !testPhone}
        className="w-full"
      >
        {testStatus === 'sending' ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Sending Test SMS...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Send Test SMS
          </>
        )}
      </Button>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================
export default function SmsSettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session, isPending: authLoading } = useSession();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<SmsProvider>('platform');
  const [config, setConfig] = useState<Partial<SmsConfig>>({ tcpaAgreed: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [_testPassed, setTestPassed] = useState(false);

  // Load existing config
  const { data: existingConfig, isLoading: configLoading } = useQuery<SmsConfig | null>({
    queryKey: ['sms-config'],
    queryFn: async () => {
      const res = await fetch('/api/settings/outreach');
      if (!res.ok) return null;
      const data = await res.json();
      return data.sms?.configured ? data.sms : null;
    },
    enabled: !!session,
  });

  // Initialize form with existing config
  useEffect(() => {
    if (existingConfig) {
      setProvider(existingConfig.provider);
      setConfig(existingConfig);
      if (existingConfig.configured && existingConfig.tcpaAgreed) {
        setStep(4);
        setTestPassed(true);
      } else if (existingConfig.tcpaAgreed) {
        setStep(3);
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
          sms: {
            ...config,
            provider,
            configured: true,
            tcpaAgreedAt: config.tcpaAgreed ? new Date().toISOString() : undefined,
            phoneNumber: provider === 'twilio' ? config.twilioPhoneNumber : undefined,
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
      queryClient.invalidateQueries({ queryKey: ['sms-config'] });
      toast.success('SMS configuration saved!');
      router.push('/settings/outreach');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (provider === 'twilio') {
      if (!config.twilioAccountSid) newErrors.twilioAccountSid = 'Account SID is required';
      if (!config.twilioAuthToken) newErrors.twilioAuthToken = 'Auth Token is required';
      if (!config.twilioPhoneNumber) newErrors.twilioPhoneNumber = 'Phone number is required';
    }

    if (provider === 'sns') {
      if (!config.awsAccessKeyId) newErrors.awsAccessKeyId = 'Access Key ID is required';
      if (!config.awsSecretAccessKey) newErrors.awsSecretAccessKey = 'Secret Access Key is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!config.tcpaAgreed) {
      newErrors.tcpaAgreed = 'You must agree to TCPA compliance to send SMS messages';
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
    } else if (step === 3) {
      if (validateStep3()) {
        setStep(4);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setErrors({});
    }
  };

  if (authLoading || configLoading) {
    return <SmsSettingsSkeleton />;
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
          <h1 className="text-xl font-bold text-[var(--text-primary)]">SMS Configuration</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Set up how DealFlow AI sends text messages
          </p>
        </div>
      </header>

      {/* Progress Steps */}
      <div className="flex items-center justify-between px-2">
        {[
          { num: 1, label: 'Provider' },
          { num: 2, label: 'Settings' },
          { num: 3, label: 'Compliance' },
          { num: 4, label: 'Test' },
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
              <span className="text-xs text-[var(--text-muted)] mt-1 hidden sm:block">{s.label}</span>
            </div>
            {i < 3 && (
              <div
                className={`w-10 sm:w-16 h-0.5 mx-1 sm:mx-2 ${
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
              setConfig({ tcpaAgreed: config.tcpaAgreed });
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
          <ComplianceStep
            config={config}
            onChange={(updates) => setConfig({ ...config, ...updates })}
            errors={errors}
          />
        )}

        {step === 4 && (
          <TestSmsStep
            config={config}
            provider={provider}
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
          {step === 4 && (
            <Button variant="outline" onClick={() => router.push('/settings/outreach')}>
              Skip Test
            </Button>
          )}
          {step < 4 ? (
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
function SmsSettingsSkeleton() {
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
