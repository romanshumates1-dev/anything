'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageSquare, User, Bot } from 'lucide-react';
import Link from 'next/link';

export default function InboxPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await fetch('/api/conversations');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Conversations</h1>
          <p className="text-gray-500 mt-1">Live SMS threads with contacts</p>
        </header>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin opacity-30" />
          </div>
        ) : !conversations || conversations.length === 0 ? (
          <Card className="border-none shadow-sm">
            <CardContent className="py-12 text-center">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500">No conversations yet.</p>
              <p className="text-sm text-gray-400 mt-1">Launch a campaign to start routing replies.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {conversations.map((conv: any) => (
              <Link key={conv.id} href={`/inbox/${conv.lead_id}`}>
                <Card className="border-none shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center">
                          <User className="h-5 w-5 text-gray-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{conv.lead_name || 'Unknown'}</p>
                          <p className="text-sm text-gray-500">{conv.phone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {conv.last_sender === 'ai' && <Bot className="h-4 w-4 text-blue-600" />}
                        {conv.last_sender === 'human' && <User className="h-4 w-4 text-green-600" />}
                        <Badge variant="outline" className={
                          conv.status === 'active' ? 'bg-green-50 text-green-700' :
                          conv.status === 'requires_human' ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-50 text-gray-600'
                        }>
                          {conv.status}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-1">{conv.last_message || 'No messages yet'}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}