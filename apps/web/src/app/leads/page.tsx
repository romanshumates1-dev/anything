'use client';

import { useSession } from '@/lib/auth-client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Download, RefreshCw } from 'lucide-react';
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
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Contacts & Buyers</h1>
          <p className="text-gray-500 mt-1">Manage leads, buyers, and sellers</p>
        </header>

        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <Link href="/leads/import">
              <Button>Import Contacts</Button>
            </Link>
            <Button variant="outline" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
              <Download className="h-4 w-4 mr-1" />
              {exportMutation.isPending ? 'Exporting…' : 'Export CSV'}
            </Button>
          </div>
          <Button variant="ghost" onClick={() => queryClient.invalidateQueries({ queryKey: ['leads'] })}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin opacity-30" />
          </div>
        ) : !leads || leads.length === 0 ? (
          <Card className="border-none shadow-sm">
            <CardContent className="py-12 text-center">
              <Users className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No contacts yet.</p>
              <Link href="/leads/import">
                <Button className="mt-4">Import Your First List</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {leads.map((lead: any) => (
              <Card key={lead.id} className="border-none shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{lead.name}</CardTitle>
                    <Badge variant="outline" className={
                      lead.type === 'seller' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                    }>
                      {lead.type}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-sm text-gray-500">{lead.phone || 'No phone'}</p>
                  <p className="text-sm text-gray-500">{lead.email || 'No email'}</p>
                  <div className="flex items-center justify-between pt-2">
                    <Badge variant="outline" className="text-xs">{lead.status || 'new'}</Badge>
                    <Link href={`/inbox?leadId=${lead.id}`}>
                      <Button size="sm" variant="ghost">View Thread</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}