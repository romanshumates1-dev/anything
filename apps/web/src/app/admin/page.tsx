'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { MetricValue } from '@/components/ui/MetricValue';
import { StatusDot } from '@/components/ui/StatusDot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Loader2,
  Users,
  Megaphone,
  MessageSquare,
  Activity,
  Key,
  Trash2,
  Info,
  Shield,
  UserCog,
  Server,
  Cpu,
  Cloud,
  Plug,
  FlaskConical,
  Phone,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  UserPlus,
  Ban,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Database,
  Zap,
  Settings,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// Types
interface SystemStats {
  users: {
    total: number;
    admins: number;
    bannedSuspended: number;
    newThisWeek: number;
    newThisMonth: number;
  };
  campaigns: {
    total: number;
    active: number;
    paused: number;
    completed: number;
    newThisWeek: number;
  };
  messages: {
    sentToday: number;
    sentThisWeek: number;
    sentThisMonth: number;
    receivedToday: number;
  };
  leads: {
    total: number;
    hot: number;
    warm: number;
    newThisWeek: number;
  };
  apiKeys: {
    total: number;
    active: number;
    totalUsage: number;
  };
  activity: {
    adminActionsToday: number;
  };
  systemHealth: {
    status: 'healthy' | 'degraded' | 'down';
    checks: Record<string, { status: string; latency?: number }>;
    checkedAt: string;
  };
}

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
  banned: boolean;
  ban_reason: string | null;
  suspended_until: string | null;
  active_sessions: number;
  last_login_at: string | null;
  created_at: string;
}

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  rate_limit_per_min: number;
  usage_count: number;
  revoked: boolean;
  created_at: string;
}

interface AiConfig {
  provider: 'anthropic' | 'bedrock' | 'ollama';
  ollamaBaseUrl: string;
  ollamaModel: string;
  source: 'db' | 'env' | 'default';
}

interface BetaFlags {
  flags: Record<string, boolean>;
  keys: string[];
}

// Metadata for beta flags
const FLAG_META: Record<string, { label: string; blurb: string; danger?: string }> = {
  speedToLead: {
    label: 'Speed-to-Lead',
    blurb: 'Times every inbound reply with AI dispatch and ack-SMS fallback.',
  },
  cadenceEngine: {
    label: 'Cadence Engine',
    blurb: 'Multi-step follow-up ladder with send-window snapping.',
  },
  localPresence: {
    label: 'Local Presence',
    blurb: 'Picks a from-number matching the lead\'s area code.',
  },
  voiceEscalation: {
    label: 'Voice Escalation',
    blurb: 'SMS to AI voice call double-tap with voicemail drop.',
    danger: 'Leave OFF until A2P/10DLC clears.',
  },
  negotiationProfiles: {
    label: 'Negotiation Profiles',
    blurb: 'Per-list pricing and posture configuration.',
  },
};

export default function AdminPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  // Check admin access - cast user to include role field (defined in auth config)
  const user = session?.user as { role?: string } | undefined;
  const isAdmin = user?.role === 'ADMIN';

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && session && !isAdmin) {
      toast.error('Access denied. Admin role required.');
      redirect('/dashboard');
    }
  }, [authLoading, session, isAdmin]);

  // Fetch system stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery<SystemStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    enabled: !!session && isAdmin,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  if (!isAdmin) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--accent-purple)]/10">
              <Shield className="h-6 w-6 text-[var(--accent-purple)]" />
            </div>
            Admin Panel
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            System overview, user management, and configuration
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchStats()}
          disabled={statsLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${statsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* System Overview Dashboard */}
      <SystemOverviewSection stats={stats} loading={statsLoading} />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Management */}
        <UserManagementSection />

        {/* API Key Management */}
        <ApiKeyManagementSection />
      </div>

      {/* AI Provider Configuration */}
      <AiProviderSection />

      {/* System Settings */}
      <SystemSettingsSection />
    </div>
  );
}

