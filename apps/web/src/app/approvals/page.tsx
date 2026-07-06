'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, AlertTriangle, Check, X, Home } from 'lucide-react';
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
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  const pending = (approvals || []).filter((a: any) => a.status === 'PENDING');
  const resolved = (approvals || []).filter((a: any) => a.status !== 'PENDING');

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Approvals</h1>
          <p className="text-gray-500 mt-1">Owner-range requests and contract approvals</p>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin opacity-30" />
          </div>
        ) : pending.length === 0 && resolved.length === 0 ? (
          <Card className="border-none shadow-sm">
            <CardContent className="py-12 text-center">
              <Check className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No approvals pending.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {pending.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-lg font-semibold text-red-600 flex items-center gap-2">
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
                <h2 className="text-lg font-semibold text-gray-600">Resolved</h2>
                {resolved.map((approval: any) => (
                  <ApprovalCard key={approval.id} approval={approval} onAction={approveMutation.mutate} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({ approval, onAction }: { approval: any; onAction: (arg0: { id: string; action: 'accept' | 'reject' | 'custom'; range?: number }) => any }) {
  const [customRange, setCustomRange] = useState('');
  const context = approval.context || {};
  const isRange = approval.type === 'owner_range';

  return (
    <Card className={`border-none shadow-sm ${approval.status === 'PENDING' ? 'border-l-4 border-l-red-500' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant={approval.status === 'PENDING' ? 'destructive' : 'outline'}>
                {approval.status}
              </Badge>
              <span className="text-sm font-medium">{approval.type.replace(/_/g, ' ')}</span>
            </div>
            <p className="text-sm text-gray-600">
              {isRange ? (
                <>
                  <strong>Property:</strong> {context.address || 'Unknown address'}<br />
                  <strong>AI Suggested Range:</strong> ${context.ai_min?.toLocaleString()} – ${context.ai_max?.toLocaleString()}
                </>
              ) : (
                <><strong>Contract</strong> ready for signature</>
              )}
            </p>
          </div>
        </div>

        {approval.status === 'PENDING' && (
          <div className="flex flex-wrap gap-2 mt-4">
            <Button
              size="sm"
              onClick={() => onAction({ id: approval.id, action: 'accept', range: context.ai_max })}
              disabled={onAction.toString().includes('mutate') && false}
            >
              <Check className="h-4 w-4 mr-1" /> Accept Suggestion
            </Button>
            {isRange && (
              <div className="flex gap-1">
                <Input
                  placeholder="Custom $"
                  value={customRange}
                  onChange={(e) => setCustomRange(e.target.value)}
                  className="w-32"
                  type="number"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAction({ id: approval.id, action: 'custom', range: Number(customRange) })}
                  disabled={!customRange}
                >
                  Enter Own
                </Button>
              </div>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAction({ id: approval.id, action: 'reject' })}
              className="text-red-600"
            >
              <X className="h-4 w-4 mr-1" /> Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}