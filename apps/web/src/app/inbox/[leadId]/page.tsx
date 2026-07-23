'use client';

import { useState, useEffect, use } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ArrowLeft, Send, Pause, Play, User, Bot, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import NegotiationPanel from '@/components/negotiation/NegotiationPanel';

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  status: string;
  text?: string;
  created_at: string;
  to_phone: string;
}

export default function InboxThreadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = use(params);
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [aiPaused, setAiPaused] = useState(false);

  const { data: messages, isLoading } = useQuery({
    queryKey: ['conversation', leadId],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/thread/${leadId}`);
      if (!res.ok) throw new Error('Failed to load conversation');
      return res.json() as Promise<Message[]>;
    },
    enabled: !!session,
    refetchInterval: 2000, // Live updates every 2s
  });

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch('/api/conversations/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: leadId, message: text, channel: 'sms' }),
      });
      if (!res.ok) throw new Error('Failed to send');
      return res.json();
    },
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['conversation', leadId] });
    },
  });

  const toggleAi = async () => {
    await fetch(`/api/leads/${leadId}/ai`, { method: 'POST' });
    setAiPaused(!aiPaused);
  };

  useEffect(() => {
    if (!session) redirect('/account/signin');
  }, [session]);

  if (authLoading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/inbox" className="text-sm text-gray-500 flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to Inbox
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={toggleAi}>
              {aiPaused ? <><Play className="h-4 w-4 mr-1" /> Resume AI</> : <><Pause className="h-4 w-4 mr-1" /> Pause AI</>}
            </Button>
          </div>
        </div>

        {/* Phase A.4: bounded AI negotiation panel (renders only when the flag is on) */}
        <NegotiationPanel leadId={leadId} />

        <Card>
          <CardContent className="p-4 space-y-3">
            {messages?.length === 0 && (
              <Alert>
                <AlertDescription>No messages yet. Start the conversation.</AlertDescription>
              </Alert>
            )}

            {messages?.map((msg) => (
              <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] rounded-lg p-3 ${msg.direction === 'outbound' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={msg.direction === 'outbound' ? 'secondary' : 'outline'} className="text-xs">
                      {msg.direction === 'outbound' ? <><Bot className="h-3 w-3 mr-1" /> Sent</> : <><User className="h-3 w-3 mr-1" /> Received</>}
                    </Badge>
                    {msg.status === 'BLOCKED_TEST_MODE' && (
                      <Badge variant="destructive" className="text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Blocked
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm">{msg.text || '(no content)'}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {new Date(msg.created_at).toLocaleString()} · To: {msg.to_phone}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a message..."
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && message.trim() && sendMutation.mutate(message)}
          />
          <Button onClick={() => message.trim() && sendMutation.mutate(message)} disabled={sendMutation.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}