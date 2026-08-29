'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, TestTube, Key, Trash2, Info } from 'lucide-react';
import { toast } from 'sonner';
import AiProviderCard from '@/components/settings/AiProviderCard';
import BetaFlagsCard from '@/components/settings/BetaFlagsCard';
import NumberPoolCard from '@/components/settings/NumberPoolCard';
import NegotiationProfilesCard from '@/components/settings/NegotiationProfilesCard';
import EventLogPanel from '@/components/EventLogPanel';

export default function SettingsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  // Test phones
  const { data: testPhones, isLoading: phonesLoading } = useQuery({
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
      toast.success('Verification code sent');
    },
    onError: (err: any) => toast.error(err.message),
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
      toast.success('Phone verified');
    },
    onError: (err: any) => toast.error(err.message),
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
      toast.success('Phone removed');
    },
    onError: (err: any) => toast.error(err.message),
  });

  // API keys
  const { data: apiKeys, isLoading: keysLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await fetch('/api/settings/api-keys');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
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
      toast.success('API key created — shown once only');
      // In real app, show key once in a modal; we store it temporarily for demo
      window.prompt('Your new API key (save it now, it will not be shown again):', data.key);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const res = await fetch(`/api/settings/api-keys/${keyId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to revoke key');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key revoked');
    },
    onError: (err: any) => toast.error(err.message),
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

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h1>
        <p className="text-[var(--text-secondary)] mt-1">Manage AI provider, test numbers, and API access</p>
      </div>

        {/* AI Provider (Anthropic hosted vs local Ollama) */}
        <AiProviderCard />

        {/* Beta integrations + the live Event Log (manual-testing harness) */}
        <BetaFlagsCard />
        {/* INT-3: local-presence pool — usage table + rotation cap (Decision 2) */}
        <NumberPoolCard />
        {/* Phase N: per-list negotiation profiles (renders only when flag on) */}
        <NegotiationProfilesCard />
        <EventLogPanel />

        {/* Test Phone Numbers */}
        <GlassCard>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <TestTube className="h-5 w-5" />
            Personal Test Numbers
          </h3>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-[var(--accent-blue)] mt-0.5" />
                <div className="text-xs text-[var(--text-muted)] space-y-1">
                  <p>Add a phone number, receive a 6-digit OTP, enter it here to verify.</p>
                  <p>Verified numbers become your Personal Test Mode allowlist.</p>
                </div>
              </div>
            </div>

            <AddPhoneForm onSubmit={addPhoneMutation.mutate} />

            <div className="space-y-2">
              {phonesLoading ? (
                <div className="py-4 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-blue)]" />
                </div>
              ) : !testPhones || testPhones.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-4">No test numbers yet.</p>
              ) : (
                testPhones.map((phone: any) => (
                  <div key={phone.id} className="flex items-center justify-between bg-[var(--bg-tertiary)] rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{phone.phone}</span>
                      {phone.verified ? (
                        <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)]">Verified</Badge>
                      ) : (
                        <Badge className="bg-[var(--color-warning)]/10 text-[var(--color-warning)]">Pending</Badge>
                      )}
                    </div>
                    {!phone.verified ? (
                      <VerifyPhoneForm phone={phone} onVerify={verifyPhoneMutation.mutate} />
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deletePhoneMutation.mutate(phone.id)}
                        disabled={deletePhoneMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-[var(--text-muted)]" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </GlassCard>

        {/* API Keys */}
        <GlassCard>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Key className="h-5 w-5" />
            API Keys
          </h3>
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-[var(--accent-blue)] mt-0.5" />
                <div className="text-xs text-[var(--text-muted)] space-y-1">
                  <p>Keys are shown once at creation and stored hashed. They can be scoped and revoked anytime.</p>
                  <p>Use Bearer auth: <code className="bg-[var(--bg-primary)] px-1 rounded text-[var(--text-secondary)]">df_live_...</code></p>
                </div>
              </div>
            </div>

            <CreateApiKeyForm onCreate={createKeyMutation.mutate} />

            <div className="space-y-2">
              {keysLoading ? (
                <div className="py-4 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-blue)]" />
                </div>
              ) : !apiKeys || apiKeys.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-4">No API keys yet.</p>
              ) : (
                apiKeys.map((key: any) => (
                  <div key={key.id} className="flex items-center justify-between bg-[var(--bg-tertiary)] rounded-lg p-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{key.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {key.prefix}...{key.last4} · {key.scopes?.join(', ') || 'no scopes'} · rate {key.rate_limit_per_min}/min · used {key.usage_count || 0}x
                      </div>
                      {key.revoked && <Badge className="bg-[var(--color-error)]/10 text-[var(--color-error)] mt-1">Revoked</Badge>}
                    </div>
                    {!key.revoked && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeKeyMutation.mutate(key.id)}
                        disabled={revokeKeyMutation.isPending}
                        className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </GlassCard>
      </div>
  );
}

function AddPhoneForm({ onSubmit }: { onSubmit: (phone: string) => void }) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    try {
      await onSubmit(phone.trim());
      setPhone('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        placeholder="+1 (555) 000-0000"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="flex-1"
      />
      <Button type="submit" disabled={loading || !phone.trim()}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add Number'}
      </Button>
    </form>
  );
}

function VerifyPhoneForm({ phone, onVerify }: { phone: any; onVerify: (arg0: { phoneId: string; code: string }) => any }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      await onVerify({ phoneId: phone.id, code: code.trim() });
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-28"
        maxLength={6}
      />
      <Button size="sm" type="submit" disabled={loading || code.length !== 6}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
      </Button>
    </form>
  );
}

function CreateApiKeyForm({ onCreate }: { onCreate: (arg0: { name: string; scopes: string[] }) => void }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read:campaigns']);
  const [loading, setLoading] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreate({ name: name.trim(), scopes });
      setName('');
      setScopes(['read:campaigns']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 bg-[var(--bg-tertiary)] rounded-lg p-4">
      <div className="space-y-2">
        <Label className="text-[var(--text-secondary)]">Key Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production Key"
          className="bg-[var(--bg-primary)] border-[var(--border-subtle)] text-[var(--text-primary)]"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-[var(--text-secondary)]">Scopes</Label>
        <div className="flex flex-wrap gap-2">
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
      <button type="submit" disabled={loading || !name.trim()} className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium">
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Create API Key
      </button>
    </form>
  );
}