'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, AlertTriangle, Check, X } from 'lucide-react';
import { toast } from 'sonner';

export default function ApprovalsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  const { data: approvals, isLoading } = useQuery({
    queryKey: ['approvals'],
    queryFn: async () => {
      const res = await fetch('/api/approvals');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, action, range }: { id: string; action: 'accept' | 'reject' | 'custom'; range?: number }) => {
      const res = await fetch(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, range }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-count'] });
      toast.success('Approval processed');
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

  const pending = (approvals || []).filter((a: any) => a.status === 'PENDING');
  const resolved = (approvals || []).filter((a: any) => a.status !== 'PENDING');

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Approvals</h1>
        <p className="text-[var(--text-secondary)] mt-1">Owner-range requests and contract approvals</p>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : pending.length === 0 && resolved.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <Check className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[var(--text-secondary)]">No approvals pending.</p>
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--color-error)] flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Pending ({pending.length})
              </h2>
              {pending.map((approval: any) => (
                <ApprovalCard key={approval.id} approval={approval} onAction={approveMutation.mutate} />
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-[var(--text-secondary)]">Resolved</h2>
              {resolved.map((approval: any) => (
                <ApprovalCard key={approval.id} approval={approval} onAction={approveMutation.mutate} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ approval, onAction }: { approval: any; onAction: (arg0: { id: string; action: 'accept' | 'reject' | 'custom'; range?: number }) => any }) {
  const [customRange, setCustomRange] = useState('');
  const context = approval.context || {};
  const isRange = approval.type === 'owner_range';
  const isContact = approval.type === 'contact_message';
  const isPending = approval.status === 'PENDING';

  return (
    <GlassCard className={isPending ? 'border-l-4 border-l-[var(--color-error)]' : ''}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <div className={`flex items-center gap-2 px-2 py-1 rounded-full ${
              isPending
                ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
                : 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'
            }`}>
              <StatusDot status={isPending ? 'error' : 'neutral'} size="sm" />
              <span className="text-xs font-medium">{approval.status}</span>
            </div>
            <span className="text-sm font-medium text-[var(--text-primary)]">{approval.type.replace(/_/g, ' ')}</span>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            {isRange ? (
              <>
                <strong className="text-[var(--text-secondary)]">Property:</strong> {context.address || 'Unknown address'}<br />
                <strong className="text-[var(--text-secondary)]">AI Suggested Range:</strong>{' '}
                <span className="font-mono text-[var(--color-success)]">
                  ${context.ai_min?.toLocaleString()} – ${context.ai_max?.toLocaleString()}
                </span>
              </>
            ) : isContact ? (
              <>
                <strong className="text-[var(--text-secondary)]">{context.name || 'Unknown'}</strong> &lt;{context.email || 'no email'}&gt;<br />
                <strong className="text-[var(--text-secondary)]">Subject:</strong> {context.subject || '(no subject)'}
              </>
            ) : (
              <><strong className="text-[var(--text-secondary)]">Contract</strong> ready for signature</>
            )}
          </p>
        </div>
      </div>

      {isPending && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => onAction({ id: approval.id, action: 'accept', range: context.ai_max })}
            className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Check className="h-4 w-4" /> {isContact ? 'Mark Reviewed' : 'Accept Suggestion'}
          </button>
          {isRange && (
            <div className="flex gap-1">
              <Input
                placeholder="Custom $"
                value={customRange}
                onChange={(e) => setCustomRange(e.target.value)}
                className="w-32 bg-[var(--bg-tertiary)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                type="number"
              />
              <button
                onClick={() => onAction({ id: approval.id, action: 'custom', range: Number(customRange) })}
                disabled={!customRange}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
              >
                Enter Own
              </button>
            </div>
          )}
          <button
            onClick={() => onAction({ id: approval.id, action: 'reject' })}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--color-error)]/10 text-[var(--color-error)] hover:bg-[var(--color-error)]/20 flex items-center gap-2"
          >
            <X className="h-4 w-4" /> Reject
          </button>
        </div>
      )}
    </GlassCard>
  );
}