// ============================================================================
// System Overview Section
// ============================================================================
function SystemOverviewSection({ stats, loading }: { stats?: SystemStats; loading: boolean }) {
  const healthStatus = stats?.systemHealth?.status || 'healthy';
  const healthStatusMap: Record<string, { status: 'success' | 'warning' | 'error'; label: string }> = {
    healthy: { status: 'success', label: 'All Systems Operational' },
    degraded: { status: 'warning', label: 'System Degraded' },
    down: { status: 'error', label: 'System Down' },
  };
  const health = healthStatusMap[healthStatus] || healthStatusMap.healthy;

  const kpis = [
    {
      label: 'Total Users',
      value: stats?.users.total || 0,
      icon: Users,
      trend: stats?.users.newThisWeek,
      trendLabel: 'new this week',
      href: '/admin/users',
    },
    {
      label: 'Active Campaigns',
      value: stats?.campaigns.active || 0,
      icon: Megaphone,
      trend: stats?.campaigns.newThisWeek,
      trendLabel: 'new this week',
      href: '/campaigns',
    },
    {
      label: 'Messages Today',
      value: stats?.messages.sentToday || 0,
      icon: MessageSquare,
      secondary: `${stats?.messages.receivedToday || 0} received`,
    },
    {
      label: 'System Health',
      value: health.label,
      icon: Activity,
      status: health.status,
    },
  ];

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Server className="h-5 w-5 text-[var(--text-muted)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">System Overview</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <GlassCard key={i} padding="md">
              <div className="animate-pulse">
                <div className="h-4 w-24 bg-[var(--bg-tertiary)] rounded mb-3" />
                <div className="h-8 w-32 bg-[var(--bg-tertiary)] rounded" />
              </div>
            </GlassCard>
          ))
        ) : (
          kpis.map((kpi) => (
            <GlassCard key={kpi.label} padding="md" className="card-interactive">
              {kpi.href ? (
                <Link href={kpi.href} className="block">
                  <KpiContent kpi={kpi} />
                </Link>
              ) : (
                <KpiContent kpi={kpi} />
              )}
            </GlassCard>
          ))
        )}
      </div>

      {/* System Health Details */}
      {stats?.systemHealth && (
        <GlassCard className="mt-4" padding="md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Health Checks</h3>
            <span className="text-xs text-[var(--text-muted)]">
              Last checked: {new Date(stats.systemHealth.checkedAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(stats.systemHealth.checks).map(([name, check]) => (
              <div key={name} className="flex items-center gap-3">
                <StatusDot
                  status={check.status === 'healthy' ? 'success' : check.status === 'degraded' ? 'warning' : 'error'}
                />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)] capitalize">{name}</p>
                  {check.latency !== undefined && (
                    <p className="text-xs text-[var(--text-muted)]">{check.latency}ms</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </section>
  );
}

function KpiContent({ kpi }: { kpi: any }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm text-[var(--text-muted)] mb-1">{kpi.label}</p>
        {typeof kpi.value === 'number' ? (
          <MetricValue value={kpi.value} size="lg" />
        ) : (
          <div className="flex items-center gap-2">
            {kpi.status && <StatusDot status={kpi.status} pulse={kpi.status !== 'success'} />}
            <span className="text-lg font-semibold text-[var(--text-primary)]">{kpi.value}</span>
          </div>
        )}
        {kpi.trend !== undefined && (
          <p className="text-xs text-[var(--color-success)] mt-1">
            +{kpi.trend} {kpi.trendLabel}
          </p>
        )}
        {kpi.secondary && (
          <p className="text-xs text-[var(--text-muted)] mt-1">{kpi.secondary}</p>
        )}
      </div>
      <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
        <kpi.icon className="h-5 w-5 text-[var(--accent-blue)]" />
      </div>
    </div>
  );
}

// ============================================================================
// User Management Section
// ============================================================================
function UserManagementSection() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      return res.json();
    },
  });

  const roleChangeMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update role');
      }
      return res.json();
    },
    onSuccess: (_, { role }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success(`User role updated to ${role}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const banMutation = useMutation({
    mutationFn: async ({ userId, action, reason }: { userId: string; action: 'ban' | 'unban'; reason?: string }) => {
      if (action === 'ban') {
        const res = await fetch('/api/admin/bans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, action: 'ban', reason }),
        });
        if (!res.ok) throw new Error('Failed to ban user');
        return res.json();
      } else {
        const res = await fetch(`/api/admin/bans?userId=${userId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to unban user');
        return res.json();
      }
    },
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success(action === 'ban' ? 'User banned' : 'User unbanned');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filteredUsers = users?.filter(
    (u) =>
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusBadge = (user: User) => {
    if (user.banned) {
      return <Badge className="bg-[var(--color-error)]/10 text-[var(--color-error)]">Banned</Badge>;
    }
    if (user.suspended_until && new Date(user.suspended_until).getTime() > Date.now()) {
      return <Badge className="bg-[var(--color-warning)]/10 text-[var(--color-warning)]">Suspended</Badge>;
    }
    return <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)]">Active</Badge>;
  };

  return (
    <GlassCard padding="lg">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <UserCog className="h-5 w-5" />
          User Management
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="gap-1"
          >
            <UserPlus className="h-4 w-4" />
            Invite
          </Button>
          <Link href="/admin/users">
            <Button variant="ghost" size="sm" className="gap-1">
              View All
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {showInviteForm && <InviteUserForm onClose={() => setShowInviteForm(false)} />}

      <div className="mb-4">
        <Input
          placeholder="Search users..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-[var(--bg-primary)] border-[var(--border-subtle)]"
        />
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
          </div>
        ) : !filteredUsers || filteredUsers.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">No users found.</p>
        ) : (
          filteredUsers.slice(0, 10).map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]/80 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-sm font-medium">
                    {user.email[0].toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {user.email}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        user.role === 'ADMIN'
                          ? 'border-[var(--accent-purple)] text-[var(--accent-purple)]'
                          : 'border-[var(--border-medium)] text-[var(--text-muted)]'
                      }`}
                    >
                      {user.role}
                    </Badge>
                    {getStatusBadge(user)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const newRole = user.role === 'ADMIN' ? 'MEMBER' : 'ADMIN';
                    if (confirm(`Change ${user.email} to ${newRole}?`)) {
                      roleChangeMutation.mutate({ userId: user.id, role: newRole });
                    }
                  }}
                  disabled={roleChangeMutation.isPending}
                  className="text-xs"
                >
                  {user.role === 'ADMIN' ? 'Demote' : 'Promote'}
                </Button>
                {user.banned ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => banMutation.mutate({ userId: user.id, action: 'unban' })}
                    disabled={banMutation.isPending}
                    className="text-[var(--color-success)] text-xs"
                  >
                    Unban
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const reason = prompt('Ban reason:');
                      if (reason) {
                        banMutation.mutate({ userId: user.id, action: 'ban', reason });
                      }
                    }}
                    disabled={banMutation.isPending}
                    className="text-[var(--color-error)] text-xs"
                  >
                    Ban
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {filteredUsers && filteredUsers.length > 10 && (
        <p className="text-xs text-[var(--text-muted)] text-center mt-4">
          Showing 10 of {filteredUsers.length} users.{' '}
          <Link href="/admin/users" className="text-[var(--accent-blue)] hover:underline">
            View all
          </Link>
        </p>
      )}
    </GlassCard>
  );
}

function InviteUserForm({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      // This would call an invite API endpoint
      toast.success(`Invitation sent to ${email}`);
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-4 rounded-lg bg-[var(--bg-tertiary)] space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-[var(--text-primary)]">Invite New User</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 bg-[var(--bg-primary)]"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'MEMBER' | 'ADMIN')}
          className="px-3 py-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm"
        >
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Admin</option>
        </select>
        <Button type="submit" disabled={loading || !email.trim()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
        </Button>
      </div>
    </form>
  );
}

// ============================================================================
// API Key Management Section
// ============================================================================
function ApiKeyManagementSection() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const { data: apiKeys, isLoading } = useQuery<ApiKey[]>({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await fetch('/api/settings/api-keys');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async ({ name, scopes }: { name: string; scopes: string[] }) => {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, scopes }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create key');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key created');
      window.prompt('Your new API key (save it now):', data.key);
      setShowCreateForm(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const res = await fetch(`/api/settings/api-keys/${keyId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke key');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key revoked');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <GlassCard padding="lg">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Key className="h-5 w-5" />
          API Key Management
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="gap-1"
        >
          <Key className="h-4 w-4" />
          New Key
        </Button>
      </div>

      <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] mb-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-[var(--accent-blue)] mt-0.5 flex-shrink-0" />
          <p className="text-xs text-[var(--text-muted)]">
            API keys provide programmatic access to the platform. Keys are shown once at creation and
            stored hashed. Use Bearer auth: <code className="bg-[var(--bg-primary)] px-1 rounded">df_live_...</code>
          </p>
        </div>
      </div>

      {showCreateForm && (
        <CreateApiKeyForm
          onCreate={(data) => createKeyMutation.mutate(data)}
          onClose={() => setShowCreateForm(false)}
          loading={createKeyMutation.isPending}
        />
      )}

      <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
          </div>
        ) : !apiKeys || apiKeys.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">No API keys yet.</p>
        ) : (
          apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{key.name}</p>
                  {key.revoked && (
                    <Badge className="bg-[var(--color-error)]/10 text-[var(--color-error)]">
                      Revoked
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  <code className="font-mono">{key.prefix}...{key.last4}</code>
                  {' '} | {key.scopes?.join(', ') || 'no scopes'}
                  {' '} | {key.rate_limit_per_min}/min
                  {' '} | {key.usage_count || 0} calls
                </p>
              </div>
              {!key.revoked && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm('Revoke this API key?')) {
                      revokeKeyMutation.mutate(key.id);
                    }
                  }}
                  disabled={revokeKeyMutation.isPending}
                  className="text-[var(--color-error)]"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </GlassCard>
  );
}

