'use client';

import { useState, useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  User,
  Mail,
  Phone,
  Globe,
  CreditCard,
  Zap,
  Shield,
  Key,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  Sparkles,
  Crown,
  Calendar,
  ArrowUpRight,
  Edit3,
  ChevronRight,
  Lock,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Constants
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
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
];

const TIER_CONFIG: Record<string, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ElementType;
  features: string[];
  monthlyCredits: number;
}> = {
  free: {
    label: 'Free',
    color: 'text-[var(--text-muted)]',
    bgColor: 'bg-[var(--bg-tertiary)]',
    borderColor: 'border-[var(--border-subtle)]',
    icon: User,
    features: ['100 contacts', '500 messages/mo', 'Basic analytics'],
    monthlyCredits: 100,
  },
  starter: {
    label: 'Starter',
    color: 'text-[var(--accent-blue)]',
    bgColor: 'bg-[var(--accent-blue)]/10',
    borderColor: 'border-[var(--accent-blue)]/30',
    icon: Zap,
    features: ['1,000 contacts', '5,000 messages/mo', 'Advanced analytics', 'Email support'],
    monthlyCredits: 1000,
  },
  pro: {
    label: 'Pro',
    color: 'text-[var(--accent-purple)]',
    bgColor: 'bg-[var(--accent-purple)]/10',
    borderColor: 'border-[var(--accent-purple)]/30',
    icon: Crown,
    features: ['10,000 contacts', '50,000 messages/mo', 'AI features', 'Priority support'],
    monthlyCredits: 5000,
  },
  enterprise: {
    label: 'Enterprise',
    color: 'text-[var(--color-success)]',
    bgColor: 'bg-[var(--color-success)]/10',
    borderColor: 'border-[var(--color-success)]/30',
    icon: Sparkles,
    features: ['Unlimited contacts', 'Unlimited messages', 'Custom integrations', 'Dedicated support'],
    monthlyCredits: -1, // Unlimited
  },
};

// ============================================================================
// Types
// ============================================================================
interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
  credits_balance: number;
  subscription_tier: string;
}

interface SubscriptionData {
  tier: string;
  active: boolean;
  credits_balance: number;
  credits_used_this_month: number;
  credits_limit: number;
  next_billing_date: string | null;
}

