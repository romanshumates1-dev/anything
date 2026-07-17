'use client';

/**
 * Settings → Local Presence Number Pool (MVP v2 — INT-3).
 * Shows per-number usage with BOTH caps visible (owner Decision 2: the
 * rotation guard vs the carrier ceiling), the rotationCap setting, and an
 * add-number form. Every change is an Event Log entry via the admin API.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Phone } from 'lucide-react';
import { toast } from 'sonner';

type PoolUsageRow = {
  phoneNumber: string;
  areaCode: string;
  numberType: string;
  trustLevel: string;
  active: boolean;
  sentToday: number;
  cap: { rotationCap: number; carrierCap: number; effective: number; limitedBy: 'rotation' | 'carrier' };
  remaining: number;
};

type PoolResponse = { rotationCap: number; numbers: PoolUsageRow[] };

export default function NumberPoolCard() {
  const qc = useQueryClient();
  const [newNumber, setNewNumber] = useState('');
  const [capDraft, setCapDraft] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PoolResponse>({
    queryKey: ['number-pool'],
    queryFn: async () => {
      const res = await fetch('/api/settings/number-pool');
      if (!res.ok) throw new Error(`number-pool GET ${res.status}`);
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const res = await fetch('/api/settings/number-pool', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `POST ${res.status}`);
      return body as PoolResponse;
    },
    onSuccess: (body) => {
      qc.setQueryData(['number-pool'], body);
      setNewNumber('');
      toast.success('Number added to the pool');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const capMutation = useMutation({
    mutationFn: async (rotationCap: number) => {
      const res = await fetch('/api/settings/number-pool', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rotationCap }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `PATCH ${res.status}`);
      return body as PoolResponse;
    },
    onSuccess: (body) => {
      qc.setQueryData(['number-pool'], body);
      setCapDraft(null);
      toast.success(`Rotation cap set to ${body.rotationCap}/day per number`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rotationCap = data?.rotationCap ?? 125;

  return (
    <Card data-testid="number-pool-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Local Presence Number Pool
          <Badge variant="outline">Beta · INT-3</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          When the Local Presence flag is ON, outreach texts send from a pool number matching the
          lead&apos;s area code. Each number stops at <strong>min(rotation&nbsp;cap, carrier&nbsp;capacity)</strong> per
          day — the rotation cap is the reputation guard; the carrier number is the hard ceiling.
        </p>

        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs font-medium" htmlFor="rotation-cap">
              Rotation cap (sends/day/number)
            </label>
            <Input
              id="rotation-cap"
              className="w-36"
              inputMode="numeric"
              value={capDraft ?? String(rotationCap)}
              onChange={(e) => setCapDraft(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={capMutation.isPending || capDraft === null || Number(capDraft) === rotationCap}
            onClick={() => {
              const n = Number(capDraft);
              if (!Number.isInteger(n) || n < 0) {
                toast.error('Cap must be a non-negative integer');
                return;
              }
              capMutation.mutate(n);
            }}
          >
            {capMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save cap'}
          </Button>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs font-medium" htmlFor="new-pool-number">
              Add number (E.164, e.g. +15025551234)
            </label>
            <Input
              id="new-pool-number"
              placeholder="+1XXXXXXXXXX"
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={addMutation.isPending || !/^\+1\d{10}$/.test(newNumber.trim())}
            onClick={() => addMutation.mutate(newNumber.trim())}
          >
            {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add number'}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading pool…
          </div>
        ) : !data || data.numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="pool-empty">
            No numbers in the pool. With the flag ON and an empty pool, sends fall back to the
            default sender (and log a <code>local_presence_unconfigured</code> event).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="pool-table">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3">Number</th>
                  <th className="py-1 pr-3">Area</th>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 pr-3">Sent today</th>
                  <th className="py-1 pr-3">Guard (rotation)</th>
                  <th className="py-1 pr-3">Carrier ceiling</th>
                  <th className="py-1 pr-3">Effective</th>
                  <th className="py-1 pr-3">Remaining</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.numbers.map((n) => (
                  <tr key={n.phoneNumber} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-mono">{n.phoneNumber}</td>
                    <td className="py-1 pr-3">{n.areaCode}</td>
                    <td className="py-1 pr-3">{n.numberType}</td>
                    <td className="py-1 pr-3">{n.sentToday}</td>
                    <td className="py-1 pr-3">{n.cap.rotationCap}</td>
                    <td className="py-1 pr-3">{n.cap.carrierCap.toLocaleString()}</td>
                    <td className="py-1 pr-3 font-medium">
                      {n.cap.effective}
                      <span className="ml-1 text-xs text-muted-foreground">({n.cap.limitedBy})</span>
                    </td>
                    <td className="py-1 pr-3">{n.remaining}</td>
                    <td className="py-1">
                      {!n.active ? (
                        <Badge variant="secondary">inactive</Badge>
                      ) : n.remaining === 0 ? (
                        <Badge variant="destructive">capped</Badge>
                      ) : (
                        <Badge variant="outline">ok</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
