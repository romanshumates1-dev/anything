'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  TestTube,
  Trash2,
  Info,
  User,
  Bell,
  Activity,
  Settings2,
  ArrowRight,
  Shield,
  Mail,
  Phone,
  Check,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Globe,
  Clock,
  Undo2,
  Eye,
  EyeOff,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import EventLogPanel from '@/components/EventLogPanel';

// ============================================================================
// Types
// ============================================================================
interface TestPhone {
  id: string;
  phone: string;
  verified: boolean;
}

interface NotificationPrefs {
  emailCampaignUpdates: boolean;
  emailLeadResponses: boolean;
  emailWeeklyDigest: boolean;
  smsHighPriorityLeads: boolean;
  smsUrgentResponses: boolean;
}

interface UserPreferences {
  timezone: string;
  language: string;
  notifications: NotificationPrefs;
}

// ============================================================================
// Helper hooks
// ============================================================================
function useIsAdmin(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-check'],
    queryFn: async () => {
      const res = await fetch('/api/settings/beta-flags');
      return res.ok;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

// Debounce hook for inline validation
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// ============================================================================
// Timezones list (common ones)
// ============================================================================
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
];

// ============================================================================
// Main Settings Page
// ============================================================================
export default function SettingsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin(!!session);

  // Test phones
  const { data: testPhones, isLoading: phonesLoading, refetch: refetchPhones } = useQuery<TestPhone[]>({
    queryKey: ['test-phones'],
    queryFn: async () => {
      const res = await fetch('/api/test-phones');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  const addPhoneMutation = useMutation({
    mutationFn: async (phone: string) => {
      const res = await fetch('/api/test-phones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to add phone');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-phones'] });
      toast.success('Verification code sent! Check your phone.');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const verifyPhoneMutation = useMutation({
    mutationFn: async ({ phoneId, code }: { phoneId: string; code: string }) => {
      const res = await fetch(`/api/test-phones/${phoneId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Verification failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-phones'] });
      toast.success('Phone number verified successfully!');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deletePhoneMutation = useMutation({
    mutationFn: async (phoneId: string) => {
      const res = await fetch(`/api/test-phones/${phoneId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to remove phone');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-phones'] });
      toast.success('Phone number removed');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (authLoading) {
    return <SettingsPageSkeleton />;
  }

  if (!session) {
    redirect('/account/signin');
  }

  return (
    <div className="space-y-10 max-w-4xl pb-12">
      {/* Page Header */}
      <header className="border-b border-[var(--border-subtle)] pb-6">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 border border-[var(--border-subtle)]">
            <Settings2 className="h-7 w-7 text-[var(--accent-blue)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Settings
            </h1>
            <p className="text-[var(--text-secondary)] mt-0.5">
              Manage your account, preferences, and test configurations
            </p>
          </div>
        </div>
      </header>

      {/* Admin Link Banner */}
      {isAdmin && (
        <Link
          href="/admin"
          className="flex items-center justify-between p-5 rounded-xl bg-gradient-to-r from-[var(--accent-purple)]/5 to-[var(--accent-blue)]/5 border border-[var(--accent-purple)]/20 hover:border-[var(--accent-purple)]/40 transition-all group"
        >
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-lg bg-[var(--accent-purple)]/10 group-hover:bg-[var(--accent-purple)]/20 transition-colors">
              <Shield className="h-5 w-5 text-[var(--accent-purple)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Admin Panel
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                API keys, AI provider, beta flags, and user management
              </p>
            </div>
          </div>
          <ArrowRight className="h-5 w-5 text-[var(--text-muted)] group-hover:text-[var(--accent-purple)] group-hover:translate-x-1 transition-all" />
        </Link>
      )}

      {/* Profile Section */}
      <ProfileSection session={session} isAdmin={isAdmin} />

      {/* Account Section */}
      <AccountSection session={session} />

      {/* Preferences Section */}
      <PreferencesSection />

      {/* Notification Settings */}
      <NotificationSection />

      {/* Test Phone Numbers Section */}
      <TestPhoneSection
        testPhones={testPhones}
        phonesLoading={phonesLoading}
        onAddPhone={addPhoneMutation.mutate}
        onVerifyPhone={verifyPhoneMutation.mutate}
        onDeletePhone={deletePhoneMutation.mutate}
        addPending={addPhoneMutation.isPending}
        verifyPending={verifyPhoneMutation.isPending}
        deletePending={deletePhoneMutation.isPending}
      />

      {/* Activity Log Section */}
      <section>
        <SectionHeader icon={Activity} title="Activity Log" />
        <p className="text-sm text-[var(--text-muted)] mb-4">
          View recent system events and debug your campaign activity in real-time.
        </p>
        <EventLogPanel />
      </section>
    </div>
  );
}

// ============================================================================
// Section Header Component
// ============================================================================
function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
          <Icon className="h-5 w-5 text-[var(--text-secondary)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          {description && (
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{description}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

// ============================================================================
// Profile Section
// ============================================================================
function ProfileSection({
  session,
  isAdmin,
}: {
  session: { user: { name?: string | null; email?: string | null; image?: string | null } };
  isAdmin?: boolean;
}) {
  const initials =
    session.user.name?.[0]?.toUpperCase() ||
    session.user.email?.[0]?.toUpperCase() ||
    '?';

  return (
    <section>
      <SectionHeader icon={User} title="Profile" />
      <GlassCard variant="bordered" padding="lg">
        <div className="flex items-start gap-5">
          <div className="relative">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              {initials}
            </div>
            {isAdmin && (
              <div className="absolute -bottom-1 -right-1 p-1.5 rounded-lg bg-[var(--accent-purple)] shadow-md">
                <Shield className="h-3.5 w-3.5 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-xl font-semibold text-[var(--text-primary)] truncate">
                {session.user.name || 'User'}
              </h3>
              {isAdmin && (
                <Badge className="bg-[var(--accent-purple)]/10 text-[var(--accent-purple)] border border-[var(--accent-purple)]/20">
                  Admin
                </Badge>
              )}
            </div>
            <p className="text-sm text-[var(--text-secondary)] truncate">{session.user.email}</p>
            <div className="flex items-center gap-2 mt-3">
              <Badge variant="outline" className="text-xs text-[var(--text-muted)]">
                <Sparkles className="h-3 w-3 mr-1" />
                Member since 2024
              </Badge>
            </div>
          </div>
        </div>
      </GlassCard>
    </section>
  );
}

// ============================================================================
// Account Section
// ============================================================================
function AccountSection({
  session,
}: {
  session: { user: { email?: string | null } };
}) {
  const [showChangeEmail, setShowChangeEmail] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <section>
      <SectionHeader icon={Shield} title="Account" description="Manage your account security and settings" />
      <GlassCard variant="bordered" padding="none">
        {/* Email */}
        <div className="p-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <Mail className="h-4 w-4 text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Email Address</p>
                <p className="text-xs text-[var(--text-muted)]">{session.user.email}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowChangeEmail(!showChangeEmail)}
            >
              Change
            </Button>
          </div>
          {showChangeEmail && (
            <ChangeEmailForm
              currentEmail={session.user.email || ''}
              onClose={() => setShowChangeEmail(false)}
            />
          )}
        </div>

        {/* Password */}
        <div className="p-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                <Eye className="h-4 w-4 text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Password</p>
                <p className="text-xs text-[var(--text-muted)]">Last changed 30 days ago</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowChangePassword(!showChangePassword)}
            >
              Change
            </Button>
          </div>
          {showChangePassword && (
            <ChangePasswordForm onClose={() => setShowChangePassword(false)} />
          )}
        </div>

        {/* Delete Account */}
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--color-error)]/10">
                <Trash2 className="h-4 w-4 text-[var(--color-error)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Delete Account</p>
                <p className="text-xs text-[var(--text-muted)]">Permanently delete your account and all data</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
              onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
            >
              Delete
            </Button>
          </div>
          {showDeleteConfirm && (
            <DeleteAccountConfirm onClose={() => setShowDeleteConfirm(false)} />
          )}
        </div>
      </GlassCard>
    </section>
  );
}

function ChangeEmailForm({ currentEmail, onClose }: { currentEmail: string; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const debouncedEmail = useDebounce(email, 300);
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debouncedEmail);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail || !password) return;
    setLoading(true);
    setError('');
    try {
      // API call would go here
      await new Promise((r) => setTimeout(r, 1000));
      toast.success('Verification email sent to your new address');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 p-4 rounded-lg bg-[var(--bg-tertiary)] space-y-3">
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">New Email Address</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="new@example.com"
          className={`mt-1.5 bg-[var(--bg-primary)] ${
            email && !isValidEmail ? 'border-[var(--color-error)]' : ''
          }`}
        />
        {email && !isValidEmail && (
          <p className="text-xs text-[var(--color-error)] mt-1">Please enter a valid email</p>
        )}
      </div>
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">Current Password</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password to confirm"
          className="mt-1.5 bg-[var(--bg-primary)]"
        />
      </div>
      {error && (
        <p className="text-xs text-[var(--color-error)] flex items-center gap-1">
          <XCircle className="h-3 w-3" /> {error}
        </p>
      )}
      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={loading || !isValidEmail || !password} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Send Verification
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ChangePasswordForm({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordsMatch = newPassword === confirmPassword;
  const isStrongPassword = newPassword.length >= 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsMatch || !isStrongPassword || !currentPassword) return;
    setLoading(true);
    setError('');
    try {
      // API call would go here
      await new Promise((r) => setTimeout(r, 1000));
      toast.success('Password updated successfully');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 p-4 rounded-lg bg-[var(--bg-tertiary)] space-y-3">
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">Current Password</Label>
        <div className="relative mt-1.5">
          <Input
            type={showPasswords ? 'text' : 'password'}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="bg-[var(--bg-primary)] pr-10"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            onClick={() => setShowPasswords(!showPasswords)}
          >
            {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">New Password</Label>
        <Input
          type={showPasswords ? 'text' : 'password'}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
          className={`mt-1.5 bg-[var(--bg-primary)] ${
            newPassword && !isStrongPassword ? 'border-[var(--color-warning)]' : ''
          }`}
        />
        {newPassword && !isStrongPassword && (
          <p className="text-xs text-[var(--color-warning)] mt-1">Password must be at least 8 characters</p>
        )}
      </div>
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">Confirm New Password</Label>
        <Input
          type={showPasswords ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          className={`mt-1.5 bg-[var(--bg-primary)] ${
            confirmPassword && !passwordsMatch ? 'border-[var(--color-error)]' : ''
          }`}
        />
        {confirmPassword && !passwordsMatch && (
          <p className="text-xs text-[var(--color-error)] mt-1">Passwords do not match</p>
        )}
      </div>
      {error && (
        <p className="text-xs text-[var(--color-error)] flex items-center gap-1">
          <XCircle className="h-3 w-3" /> {error}
        </p>
      )}
      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={loading || !passwordsMatch || !isStrongPassword || !currentPassword} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Update Password
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteAccountConfirm({ onClose }: { onClose: () => void }) {
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [undoAvailable, setUndoAvailable] = useState(false);

  const isConfirmed = confirmText === 'DELETE';

  const handleDelete = async () => {
    if (!isConfirmed) return;
    setLoading(true);
    try {
      // Show undo option before actual deletion
      setUndoAvailable(true);
      toast.info(
        <div className="flex items-center gap-3">
          <span>Account deletion scheduled</span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setUndoAvailable(false);
              setLoading(false);
              toast.success('Account deletion cancelled');
            }}
          >
            <Undo2 className="h-3 w-3 mr-1" /> Undo
          </Button>
        </div>,
        { duration: 10000 }
      );
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete account');
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 p-4 rounded-lg bg-[var(--color-error)]/5 border border-[var(--color-error)]/20 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-[var(--color-error)] mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">This action cannot be undone</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            This will permanently delete your account and all associated data including campaigns, leads, and conversations.
          </p>
        </div>
      </div>
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">Type DELETE to confirm</Label>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
          placeholder="DELETE"
          className="mt-1.5 bg-[var(--bg-primary)]"
        />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={!isConfirmed || loading}
          onClick={handleDelete}
          className="bg-[var(--color-error)] hover:bg-[var(--color-error)]/90"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
          Delete Account
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Preferences Section
// ============================================================================
function PreferencesSection() {
  const [timezone, setTimezone] = useState('America/New_York');
  const [language, setLanguage] = useState('en');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      // API call would go here
      await new Promise((r) => setTimeout(r, 500));
      setSaved(true);
      toast.success('Preferences saved');
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <SectionHeader icon={Globe} title="Preferences" description="Customize your experience" />
      <GlassCard variant="bordered" padding="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Timezone */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
              <Clock className="h-4 w-4 text-[var(--text-muted)]" />
              Timezone
            </Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="w-full bg-[var(--bg-primary)] border-[var(--border-subtle)]">
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--text-muted)]">
              Used for campaign scheduling and activity timestamps
            </p>
          </div>

          {/* Language */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
              <Globe className="h-4 w-4 text-[var(--text-muted)]" />
              Language
            </Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-full bg-[var(--bg-primary)] border-[var(--border-subtle)]">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--text-muted)]">
              Display language for the interface
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[var(--border-subtle)]">
          <Button variant="outline" size="sm" disabled={saving}>
            Reset to Defaults
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : null}
            {saved ? 'Saved!' : 'Save Preferences'}
          </Button>
        </div>
      </GlassCard>
    </section>
  );
}

// ============================================================================
// Notification Section
// ============================================================================
function NotificationSection() {
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    emailCampaignUpdates: true,
    emailLeadResponses: true,
    emailWeeklyDigest: false,
    smsHighPriorityLeads: true,
    smsUrgentResponses: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const togglePref = (key: keyof NotificationPrefs) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await new Promise((r) => setTimeout(r, 500));
      setSaved(true);
      toast.success('Notification settings saved');
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <SectionHeader icon={Bell} title="Notifications" description="Choose how you want to be notified" />
      <GlassCard variant="bordered" padding="none">
        {/* Email Notifications */}
        <div className="p-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="h-4 w-4 text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email Notifications</h3>
          </div>
          <div className="space-y-4">
            <NotificationToggle
              label="Campaign Updates"
              description="Get notified when campaigns start, pause, or complete"
              checked={prefs.emailCampaignUpdates}
              onChange={() => togglePref('emailCampaignUpdates')}
            />
            <NotificationToggle
              label="Lead Responses"
              description="Receive email alerts when leads reply to messages"
              checked={prefs.emailLeadResponses}
              onChange={() => togglePref('emailLeadResponses')}
            />
            <NotificationToggle
              label="Weekly Digest"
              description="Summary of your campaign performance every Monday"
              checked={prefs.emailWeeklyDigest}
              onChange={() => togglePref('emailWeeklyDigest')}
            />
          </div>
        </div>

        {/* SMS Notifications */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Phone className="h-4 w-4 text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">SMS Notifications</h3>
          </div>
          <div className="space-y-4">
            <NotificationToggle
              label="High-Priority Leads"
              description="Text alerts for hot leads requiring immediate attention"
              checked={prefs.smsHighPriorityLeads}
              onChange={() => togglePref('smsHighPriorityLeads')}
            />
            <NotificationToggle
              label="Urgent Responses"
              description="Get text alerts for time-sensitive lead replies"
              checked={prefs.smsUrgentResponses}
              onChange={() => togglePref('smsUrgentResponses')}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="px-5 py-4 bg-[var(--bg-tertiary)] border-t border-[var(--border-subtle)] flex items-center justify-between">
          <p className="text-xs text-[var(--text-muted)]">
            SMS notifications require a verified phone number
          </p>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2" />
            ) : null}
            {saved ? 'Saved!' : 'Save Changes'}
          </Button>
        </div>
      </GlassCard>
    </section>
  );
}

function NotificationToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)]">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// ============================================================================
// Test Phone Section
// ============================================================================
function TestPhoneSection({
  testPhones,
  phonesLoading,
  onAddPhone,
  onVerifyPhone,
  onDeletePhone,
  addPending,
  verifyPending,
  deletePending,
}: {
  testPhones?: TestPhone[];
  phonesLoading: boolean;
  onAddPhone: (phone: string) => void;
  onVerifyPhone: (arg0: { phoneId: string; code: string }) => void;
  onDeletePhone: (phoneId: string) => void;
  addPending: boolean;
  verifyPending: boolean;
  deletePending: boolean;
}) {
  const verifiedCount = testPhones?.filter((p) => p.verified).length || 0;
  const pendingCount = testPhones?.filter((p) => !p.verified).length || 0;

  return (
    <section>
      <SectionHeader
        icon={TestTube}
        title="Test Phone Numbers"
        description="Verify personal numbers to receive test messages"
        action={
          testPhones && testPhones.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              {verifiedCount > 0 && (
                <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20">
                  {verifiedCount} verified
                </Badge>
              )}
              {pendingCount > 0 && (
                <Badge className="bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/20">
                  {pendingCount} pending
                </Badge>
              )}
            </div>
          )
        }
      />
      <GlassCard variant="bordered" padding="lg">
        {/* Info Banner */}
        <div className="p-4 rounded-lg bg-gradient-to-r from-[var(--accent-blue)]/5 to-[var(--accent-purple)]/5 border border-[var(--border-subtle)] mb-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
              <Info className="h-4 w-4 text-[var(--accent-blue)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Personal Test Mode</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                Add your phone number to receive test messages when previewing campaigns.
                You will receive a 6-digit verification code via SMS.
              </p>
            </div>
          </div>
        </div>

        {/* Add Phone Form */}
        <AddPhoneForm onSubmit={onAddPhone} loading={addPending} />

        {/* Phone List */}
        <div className="mt-5">
          {phonesLoading ? (
            <div className="py-8 flex flex-col items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
              <p className="text-sm text-[var(--text-muted)]">Loading phone numbers...</p>
            </div>
          ) : !testPhones || testPhones.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-[var(--border-subtle)] rounded-lg bg-[var(--bg-primary)]/50">
              <div className="p-3 rounded-full bg-[var(--bg-tertiary)] w-fit mx-auto mb-3">
                <Phone className="h-6 w-6 text-[var(--text-muted)]" />
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)]">No test numbers configured</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs mx-auto">
                Add a phone number above to start receiving test messages from your campaigns
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Your Test Numbers
              </p>
              {testPhones.map((phone, index) => (
                <div
                  key={phone.id}
                  className="flex items-center justify-between bg-[var(--bg-tertiary)] rounded-xl p-4 border border-[var(--border-subtle)] animate-fade-in-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-lg ${
                      phone.verified
                        ? 'bg-[var(--color-success)]/10'
                        : 'bg-[var(--color-warning)]/10'
                    }`}>
                      {phone.verified ? (
                        <CheckCircle className="h-5 w-5 text-[var(--color-success)]" />
                      ) : (
                        <Clock className="h-5 w-5 text-[var(--color-warning)]" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-mono font-semibold text-[var(--text-primary)]">
                        {phone.phone}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {phone.verified ? (
                          <span className="text-xs text-[var(--color-success)] flex items-center gap-1">
                            <Check className="h-3 w-3" /> Verified and ready
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-warning)]">
                            Enter verification code
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!phone.verified ? (
                      <VerifyPhoneForm
                        phone={phone}
                        onVerify={onVerifyPhone}
                        loading={verifyPending}
                      />
                    ) : (
                      <DeletePhoneButton
                        phoneId={phone.id}
                        onDelete={onDeletePhone}
                        loading={deletePending}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>
    </section>
  );
}

function AddPhoneForm({ onSubmit, loading }: { onSubmit: (phone: string) => void; loading: boolean }) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  // Simple phone validation
  const isValidPhone = phone.replace(/\D/g, '').length >= 10;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    if (!isValidPhone) {
      setError('Please enter a valid phone number');
      return;
    }
    setError('');
    try {
      await onSubmit(phone.trim());
      setPhone('');
    } catch (err) {
      // Error handled by mutation
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <div className="flex-1 relative">
        <Input
          placeholder="+1 (555) 000-0000"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setError('');
          }}
          className={`bg-[var(--bg-primary)] pr-10 ${error ? 'border-[var(--color-error)]' : ''}`}
        />
        {phone && isValidPhone && (
          <Check className="h-4 w-4 text-[var(--color-success)] absolute right-3 top-1/2 -translate-y-1/2" />
        )}
      </div>
      <Button type="submit" disabled={loading || !phone.trim()} className="min-w-[120px]">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Sending...
          </>
        ) : (
          <>
            <Phone className="h-4 w-4 mr-2" />
            Add Number
          </>
        )}
      </Button>
    </form>
  );
}

function VerifyPhoneForm({
  phone,
  onVerify,
  loading,
}: {
  phone: { id: string };
  onVerify: (arg0: { phoneId: string; code: string }) => void;
  loading: boolean;
}) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || code.length !== 6) return;
    try {
      await onVerify({ phoneId: phone.id, code: code.trim() });
      setCode('');
    } catch (err) {
      // Error handled by mutation
    }
  };

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !loading) {
      onVerify({ phoneId: phone.id, code: code.trim() });
    }
  }, [code, loading, onVerify, phone.id]);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        ref={inputRef}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="w-24 text-center font-mono tracking-widest bg-[var(--bg-primary)]"
        maxLength={6}
      />
      <Button size="sm" type="submit" disabled={loading || code.length !== 6}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Check className="h-4 w-4 mr-1" />
            Verify
          </>
        )}
      </Button>
    </form>
  );
}

function DeletePhoneButton({
  phoneId,
  onDelete,
  loading,
}: {
  phoneId: string;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  const [showUndo, setShowUndo] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDelete = () => {
    setShowUndo(true);
    timeoutRef.current = setTimeout(() => {
      onDelete(phoneId);
      setShowUndo(false);
    }, 3000);
  };

  const handleUndo = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowUndo(false);
    toast.success('Deletion cancelled');
  };

  if (showUndo) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={handleUndo}
        className="gap-1 border-[var(--color-warning)] text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
      >
        <Undo2 className="h-4 w-4" />
        Undo
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleDelete}
      disabled={loading}
      className="text-[var(--text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </Button>
  );
}

// ============================================================================
// Skeleton Loading State
// ============================================================================
function SettingsPageSkeleton() {
  return (
    <div className="space-y-10 max-w-4xl animate-pulse">
      {/* Header */}
      <div className="border-b border-[var(--border-subtle)] pb-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl skeleton-dark" />
          <div>
            <div className="h-7 w-32 skeleton-dark rounded mb-2" />
            <div className="h-4 w-64 skeleton-dark rounded" />
          </div>
        </div>
      </div>

      {/* Profile skeleton */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-9 w-9 skeleton-dark rounded-lg" />
          <div className="h-6 w-24 skeleton-dark rounded" />
        </div>
        <div className="glass-card p-6">
          <div className="flex items-start gap-5">
            <div className="h-20 w-20 skeleton-dark rounded-2xl" />
            <div className="flex-1">
              <div className="h-6 w-40 skeleton-dark rounded mb-2" />
              <div className="h-4 w-56 skeleton-dark rounded mb-3" />
              <div className="h-5 w-32 skeleton-dark rounded" />
            </div>
          </div>
        </div>
      </div>

      {/* Account skeleton */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="h-9 w-9 skeleton-dark rounded-lg" />
          <div className="h-6 w-28 skeleton-dark rounded" />
        </div>
        <div className="glass-card p-0">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 border-b border-[var(--border-subtle)] last:border-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 skeleton-dark rounded-lg" />
                  <div>
                    <div className="h-4 w-28 skeleton-dark rounded mb-1.5" />
                    <div className="h-3 w-40 skeleton-dark rounded" />
                  </div>
                </div>
                <div className="h-8 w-16 skeleton-dark rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