// ============================================================================
// Password Strength Indicator
// ============================================================================
function PasswordStrengthIndicator({ password }: { password: string }) {
  const getStrength = (pwd: string): { score: number; label: string } => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    return { score, label: labels[Math.max(0, score - 1)] || 'Too short' };
  };

  const { score, label } = getStrength(password);
  const colors = [
    'bg-[var(--color-error)]',
    'bg-[var(--color-warning)]',
    'bg-yellow-500',
    'bg-[var(--accent-blue)]',
    'bg-[var(--color-success)]',
  ];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              i < score ? colors[score - 1] : 'bg-[var(--bg-tertiary)]'
            }`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${
          score <= 2 ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'
        }`}>
          {label}
        </span>
        {score < 3 && (
          <span className="text-xs text-[var(--text-muted)]">
            Add {!(/[A-Z]/.test(password)) ? 'uppercase, ' : ''}{!(/[0-9]/.test(password)) ? 'numbers, ' : ''}{!(/[^A-Za-z0-9]/.test(password)) ? 'symbols' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Loading Skeleton
// ============================================================================
function ProfilePageSkeleton() {
  return (
    <div className="space-y-6 max-w-4xl animate-pulse">
      {/* Hero Skeleton */}
      <div className="glass-card p-8 relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="w-28 h-28 rounded-2xl bg-[var(--bg-tertiary)]" />
          <div className="flex-1 space-y-3">
            <div className="h-8 w-48 bg-[var(--bg-tertiary)] rounded-lg" />
            <div className="h-5 w-64 bg-[var(--bg-tertiary)] rounded-lg" />
            <div className="flex gap-4">
              <div className="h-4 w-32 bg-[var(--bg-tertiary)] rounded" />
              <div className="h-4 w-24 bg-[var(--bg-tertiary)] rounded" />
            </div>
          </div>
          <div className="h-10 w-28 bg-[var(--bg-tertiary)] rounded-lg" />
        </div>
      </div>

      {/* Cards Skeleton */}
      <div className="grid md:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="glass-card p-6">
            <div className="h-6 w-32 bg-[var(--bg-tertiary)] rounded mb-4" />
            <div className="space-y-3">
              <div className="h-4 w-full bg-[var(--bg-tertiary)] rounded" />
              <div className="h-4 w-3/4 bg-[var(--bg-tertiary)] rounded" />
              <div className="h-4 w-1/2 bg-[var(--bg-tertiary)] rounded" />
            </div>
            <div className="h-10 w-full bg-[var(--bg-tertiary)] rounded-lg mt-6" />
          </div>
        ))}
      </div>

      {/* Settings Skeleton */}
      <div className="glass-card p-6">
        <div className="h-6 w-40 bg-[var(--bg-tertiary)] rounded mb-6" />
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-24 bg-[var(--bg-tertiary)] rounded" />
              <div className="h-10 w-full bg-[var(--bg-tertiary)] rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      {/* Security Skeleton */}
      <div className="glass-card p-6">
        <div className="h-6 w-24 bg-[var(--bg-tertiary)] rounded mb-6" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-32 bg-[var(--bg-tertiary)] rounded" />
              <div className="h-10 w-full bg-[var(--bg-tertiary)] rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Profile Page
// ============================================================================
export default function ProfilePage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  // Profile form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');
  const [isProfileInitialized, setIsProfileInitialized] = useState(false);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Profile validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch user profile
  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery<UserProfile>({
    queryKey: ['user-profile'],
    queryFn: async () => {
      const res = await fetch('/api/user/profile');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to fetch profile');
      }
      return res.json();
    },
    enabled: !!session,
    retry: 2,
  });

  // Initialize form with fetched data
  useEffect(() => {
    if (profile && !isProfileInitialized) {
      setName(profile.name || '');
      setPhone(profile.phone || '');
      setTimezone(profile.timezone || 'America/New_York');
      setIsProfileInitialized(true);
    }
  }, [profile, isProfileInitialized]);

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: { name: string; phone: string; timezone: string }) => {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update profile');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      toast.success('Profile updated successfully');
      setErrors({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Change password mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to change password');
      }
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Form validation
  const validateProfileForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Display name is required';
    } else if (name.length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    }

    if (phone && !/^[\d\s\-+()]{10,}$/.test(phone.replace(/\s/g, ''))) {
      newErrors.phone = 'Please enter a valid phone number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveProfile = () => {
    if (!validateProfileForm()) return;
    updateProfileMutation.mutate({ name: name.trim(), phone: phone.trim(), timezone });
  };

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  // Loading state
  if (authLoading || (!!session && profileLoading)) {
    return <ProfilePageSkeleton />;
  }

  // Auth redirect
  if (!session) {
    redirect('/account/signin');
  }

  // Get profile data with fallbacks
  const tier = (profile?.subscription_tier || 'free').toLowerCase();
  const tierConfig = TIER_CONFIG[tier] || TIER_CONFIG.free;
  const TierIcon = tierConfig.icon;
  const userRole = (session.user as { role?: string })?.role || 'MEMBER';
  const isAdmin = userRole === 'ADMIN';
  const memberSince = profile?.created_at ? new Date(profile.created_at) : new Date();
  const creditsBalance = profile?.credits_balance || 0;
  const creditsUsed = Math.max(0, (tierConfig.monthlyCredits === -1 ? 1000 : tierConfig.monthlyCredits) - creditsBalance);
  const creditsLimit = tierConfig.monthlyCredits === -1 ? 10000 : tierConfig.monthlyCredits;
  const creditsPercentage = Math.min(100, (creditsUsed / creditsLimit) * 100);
  const userInitials = (profile?.name?.[0] || session.user?.email?.[0] || 'U').toUpperCase();

  return (
    <div className="space-y-8 max-w-4xl pb-12">
      {/* Hero Section */}
      <GlassCard variant="elevated" className="relative overflow-hidden">
        {/* Background Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-blue)]/10 via-transparent to-[var(--accent-purple)]/10" />
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-radial from-[var(--accent-blue)]/5 to-transparent rounded-full blur-3xl" />

        <div className="relative flex flex-col md:flex-row md:items-center gap-6 p-2">
          {/* Avatar */}
          <div className="relative group">
            <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center shadow-xl ring-4 ring-[var(--bg-secondary)] transition-transform group-hover:scale-105">
              <span className="text-white text-4xl font-bold tracking-tight">
                {userInitials}
              </span>
            </div>
            {/* Status Badge */}
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[var(--color-success)] border-4 border-[var(--bg-secondary)] flex items-center justify-center shadow-md">
              <Check className="h-4 w-4 text-white" strokeWidth={3} />
            </div>
            {/* Edit Overlay */}
            <div className="absolute inset-0 rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
              <Edit3 className="h-6 w-6 text-white" />
            </div>
          </div>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h1 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] tracking-tight truncate">
                {profile?.name || session.user?.name || session.user?.email?.split('@')[0]}
              </h1>
              <Badge className={`${isAdmin ? 'bg-[var(--accent-purple)]/20 text-[var(--accent-purple)] border-[var(--accent-purple)]/30' : 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border-[var(--accent-blue)]/30'} border font-medium px-2.5 py-0.5`}>
                <Shield className="h-3 w-3 mr-1" />
                {userRole}
              </Badge>
            </div>
            <p className="text-[var(--text-secondary)] mb-4 flex items-center gap-2">
              <Mail className="h-4 w-4" />
              {session.user?.email}
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--text-muted)]">
              <div className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span>Member since {memberSince.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
                <span>Account verified</span>
              </div>
            </div>
          </div>

          {/* Edit Button */}
          <Button variant="outline" className="md:self-start gap-2 border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)]">
            <Edit3 className="h-4 w-4" />
            Edit Profile
          </Button>
        </div>
      </GlassCard>

      {/* Subscription & Credits Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Subscription Card */}
        <GlassCard variant="bordered">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Subscription</h2>
            <Badge className={`${tierConfig.bgColor} ${tierConfig.color} ${tierConfig.borderColor} border font-semibold px-3 py-1`}>
              <TierIcon className="h-3.5 w-3.5 mr-1.5" />
              {tierConfig.label}
            </Badge>
          </div>

          <div className="space-y-3 mb-6">
            {tierConfig.features.map((feature, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <div className="w-5 h-5 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center flex-shrink-0">
                  <Check className="h-3 w-3 text-[var(--color-success)]" />
                </div>
                <span className="text-[var(--text-secondary)]">{feature}</span>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-[var(--border-subtle)] space-y-3">
            {profile?.subscription_tier !== 'enterprise' && (
              <Button className="w-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] hover:opacity-90 transition-opacity text-white font-medium">
                <ArrowUpRight className="h-4 w-4 mr-2" />
                Upgrade Plan
              </Button>
            )}
            <p className="text-xs text-[var(--text-muted)] text-center">
              Next billing: December 1, 2026
            </p>
          </div>
        </GlassCard>

        {/* Credits Card */}
        <GlassCard variant="bordered">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-6">Credits Balance</h2>

          <div className="flex items-center gap-5 mb-6">
            <div className="p-4 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 border border-[var(--accent-blue)]/20">
              <CreditCard className="h-10 w-10 text-[var(--accent-blue)]" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-[var(--text-primary)] tracking-tight">
                  {creditsBalance.toLocaleString()}
                </span>
                {tierConfig.monthlyCredits === -1 && (
                  <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20 text-xs">
                    Unlimited
                  </Badge>
                )}
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">available credits</p>
            </div>
          </div>

          {tierConfig.monthlyCredits !== -1 && (
            <div className="mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-[var(--text-muted)]">Used this month</span>
                <span className="text-[var(--text-secondary)] font-medium">
                  {creditsUsed.toLocaleString()} / {creditsLimit.toLocaleString()}
                </span>
              </div>
              <Progress value={creditsPercentage} className="h-2.5 bg-[var(--bg-tertiary)]" />
              {creditsPercentage > 80 && (
                <p className="text-xs text-[var(--color-warning)] mt-2 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  You&apos;re running low on credits
                </p>
              )}
            </div>
          )}

          <Button variant="outline" className="w-full border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)]">
            <Sparkles className="h-4 w-4 mr-2" />
            Buy More Credits
          </Button>
        </GlassCard>
      </div>

      {/* Account Settings */}
      <GlassCard variant="bordered">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-[var(--accent-blue)]/10">
            <User className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Account Settings</h2>
        </div>

        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Display Name */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
                <User className="h-4 w-4" />
                Display Name
              </Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (errors.name) setErrors(prev => ({ ...prev, name: '' }));
                }}
                placeholder="Your display name"
                className={`bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--accent-blue)] ${errors.name ? 'border-[var(--color-error)]' : ''}`}
              />
              {errors.name && (
                <p className="text-xs text-[var(--color-error)] flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.name}
                </p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Address
              </Label>
              <Input
                value={session.user?.email || ''}
                disabled
                className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-muted)] cursor-not-allowed"
              />
              <p className="text-xs text-[var(--text-muted)]">Contact support to change your email</p>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone Number
              </Label>
              <Input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (errors.phone) setErrors(prev => ({ ...prev, phone: '' }));
                }}
                placeholder="+1 (555) 000-0000"
                className={`bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)] focus:border-[var(--accent-blue)] ${errors.phone ? 'border-[var(--color-error)]' : ''}`}
              />
              {errors.phone && (
                <p className="text-xs text-[var(--color-error)] flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.phone}
                </p>
              )}
            </div>

            {/* Timezone */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)] w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">
              Last updated: {profile?.updated_at ? new Date(profile.updated_at).toLocaleDateString() : 'Never'}
            </p>
            <Button
              onClick={handleSaveProfile}
              disabled={updateProfileMutation.isPending}
              className="bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] hover:opacity-90 transition-opacity text-white font-medium"
            >
              {updateProfileMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Security Section */}
      <GlassCard variant="bordered">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-[var(--accent-purple)]/10">
            <Shield className="h-5 w-5 text-[var(--accent-purple)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Security</h2>
        </div>

        {/* Change Password Section */}
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Key className="h-4 w-4 text-[var(--text-muted)]" />
              Change Password
            </h3>

            <div className="space-y-4">
              {/* Current Password */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-[var(--text-secondary)]">Current Password</Label>
                <div className="relative">
                  <Input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter your current password"
                    className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)] pr-12 focus:border-[var(--accent-blue)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                  >
                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-[var(--text-secondary)]">New Password</Label>
                <div className="relative">
                  <Input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter your new password"
                    className="bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)] pr-12 focus:border-[var(--accent-blue)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <PasswordStrengthIndicator password={newPassword} />
              </div>

              {/* Confirm Password */}
              <div className="space-y-2">
                <Label className="text-sm font-medium text-[var(--text-secondary)]">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your new password"
                    className={`bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)] pr-12 focus:border-[var(--accent-blue)] ${confirmPassword && confirmPassword !== newPassword ? 'border-[var(--color-error)]' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword && confirmPassword !== newPassword && (
                  <p className="text-xs text-[var(--color-error)] flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Passwords do not match
                  </p>
                )}
                {confirmPassword && confirmPassword === newPassword && newPassword.length >= 8 && (
                  <p className="text-xs text-[var(--color-success)] flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    Passwords match
                  </p>
                )}
              </div>

              <Button
                onClick={handleChangePassword}
                disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || newPassword !== confirmPassword || newPassword.length < 8}
                variant="outline"
                className="border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)]"
              >
                {changePasswordMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Lock className="h-4 w-4 mr-2" />
                )}
                Update Password
              </Button>
            </div>
          </div>

          {/* Two-Factor Authentication */}
          <div className="pt-6 border-t border-[var(--border-subtle)]">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-xl bg-[var(--bg-tertiary)]">
                  <Smartphone className="h-5 w-5 text-[var(--text-muted)]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    Two-Factor Authentication
                    <Badge className="bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/20 text-xs">
                      Coming Soon
                    </Badge>
                  </h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">Add an extra layer of security with 2FA</p>
                </div>
              </div>
              <Switch disabled />
            </div>
          </div>

          {/* Active Sessions */}
          <div className="pt-6 border-t border-[var(--border-subtle)]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-xl bg-[var(--bg-tertiary)]">
                  <Monitor className="h-5 w-5 text-[var(--text-muted)]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
                    Active Sessions
                    <Badge className="bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/20 text-xs">
                      Coming Soon
                    </Badge>
                  </h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">Manage devices where you&apos;re logged in</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" disabled className="text-[var(--text-muted)]">
                View All
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>

            {/* Current Session Indicator */}
            <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[var(--accent-blue)]/10 flex items-center justify-center">
                  <Monitor className="h-5 w-5 text-[var(--accent-blue)]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">Current Session</p>
                  <p className="text-xs text-[var(--text-muted)]">Windows - Chrome</p>
                </div>
                <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20 text-xs">
                  Active Now
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
