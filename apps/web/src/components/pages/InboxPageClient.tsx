'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageSquare, ArrowLeft, AlertTriangle } from 'lucide-react';

export default function InboxPageClient() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await fetch('/api/conversations');
      if (!res.ok) throw new Error('Failed to fetch conversations');
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
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Inbox</h1>
        </header>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Conversations</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin opacity-30" />
              </div>
            ) : !conversations || conversations.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>No conversations yet. Launch a campaign to start messaging.</p>
              </div>
            ) : (
              <div className="divide-y">
                {conversations.map((c: any) => (
                  <Link
                    key={c.id}
                    href={`/inbox/${c.lead_id}`}
                    className="flex items-center justify-between py-4 hover:bg-gray-50 -mx-2 px-2 rounded"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{c.lead_name}</span>
                        {c.requires_human && (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" /> Needs review
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 truncate">{c.last_message || '—'}</p>
                    </div>
                    <span className="text-xs text-gray-400 capitalize ml-4 shrink-0">
                      {c.channel}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