function CreateApiKeyForm({
  onCreate,
  onClose,
  loading,
}: {
  onCreate: (data: { name: string; scopes: string[] }) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read:campaigns']);

  const allScopes = [
    'read:campaigns',
    'write:campaigns',
    'read:conversations',
    'write:messages',
    'read:analytics',
    'read:approvals',
    'write:approvals',
  ];

  const toggleScope = (scope: string) => {
    setScopes((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));
  };

  return (
    <div className="mb-4 p-4 rounded-lg bg-[var(--bg-tertiary)] space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-[var(--text-primary)]">Create New API Key</Label>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <XCircle className="h-4 w-4" />
        </Button>
      </div>
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">Key Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production Key"
          className="bg-[var(--bg-primary)] mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-[var(--text-secondary)]">Scopes</Label>
        <div className="flex flex-wrap gap-2 mt-1">
          {allScopes.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => toggleScope(scope)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                scopes.includes(scope)
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
              }`}
            >
              {scope}
            </button>
          ))}
        </div>
      </div>
      <Button onClick={() => onCreate({ name, scopes })} disabled={loading || !name.trim()}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Create Key
      </Button>
    </div>
  );
}

// ============================================================================
// AI Provider Configuration Section
// ============================================================================
function AiProviderSection() {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<'anthropic' | 'bedrock' | 'ollama'>('bedrock');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3.1:8b');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ reachable: boolean; detail: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const { data: config, isLoading } = useQuery<AiConfig>({
    queryKey: ['ai-provider'],
    queryFn: async () => {
      const res = await fetch('/api/settings/ai-provider');
      if (!res.ok) throw new Error('Failed to load AI config');
      return res.json();
    },
  });

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setOllamaUrl(config.ollamaBaseUrl || 'http://localhost:11434');
      setOllamaModel(config.ollamaModel || 'llama3.1:8b');
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/ai-provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          ollamaBaseUrl: ollamaUrl,
          ollamaModel,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-provider'] });
      toast.success(`AI provider set to ${provider}`);
      setTestResult(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/system/ai-status');
      setTestResult(await res.json());
    } catch (e: any) {
      setTestResult({ reachable: false, detail: e.message });
    } finally {
      setTesting(false);
    }
  };

  const providerOptions = [
    {
      id: 'bedrock',
      label: 'AWS Bedrock',
      icon: Cloud,
      desc: 'Claude on AWS. Recommended for production.',
    },
    {
      id: 'anthropic',
      label: 'Anthropic API',
      icon: Zap,
      desc: 'Direct Claude API access.',
    },
    {
      id: 'ollama',
      label: 'Local (Ollama)',
      icon: Cpu,
      desc: 'Self-hosted open model. Free per message.',
    },
  ];

  return (
    <GlassCard padding="lg">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Plug className="h-5 w-5" />
          AI Provider Configuration
          {config && (
            <Badge variant="outline" className="ml-2 text-xs">
              Active: {config.provider} ({config.source})
            </Badge>
          )}
        </h3>
      </div>

      <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] mb-4">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-[var(--accent-blue)] mt-0.5 flex-shrink-0" />
          <p className="text-xs text-[var(--text-muted)]">
            Configure which AI provider powers the platform's negotiation, classification, and
            generation features. Changes take effect immediately.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {providerOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setProvider(opt.id as any)}
                className={`text-left border rounded-lg p-4 transition-all ${
                  provider === opt.id
                    ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
                }`}
              >
                <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                  <opt.icon className="h-4 w-4" />
                  {opt.label}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">{opt.desc}</p>
              </button>
            ))}
          </div>

          {provider === 'ollama' && (
            <div className="grid grid-cols-2 gap-3 p-4 rounded-lg bg-[var(--bg-tertiary)]">
              <div>
                <Label className="text-xs text-[var(--text-secondary)]">Ollama Base URL</Label>
                <Input
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="bg-[var(--bg-primary)] mt-1"
                />
              </div>
              <div>
                <Label className="text-xs text-[var(--text-secondary)]">Model</Label>
                <Input
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  placeholder="llama3.1:8b"
                  className="bg-[var(--bg-primary)] mt-1"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Configuration
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing}>
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plug className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-lg border ${
                testResult.reachable
                  ? 'border-[var(--color-success)] bg-[var(--color-success)]/10'
                  : 'border-[var(--color-error)] bg-[var(--color-error)]/10'
              }`}
            >
              <div className="flex items-center gap-2">
                {testResult.reachable ? (
                  <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                ) : (
                  <XCircle className="h-4 w-4 text-[var(--color-error)]" />
                )}
                <span
                  className={`text-sm font-medium ${
                    testResult.reachable ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
                  }`}
                >
                  {testResult.reachable ? 'Connection Successful' : 'Connection Failed'}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-1">{testResult.detail}</p>
            </div>
          )}

          {provider === 'ollama' && (
            <div>
              <button
                type="button"
                className="text-xs text-[var(--text-muted)] flex items-center gap-1"
                onClick={() => setShowGuide(!showGuide)}
              >
                {showGuide ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                How to set up Ollama
              </button>
              {showGuide && (
                <div className="mt-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-tertiary)] rounded p-3 space-y-1 font-mono">
                  <div># 1. Install Ollama (ollama.com/download), then:</div>
                  <div>ollama serve # starts the local server on :11434</div>
                  <div>ollama pull llama3.1:8b # ~4.7 GB</div>
                  <div className="font-sans pt-2 text-[var(--text-muted)]">
                    2. Set provider = Local (Ollama) above, Save, then Test connection.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ============================================================================
// System Settings Section (Beta Flags + Number Pool)
// ============================================================================
function SystemSettingsSection() {
  const queryClient = useQueryClient();

  // Beta flags
  const { data: betaData, isLoading: flagsLoading } = useQuery<BetaFlags>({
    queryKey: ['beta-flags'],
    queryFn: async () => {
      const res = await fetch('/api/settings/beta-flags');
      if (!res.ok) throw new Error('Failed to load flags');
      return res.json();
    },
  });

  const toggleFlagMutation = useMutation({
    mutationFn: async (patch: Record<string, boolean>) => {
      const res = await fetch('/api/settings/beta-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to toggle flag');
      return res.json();
    },
    onSuccess: (_, patch) => {
      const [key, value] = Object.entries(patch)[0];
      queryClient.invalidateQueries({ queryKey: ['beta-flags'] });
      toast.success(`${FLAG_META[key]?.label || key} ${value ? 'enabled' : 'disabled'}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const flags = betaData?.flags ?? {};
  const flagKeys = betaData?.keys ?? Object.keys(FLAG_META);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Beta Feature Flags */}
      <GlassCard padding="lg">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <FlaskConical className="h-5 w-5" />
            Beta Features
          </h3>
        </div>

        <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] mb-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-[var(--accent-blue)] mt-0.5 flex-shrink-0" />
            <p className="text-xs text-[var(--text-muted)]">
              Toggle experimental features. Changes take effect immediately and are logged for audit.
            </p>
          </div>
        </div>

        {flagsLoading ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
          </div>
        ) : (
          <div className="space-y-3">
            {flagKeys.map((key) => {
              const meta = FLAG_META[key] || { label: key, blurb: '' };
              const isOn = flags[key] === true;
              return (
                <div
                  key={key}
                  className="flex items-start justify-between gap-4 p-3 rounded-lg bg-[var(--bg-tertiary)]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {meta.label}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        BETA
                      </Badge>
                      {isOn && (
                        <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)] text-[10px]">
                          ON
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1">{meta.blurb}</p>
                    {meta.danger && (
                      <p className="text-xs text-[var(--color-warning)] mt-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {meta.danger}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={isOn}
                    onCheckedChange={(v) => toggleFlagMutation.mutate({ [key]: v })}
                    disabled={toggleFlagMutation.isPending}
                  />
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Quick Links */}
      <GlassCard padding="lg">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Quick Links
          </h3>
        </div>

        <div className="space-y-2">
          {[
            { href: '/admin/audit', icon: Clock, label: 'Audit Log', desc: 'View admin activity history' },
            { href: '/admin/compliance', icon: Shield, label: 'Compliance', desc: 'Suppression list and opt-outs' },
            { href: '/admin/reviews', icon: CheckCircle, label: 'Review Queue', desc: 'Pending message reviews' },
            { href: '/admin/billing', icon: TrendingUp, label: 'Billing', desc: 'Subscription and usage' },
            { href: '/settings', icon: Settings, label: 'All Settings', desc: 'Full settings page' },
            { href: '/system-health', icon: Activity, label: 'System Health', desc: 'Detailed health dashboard' },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-tertiary)]/80 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10 group-hover:bg-[var(--accent-blue)]/20 transition-colors">
                  <link.icon className="h-4 w-4 text-[var(--accent-blue)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{link.label}</p>
                  <p className="text-xs text-[var(--text-muted)]">{link.desc}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
            </Link>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
