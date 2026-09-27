'use client';

/**
 * Bank account management dialog.
 *
 * Replaces what was a decorative dead button on the payouts page ("Add
 * Account" / "Update" had no onClick and no href - previously at
 * src/app/payouts/page.tsx:801-805). With no route behind it, a seller could
 * read "No bank account connected. Add a bank account to enable withdrawals."
 * and had no way to act on it, so the entire payout path was unreachable.
 *
 * Routing/account numbers live only in form state while the dialog is open and
 * are never rendered back - the API only ever returns last_four.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, CreditCard, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

interface BankAccount {
  id: string;
  bank_name: string;
  account_type: string;
  last_four: string;
  verified: boolean;
  is_default: boolean;
}

const QUERY_KEY = ['bank-accounts'];

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || 'Something went wrong');
  return body;
}

export function BankAccountDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [bankName, setBankName] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState('checking');
  const [verifyAmounts, setVerifyAmounts] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api('/api/bank-accounts'),
    enabled: open,
  });
  const accounts: BankAccount[] = data?.accounts ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ['earnings'] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api('/api/bank-accounts', {
        method: 'POST',
        body: JSON.stringify({
          bank_name: bankName,
          routing_number: routingNumber,
          account_number: accountNumber,
          account_type: accountType,
        }),
      }),
    onSuccess: () => {
      toast.success('Bank account added. Verify it to enable payouts.');
      setBankName('');
      setRoutingNumber('');
      setAccountNumber('');
      setAccountType('checking');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => api(`/api/bank-accounts/${id}/default`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Default payout account updated');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startVerifyMutation = useMutation({
    mutationFn: (id: string) =>
      api(`/api/bank-accounts/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ method: 'micro_deposit' }),
      }),
    onSuccess: (b: any) => {
      setVerifyingId(b.verification_id);
      toast.success(`Two small deposits will arrive within ${b.expected_days} business days.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmVerifyMutation = useMutation({
    mutationFn: ({ id, amounts }: { id: string; amounts: number[] }) =>
      api(`/api/bank-accounts/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ verification_id: verifyingId, amounts }),
      }),
    onSuccess: () => {
      toast.success('Bank account verified');
      setVerifyingId(null);
      setVerifyAmounts('');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/api/bank-accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Bank account removed');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 self-start sm:self-center">
          <CreditCard className="h-4 w-4" />
          Manage Bank Accounts
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payout bank accounts</DialogTitle>
          <DialogDescription>
            Add the account you want your earnings paid into, then verify it. Withdrawals stay
            locked until an account is verified and set as default.
          </DialogDescription>
        </DialogHeader>

        {accounts.length > 0 && (
          <div className="space-y-2">
            {accounts.map((acct) => (
              <div
                key={acct.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Building2 className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {acct.bank_name} ****{acct.last_four}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="secondary" className="text-xs capitalize">
                        {acct.account_type}
                      </Badge>
                      {acct.verified ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </span>
                      ) : (
                        <span className="text-xs text-amber-400">Not verified</span>
                      )}
                      {acct.is_default && (
                        <Badge className="text-xs bg-[var(--bg-tertiary)]">Default</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!acct.is_default && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDefaultMutation.mutate(acct.id)}
                      disabled={setDefaultMutation.isPending}
                    >
                      Set default
                    </Button>
                  )}
                  {!acct.verified && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startVerifyMutation.mutate(acct.id)}
                      disabled={startVerifyMutation.isPending}
                    >
                      Verify
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(acct.id)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Remove ${acct.bank_name} ending ${acct.last_four}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {verifyingId && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <p className="text-sm text-amber-300">
              Enter the two deposit amounts (in cents) exactly as they appear on your statement.
            </p>
            <div className="flex gap-2">
              <Input
                value={verifyAmounts}
                onChange={(e) => setVerifyAmounts(e.target.value)}
                placeholder="e.g. 32, 45"
                aria-label="Micro-deposit amounts in cents"
              />
              <Button
                size="sm"
                onClick={() => {
                  const amounts = verifyAmounts
                    .split(/[,\s]+/)
                    .filter(Boolean)
                    .map((n) => Number(n))
                    .filter((n) => Number.isInteger(n) && n > 0);
                  const target = accounts.find((a) => !a.verified);
                  if (!target || amounts.length !== 2) {
                    toast.error('Enter exactly two amounts');
                    return;
                  }
                  confirmVerifyMutation.mutate({ id: target.id, amounts });
                }}
                disabled={confirmVerifyMutation.isPending}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}

        <form
          className="space-y-3 border-t border-[var(--border-subtle)] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            addMutation.mutate();
          }}
        >
          <p className="text-sm font-semibold flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add a bank account
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ba-bank">Bank name</Label>
            <Input
              id="ba-bank"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Chase"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ba-routing">Routing number</Label>
              <Input
                id="ba-routing"
                value={routingNumber}
                onChange={(e) => setRoutingNumber(e.target.value)}
                placeholder="021000021"
                inputMode="numeric"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ba-type">Account type</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger id="ba-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="checking">Checking</SelectItem>
                  <SelectItem value="savings">Savings</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ba-account">Account number</Label>
            <Input
              id="ba-account"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="000123456789"
              inputMode="numeric"
              required
            />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Account details are encrypted before they are stored. We only ever display the last
            four digits.
          </p>
          <Button type="submit" className="w-full" disabled={addMutation.isPending}>
            {addMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add bank account
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}