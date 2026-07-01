'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ArrowLeft, Upload } from 'lucide-react';

export default function ImportLeadPageClient() {
  const { data: session, isPending: authLoading } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    type: 'seller',
    phone: '',
    email: '',
    source: 'direct',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ---- Bulk import state ----
  const [bulkText, setBulkText] = useState('');
  const [bulkSource, setBulkSource] = useState<'csv' | 'paste'>('paste');
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/leads/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bulkText, source: bulkSource }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Bulk import failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setBulkResult(data);
      setBulkError(null);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: any) => {
      setBulkResult(null);
      setBulkError(err.message);
    },
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBulkText(String(reader.result || ''));
      setBulkSource('csv');
    };
    reader.readAsText(file);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create lead');
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess(true);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: any) => {
      setSuccess(false);
      setError(err.message);
    },
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

  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-xl mx-auto space-y-6">
        <header>
          <Link href="/leads" className="text-sm text-gray-500 flex items-center gap-1 mb-2">
            <ArrowLeft className="h-4 w-4" /> Leads
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Import Leads</h1>
        </header>

        {/* ---- Bulk import card ---- */}
        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-blue-600" /> Bulk Import (CSV / Paste)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csvfile">Upload CSV file (max 10,000 rows)</Label>
              <Input
                id="csvfile"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pastebox">…or paste rows (name,phone,email,type)</Label>
              <Textarea
                id="pastebox"
                rows={6}
                value={bulkText}
                onChange={(e) => {
                  setBulkText(e.target.value);
                  setBulkSource('paste');
                }}
                placeholder={
                  'name,phone,email,type\nAcme Test LLC,+15555550100,acme@test.com,seller'
                }
              />
            </div>
            {bulkError && <p className="text-sm text-red-600">{bulkError}</p>}
            {bulkResult && (
              <div className="text-sm rounded-md bg-gray-50 border p-3 text-gray-700">
                <p>
                  Imported <strong>{bulkResult.inserted}</strong> · Duplicates{' '}
                  <strong>{bulkResult.duplicates}</strong> · Failed{' '}
                  <strong>{bulkResult.failed}</strong> of {bulkResult.totalRows} rows.
                </p>
              </div>
            )}
            <Button
              type="button"
              disabled={!bulkText.trim() || bulkMutation.isPending}
              onClick={() => bulkMutation.mutate()}
            >
              {bulkMutation.isPending ? 'Importing…' : 'Import Bulk Leads'}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>New Lead</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!form.name.trim()) {
                  setError('Name is required');
                  return;
                }
                mutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Acme Test LLC"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.type}
                  onChange={(e) => update('type', e.target.value)}
                >
                  <option value="seller">Seller</option>
                  <option value="buyer">Buyer</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  placeholder="+15555550100"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  placeholder="acme@test.com"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {success && (
                <p className="text-sm text-green-600">
                  Lead created.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => router.push('/campaigns')}
                  >
                    Go to campaigns
                  </button>
                </p>
              )}

              <div className="flex gap-3">
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Saving…' : 'Create Lead'}
                </Button>
                <Link href="/leads">
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
