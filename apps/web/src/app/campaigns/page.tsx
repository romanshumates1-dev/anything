'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
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
      const res = await fetch(`/api/campaigns/${campaign.id}/launch`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to launch');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setLaunchMsg(`Launched — ${data.queued} queued, ${data.skipped} skipped.`);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err: any) => setLaunchMsg(err.message),
  });

  const isLaunched = campaign.status === 'launched';

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{campaign.name}</CardTitle>
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
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500 italic">&ldquo;{campaign.message_template}&rdquo;</p>
        <p className="text-xs text-gray-400 mt-2">
          {campaign.member_count || 0} members · {campaign.sent_count || 0} sent
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
  const queryClient = useQueryClient();

  const [form, setForm] = useState({ name: '', message_template: '' });
  const [error, setError] = useState<string | null>(null);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
    enabled: !!session,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create campaign');
      }
      return res.json();
    },
    onSuccess: () => {
      setForm({ name: '', message_template: '' });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err: any) => setError(err.message),
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
            <CardTitle>New Campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.name.trim() || !form.message_template.trim()) {
                  setError('Name and message template are required');
                  return;
                }
                create.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="cname">Campaign Name</Label>
                <Input
                  id="cname"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Q1 Outreach"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ctemplate">Message Template</Label>
                <Textarea
                  id="ctemplate"
                  value={form.message_template}
                  onChange={(e) => setForm((f) => ({ ...f, message_template: e.target.value }))}
                  placeholder="Hey, are you interested in selling your property?"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create Campaign'}
              </Button>
            </form>
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
