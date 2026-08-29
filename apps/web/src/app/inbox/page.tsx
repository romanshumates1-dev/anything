'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Loader2, Search, MessageSquare, Mail, Phone, User, Bot, Send, Sparkles } from 'lucide-react';
import Link from 'next/link';

const channelTabs = [
  { id: 'all', label: 'All', icon: MessageSquare },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'phone', label: 'Phone', icon: Phone },
];

const statusFilters = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'needs_response', label: 'Needs Response' },
  { id: 'responded', label: 'Responded' },
];

const mockConversations = [
  { id: 1, lead_id: 1, lead_name: 'John Smith', phone: '+1 (555) 123-4567', last_message: 'Hi, I got your message about my property. What\'s your offer?', time: '2m ago', status: 'requires_human', channel: 'sms', unread: true, last_sender: 'contact' },
  { id: 2, lead_id: 2, lead_name: 'Sarah Johnson', phone: '+1 (555) 234-5678', last_message: 'That sounds interesting. Can you tell me more about the process?', time: '1h ago', status: 'requires_human', channel: 'sms', unread: true, last_sender: 'contact' },
  { id: 3, lead_id: 3, lead_name: 'Bob Wilson', phone: '+1 (555) 345-6789', last_message: 'Thanks, I\'ll think about it and get back to you.', time: '3h ago', status: 'active', channel: 'sms', unread: false, last_sender: 'ai' },
  { id: 4, lead_id: 4, lead_name: 'Jane Doe', phone: '+1 (555) 456-7890', last_message: 'Not interested at this time.', time: '1d ago', status: 'closed', channel: 'email', unread: false, last_sender: 'contact' },
];

const mockMessages = [
  { id: 1, sender: 'them', text: 'Hi, I got your message about my property at 123 Main St.', time: '10:23 AM' },
  { id: 2, sender: 'ai', text: 'Thanks for reaching out! Based on the current market, I can offer you a fair cash price. What condition is the property in?', time: '10:25 AM' },
  { id: 3, sender: 'them', text: 'It needs some work. The roof is old and the kitchen needs updating. What\'s your offer?', time: '10:28 AM' },
];

export default function InboxPage() {
  const { data: session, isPending } = useSession();
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedConv, setSelectedConv] = useState<number | null>(1);
  const [message, setMessage] = useState('');

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await fetch('/api/conversations');
      if (!res.ok) return mockConversations;
      const data = await res.json();
      return data.length > 0 ? data : mockConversations;
    },
    enabled: !!session,
  });

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const convList = conversations || mockConversations;

  const filteredConversations = convList.filter((c: any) => {
    if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
    if (statusFilter === 'unread' && !c.unread) return false;
    if (statusFilter === 'needs_response' && c.status !== 'requires_human') return false;
    if (statusFilter === 'responded' && c.status === 'requires_human') return false;
    return true;
  });

  const selectedConversation = convList.find((c: any) => c.id === selectedConv);

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-4">
      {/* Conversation List */}
      <div className="w-80 flex-shrink-0 flex flex-col">
        <GlassCard padding="none" className="flex-1 flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-[var(--border-subtle)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder="Search conversations..."
                className="w-full pl-9 pr-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          {/* Channel tabs */}
          <div className="flex border-b border-[var(--border-subtle)]">
            {channelTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setChannelFilter(tab.id)}
                className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  channelFilter === tab.id
                    ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Status filters */}
          <div className="flex gap-1 p-2 border-b border-[var(--border-subtle)]">
            {statusFilters.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={`px-2 py-1 text-xs rounded-full ${
                  statusFilter === f.id
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="py-8 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-blue)]" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-[var(--text-muted)]">No conversations</p>
              </div>
            ) : (
              filteredConversations.map((conv: any) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConv(conv.id)}
                  className={`w-full p-3 text-left border-b border-[var(--border-subtle)] transition-colors ${
                    selectedConv === conv.id ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
                        <span className="text-white font-medium text-sm">{conv.lead_name?.[0] || 'U'}</span>
                      </div>
                      {conv.unread && (
                        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--accent-blue)] rounded-full border-2 border-[var(--bg-secondary)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={`text-sm font-medium ${conv.unread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {conv.lead_name || 'Unknown'}
                        </p>
                        <span className="text-xs text-[var(--text-muted)]">{conv.time}</span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{conv.last_message}</p>
                      {conv.status === 'requires_human' && (
                        <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-xs bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                          <StatusDot status="warning" size="sm" />
                          Needs response
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </GlassCard>
      </div>

      {/* Message Thread */}
      <div className="flex-1 flex flex-col">
        <GlassCard padding="none" className="flex-1 flex flex-col overflow-hidden">
          {selectedConversation ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[var(--text-primary)]">{selectedConversation.lead_name}</p>
                  <p className="text-sm text-[var(--text-muted)]">{selectedConversation.phone}</p>
                </div>
                <Link
                  href={`/leads?id=${selectedConversation.lead_id}`}
                  className="text-sm text-[var(--accent-blue)] hover:underline"
                >
                  View Contact
                </Link>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {mockMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === 'them' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                        msg.sender === 'them'
                          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                          : 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                      }`}
                    >
                      {msg.sender === 'ai' && (
                        <div className="flex items-center gap-1 mb-1 text-xs opacity-70">
                          <Bot className="h-3 w-3" />
                          AI Generated
                        </div>
                      )}
                      <p className="text-sm">{msg.text}</p>
                      <p className={`text-xs mt-1 ${msg.sender === 'them' ? 'text-[var(--text-muted)]' : 'opacity-70'}`}>
                        {msg.time}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Smart replies */}
              <div className="px-4 py-2 border-t border-[var(--border-subtle)] flex gap-2 overflow-x-auto">
                <button className="px-3 py-1.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] whitespace-nowrap">
                  "I can offer $X based on..."
                </button>
                <button className="px-3 py-1.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] whitespace-nowrap">
                  "When can we schedule..."
                </button>
                <button className="px-3 py-1.5 rounded-full text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] whitespace-nowrap">
                  "Let me check and..."
                </button>
              </div>

              {/* Input */}
              <div className="p-4 border-t border-[var(--border-subtle)]">
                <div className="flex gap-2">
                  <button className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--accent-blue)]">
                    <Sparkles className="h-5 w-5" />
                  </button>
                  <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                  <button className="btn-gradient px-4 py-2 rounded-lg flex items-center gap-2">
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[var(--text-muted)]">Select a conversation to view</p>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Contact Panel */}
      {selectedConversation && (
        <div className="w-72 flex-shrink-0">
          <GlassCard className="h-full">
            <div className="text-center mb-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center mx-auto mb-3">
                <span className="text-white font-bold text-xl">{selectedConversation.lead_name?.[0] || 'U'}</span>
              </div>
              <p className="font-semibold text-[var(--text-primary)]">{selectedConversation.lead_name}</p>
              <p className="text-sm text-[var(--text-muted)]">{selectedConversation.phone}</p>
            </div>

            <div className="space-y-3 py-4 border-t border-[var(--border-subtle)]">
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Stage</p>
                <p className="text-sm text-[var(--text-primary)]">Interested</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Lead Score</p>
                <p className="text-sm font-mono text-[var(--color-success)]">85</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Property</p>
                <p className="text-sm text-[var(--text-primary)]">123 Main St, Miami FL</p>
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t border-[var(--border-subtle)]">
              <button className="w-full py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                Create Contract
              </button>
              <button className="w-full py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                Update Stage
              </button>
              <button className="w-full py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
                Add Note
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
