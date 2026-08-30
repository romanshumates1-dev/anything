'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Download, RefreshCw, Plus } from 'lucide-react';
import Link from 'next/link';

export default function LeadsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  const { data: leads, isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const res = await fetch('/api/leads');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/leads/export');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'leads.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => {},
    onError: (err: any) => alert(err.message),
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Contacts</h1>
          <p className="text-[var(--text-secondary)] mt-1">Manage leads, buyers, and sellers</p>
        </div>
        <div className="flex gap-2">
          <Link href="/leads/import" className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Import Contacts
          </Link>
          <button
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
            className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] text-sm flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            {exportMutation.isPending ? 'Exporting...' : 'Export CSV'}
          </button>
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['leads'] })}
            className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : !leads || leads.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <Users className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[var(--text-secondary)]">No contacts yet.</p>
          <Link href="/leads/import" className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium inline-block mt-4">
            Import Your First List
          </Link>
        </GlassCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {leads.map((lead: any) => (
            <GlassCard key={lead.id} padding="md">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-[var(--text-primary)]">{lead.name}</h3>
                <Badge className={
                  lead.type === 'seller'
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    : 'bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]'
                }>
                  {lead.type}
                </Badge>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-[var(--text-muted)]">{lead.phone || 'No phone'}</p>
                <p className="text-sm text-[var(--text-muted)]">{lead.email || 'No email'}</p>
                <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)] mt-3">
                  <div className="flex items-center gap-2">
                    <StatusDot status={lead.status === 'active' ? 'success' : 'neutral'} size="sm" />
                    <span className="text-xs text-[var(--text-muted)]">{lead.status || 'new'}</span>
                  </div>
                  <Link
                    href={`/inbox?leadId=${lead.id}`}
                    className="text-sm text-[var(--accent-blue)] hover:underline"
                  >
                    View Thread
                  </Link>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
