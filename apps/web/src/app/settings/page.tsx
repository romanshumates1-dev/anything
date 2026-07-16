'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ShieldCheck, TestTube, Key, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import AiProviderCard from '@/components/settings/AiProviderCard';
import BetaFlagsCard from '@/components/settings/BetaFlagsCard';
import NumberPoolCard from '@/components/settings/NumberPoolCard';
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
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">Manage AI provider, test numbers, and API access</p>
        </header>

        {/* AI Provider (Anthropic hosted vs local Ollama) */}
        <AiProviderCard />

        {/* Beta integrations + the live Event Log (manual-testing harness) */}
        <BetaFlagsCard />
        {/* INT-3: local-presence pool — usage table + rotation cap (Decision 2) */}
        <NumberPoolCard />
        <EventLogPanel />

        {/* Test Phone Numbers */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TestTube className="h-5 w-5" />
              Personal Test Numbers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTitle>How it works</AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                <p>Add a phone number, receive a 6-digit OTP, enter it here to verify.</p>
                <p>Verified numbers become your Personal Test Mode allowlist. Test campaigns only send to these numbers.</p>
              </AlertDescription>
            </Alert>

            <AddPhoneForm onSubmit={addPhoneMutation.mutate} />

            <div className="space-y-2">
              {phonesLoading ? (
                <div className="py-4 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin opacity-30" />
                </div>
              ) : !testPhones || testPhones.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No test numbers yet.</p>
              ) : (
                testPhones.map((phone: any) => (
                  <div key={phone.id} className="flex items-center justify-between border rounded-lg p-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{phone.phone}</span>
                      {phone.verified ? (
                        <Badge className="bg-green-50 text-green-700 border-green-200">Verified</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Pending</Badge>
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
                        <Trash2 className="h-4 w-4 text-gray-400" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* API Keys */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Keys
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTitle>Programmatic access</AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                <p>Keys are shown once at creation and stored hashed. They can be scoped and revoked anytime.</p>
                <p>Use Bearer auth: <code className="bg-gray-100 px-1 rounded">df_live_...</code></p>
              </AlertDescription>
            </Alert>

            <CreateApiKeyForm onCreate={createKeyMutation.mutate} />

            <div className="space-y-2">
              {keysLoading ? (
                <div className="py-4 flex justify-center">
                  <Loader2 className="h-5 w-5 animate-spin opacity-30" />
                </div>
              ) : !apiKeys || apiKeys.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No API keys yet.</p>
              ) : (
                apiKeys.map((key: any) => (
                  <div key={key.id} className="flex items-center justify-between border rounded-lg p-3">
                    <div>
                      <div className="text-sm font-medium">{key.name}</div>
                      <div className="text-xs text-gray-500">
                        {key.prefix}...{key.last4} · {key.scopes?.join(', ') || 'no scopes'} · rate {key.rate_limit_per_min}/min · used {key.usage_count || 0}x
                      </div>
                      {key.revoked && <Badge variant="destructive" className="mt-1">Revoked</Badge>}
                    </div>
                    {!key.revoked && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeKeyMutation.mutate(key.id)}
                        disabled={revokeKeyMutation.isPending}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
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
    <form onSubmit={handleSubmit} className="space-y-3 border rounded-lg p-4">
      <div className="space-y-2">
        <Label>Key Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Production Key" />
      </div>
      <div className="space-y-2">
        <Label>Scopes</Label>
        <div className="flex flex-wrap gap-2">
          {allScopes.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => toggleScope(scope)}
              className={`px-2 py-1 rounded text-xs border ${
                scopes.includes(scope) ? 'bg-black text-white border-black' : 'bg-white text-gray-700 border-gray-200'
              }`}
            >
              {scope}
            </button>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={loading || !name.trim()}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Create API Key
      </Button>
    </form>
  );
}