'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Users, ArrowLeft } from 'lucide-react';

export default function LeadsPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: leads, isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: async () => {
      const res = await fetch('/api/leads');
      if (!res.ok) throw new Error('Failed to fetch leads');
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
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <Link href="/" className="text-sm text-gray-500 flex items-center gap-1 mb-2">
              <ArrowLeft className="h-4 w-4" /> Dashboard
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Leads</h1>
          </div>
          <Link href="/leads/import">
            <Button className="py-6 px-6">Import Leads</Button>
          </Link>
        </header>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>All Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin opacity-30" />
              </div>
            ) : !leads || leads.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>No leads yet. Import your first lead to get started.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead: any) => (
                    <TableRow key={lead.id}>
                      <TableCell className="font-medium">{lead.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {lead.type}
                        </Badge>
                      </TableCell>
                      <TableCell>{lead.phone || '—'}</TableCell>
                      <TableCell className="capitalize text-gray-500">{lead.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
