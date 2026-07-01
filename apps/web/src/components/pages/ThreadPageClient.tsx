'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, AlertTriangle } from 'lucide-react';

export default function ThreadPageClient({ leadId }: { leadId: string }) {
  const { data: session, isPending: authLoading } = useSession();

  const { data: conv, isLoading } = useQuery({
    queryKey: ['conversation', leadId],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${leadId}`);
      if (!res.ok) throw new Error('Failed to fetch conversation');
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

  const history = conv?.history || [];

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <Link href="/inbox" className="text-sm text-gray-500 flex items-center gap-1 mb-2">
            <ArrowLeft className="h-4 w-4" /> Inbox
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {conv?.lead_name || 'Conversation'}
            </h1>
            {conv?.requires_human && (
              <Badge
                variant="outline"
                className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
              >
                <AlertTriangle className="h-3 w-3 mr-1" /> Needs review
              </Badge>
            )}
          </div>
          {conv?.lead_phone && <p className="text-sm text-gray-500">{conv.lead_phone}</p>}
        </header>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <CardTitle>Thread</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin opacity-30" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-center text-gray-400 py-8">No messages yet.</p>
            ) : (
              <div className="space-y-3">
                {history.map((m: any, i: number) => {
                  const isOutbound = m.role === 'assistant';
                  return (
                    <div key={i} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                          isOutbound
                            ? 'bg-blue-600 text-white rounded-br-sm'
                            : 'bg-gray-100 text-gray-900 rounded-bl-sm'
                        }`}
                      >
                        <p className="text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
                          {isOutbound ? 'Sent' : 'Reply'}
                        </p>
                        {m.content}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
