'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, Rocket, Plus } from 'lucide-react';

function AddLeadsControl({ campaignId }: { campaignId: number }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const { data: leads } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const res = await fetch('/api/leads');
      if (!res.ok) throw new Error('Failed to fetch leads');
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (leadId: string) => {
      const res = await fetch(`/api/campaigns/${campaignId}/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: Number(leadId) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add lead');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setMsg(data.added > 0 ? 'Lead added.' : 'Lead already in campaign.');
      queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] });
    },
    onError: (err: any) => setMsg(err.message),
  });

  return (
    <div className="flex flex-col gap-2 mt-3">
      <div className="flex gap-2 items-center">
        <select
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a lead…</option>
          {(leads || []).map((l: any) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.type})
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || mutation.isPending}
          onClick={() => selected && mutation.mutate(selected)}
        >
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: any }) {
  const queryClient = useQueryClient();
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);

  const launch = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/outreach/campaigns/${campaign.id}/start`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to launch');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setLaunchMsg(`Started — status ${data.status}.`);
      queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] });
    },
    onError: (err: any) => setLaunchMsg(err.message),
  });

  const isLaunched = campaign.status === 'ACTIVE' || campaign.status === 'SCHEDULED';

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{campaign.name}</CardTitle>
        <div className="flex items-center gap-2">
          {campaign.test_mode && (
            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
              TEST
            </Badge>
          )}
          <Badge
            variant="outline"
            className={
              isLaunched
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-gray-50 text-gray-600 border-gray-200'
            }
          >
            {campaign.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500">{campaign.direction || '—'} · {campaign.status}</p>
        <p className="text-xs text-gray-400 mt-2">
          {campaign.total_contacts || 0} contacts
        </p>

        <AddLeadsControl campaignId={campaign.id} />

        <div className="flex items-center gap-3 mt-4">
          <Button size="sm" onClick={() => launch.mutate()} disabled={launch.isPending}>
            <Rocket className="h-4 w-4 mr-1" />
            {launch.isPending ? 'Launching…' : isLaunched ? 'Re-launch' : 'Launch Campaign'}
          </Button>
          {launchMsg && <span className="text-xs text-gray-500">{launchMsg}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CampaignsPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: campaigns, isLoading } = useQuery({
    // Distinct key from the Shell's ['campaigns'] (legacy /api/campaigns) so
    // React Query does not dedupe this outreach list against it.
    queryKey: ['outreach-campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <Link href="/" className="text-sm text-gray-500 flex items-center gap-1 mb-2">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Campaigns</h1>
        </header>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Create Campaign</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-500">The 4-step wizard is the one campaign-creation flow:</p>
            <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
              <li>Sending schedule & volume caps</li>
              <li>Follow-up sequences & AI toggles</li>
              <li>Compliance / DNC / Test Mode</li>
              <li>Budget cap & review</li>
            </ul>
            <Link href="/campaigns/wizard">
              <Button className="w-full">Open Campaign Wizard →</Button>
            </Link>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin opacity-30" />
            </div>
          ) : !campaigns || campaigns.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No campaigns yet.</p>
          ) : (
            campaigns.map((c: any) => <CampaignCard key={c.id} campaign={c} />)
          )}
        </div>
      </div>
    </div>
  );
}
