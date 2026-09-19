'use client';

/**
 * Admin panel component for managing signup restrictions.
 * Allows toggling domain-based signup restrictions and managing allowed domains.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Shield, Plus, X, AlertTriangle, Check } from 'lucide-react';
import { toast } from 'sonner';

interface SignupRestrictions {
  signup_restricted: boolean;
  allowed_email_domains: string[];
}

export default function SignupRestrictionsCard() {
  const queryClient = useQueryClient();
  const [newDomain, setNewDomain] = useState('');

  const { data, isLoading, error } = useQuery<SignupRestrictions>({
    queryKey: ['signup-restrictions'],
    queryFn: async () => {
      const res = await fetch('/api/admin/settings/signup');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to load signup restrictions');
      }
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (settings: SignupRestrictions) => {
      const res = await fetch('/api/admin/settings/signup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update settings');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signup-restrictions'] });
      toast.success('Signup restrictions updated');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleToggle = (enabled: boolean) => {
    if (!data) return;
    updateMutation.mutate({
      ...data,
      signup_restricted: enabled,
    });
  };

  const handleAddDomain = () => {
    if (!data || !newDomain.trim()) return;

    const domain = newDomain.trim().toLowerCase();

    // Basic validation
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain)) {
      toast.error('Invalid domain format');
      return;
    }

    if (data.allowed_email_domains.includes(domain)) {
      toast.error('Domain already in list');
      return;
    }

    updateMutation.mutate({
      ...data,
      allowed_email_domains: [...data.allowed_email_domains, domain],
    });
    setNewDomain('');
  };

  const handleRemoveDomain = (domain: string) => {
    if (!data) return;

    const remaining = data.allowed_email_domains.filter((d) => d !== domain);

    if (data.signup_restricted && remaining.length === 0) {
      toast.error('Cannot remove last domain while restrictions are enabled');
      return;
    }

    updateMutation.mutate({
      ...data,
      allowed_email_domains: remaining,
    });
  };

  if (error) {
    return (
      <Card className="border-[var(--color-error)]/30 bg-[var(--bg-secondary)]">
        <CardContent className="py-6">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Failed to load signup restrictions: {(error as Error).message}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
          <Shield className="h-5 w-5" />
          Signup Restrictions
        </CardTitle>
        <CardDescription className="text-[var(--text-muted)]">
          Control who can create new accounts on this platform
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
          </div>
        ) : data ? (
          <>
            {/* Toggle for enabling/disabling restrictions */}
            <div className="flex items-center justify-between p-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]">
              <div className="space-y-1">
                <div className="font-medium text-[var(--text-primary)]">
                  Restrict signups to specific email domains
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  {data.signup_restricted
                    ? 'Only users with allowed email domains can sign up'
                    : 'Anyone can sign up (subject to static domain allowlist)'}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {data.signup_restricted && (
                  <Badge className="bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                    Restricted
                  </Badge>
                )}
                <Switch
                  checked={data.signup_restricted}
                  onCheckedChange={handleToggle}
                  disabled={updateMutation.isPending}
                  aria-label="Toggle signup restrictions"
                />
              </div>
            </div>

            {/* Warning when restrictions are enabled */}
            {data.signup_restricted && (
              <Alert className="bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30">
                <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
                <AlertDescription className="text-[var(--text-secondary)]">
                  Signup is currently restricted. Only users with email addresses from the
                  allowed domains below can create accounts.
                </AlertDescription>
              </Alert>
            )}

            {/* Allowed domains list */}
            <div className="space-y-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                Allowed Email Domains
              </div>

              {/* Domain list */}
              <div className="space-y-2">
                {data.allowed_email_domains.length === 0 ? (
                  <div className="text-sm text-[var(--text-muted)] italic py-2">
                    No domains configured
                  </div>
                ) : (
                  data.allowed_email_domains.map((domain) => (
                    <div
                      key={domain}
                      className="flex items-center justify-between p-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
                    >
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-[var(--color-success)]" />
                        <span className="text-[var(--text-primary)] font-mono text-sm">
                          @{domain}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveDomain(domain)}
                        disabled={updateMutation.isPending}
                        className="h-8 w-8 p-0 text-[var(--text-muted)] hover:text-[var(--color-error)]"
                        aria-label={`Remove ${domain}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {/* Add new domain */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                    @
                  </span>
                  <Input
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="example.com"
                    className="pl-7 bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddDomain();
                      }
                    }}
                  />
                </div>
                <Button
                  onClick={handleAddDomain}
                  disabled={!newDomain.trim() || updateMutation.isPending}
                  className="bg-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/90"
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  <span className="ml-2">Add Domain</span>
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
