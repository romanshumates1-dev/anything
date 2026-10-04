'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Loader2, Search, MessageSquare, Mail, Phone, Send } from 'lucide-react';
import Link from 'next/link';

const channelTabs = [
  { id: 'all', label: 'All', icon: MessageSquare },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'phone', label: 'Phone', icon: Phone },
];

// "Unread" was removed: `GET /api/conversations` returns no read/unread state
// (there is no read-receipt column to filter on), so the filter could only ever
// have matched the mock rows. Needs-response and responded both map to the
// real `requires_human` flag.
const statusFilters = [
  { id: 'all', label: 'All' },
  { id: 'needs_response', label: 'Needs Response' },
  { id: 'responded', label: 'Responded' },
];

/**
 * Fabricated data, removed.
 *
 * This page previously fell back to four hardcoded rows ("John Smith",
 * "+1 (555) 123-4567") whenever the request failed OR simply returned nothing:
 *
 *     if (!res.ok) return mockConversations;
 *     return data.length > 0 ? data : mockConversations;
 *
 * That second clause was the damaging one. An account with zero conversations
 * is the normal case, and it rendered four strangers' fake conversations — so
 * an empty inbox looked populated and a backend outage was indistinguishable
 * from success. Empty now means empty; failure now means failure.
 */

/** One row from `GET /api/conversations`, which is organization-scoped. */
interface Conversation {
  id: number;
  lead_id: number;
  channel: string;
  status: string;
  requires_human: boolean;
  last_message_at: string | null;
  lead_name: string | null;
  lead_phone: string | null;
  last_message: string | null;
}

export default function InboxPage() {
  const { data: session, isPending } = useSession();
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedConv, setSelectedConv] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const { data: conversations, isLoading, isError, error } = useQuery<Conversation[]>({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await fetch('/api/conversations', { credentials: 'include' });
      if (!res.ok) throw new Error('Could not load your conversations.');
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
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

  // No mock fallback: an empty array is a real, correct empty inbox.
  const convList: Conversation[] = conversations ?? [];

  const filteredConversations = convList.filter((c) => {
    if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
    if (statusFilter === 'needs_response' && !c.requires_human) return false;
    if (statusFilter === 'responded' && c.requires_human) return false;
    return true;
  });

  const selectedConversation = convList.find((c) => c.id === selectedConv);

  // Thread messages come from the org-scoped endpoint, not from local mock state.
  const { data: thread, isLoading: threadLoading } = useQuery<{
    id: number;
    direction: string;
    status: string;
    provider: string | null;
    body: string | null;
    created_at: string;
  }[]>({
    queryKey: ['conversation-thread', selectedConversation?.lead_id],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/thread/${selectedConversation!.lead_id}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Could not load this conversation.');
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },
    enabled: !!selectedConversation,
  });

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
            ) : isError ? (
              // Previously any failure rendered four fake conversations, so an
              // outage looked like a working inbox full of strangers.
              <div className="py-8 text-center px-4">
                <p className="text-sm text-[var(--color-warning)]">
                  {error instanceof Error ? error.message : 'Could not load conversations.'}
                </p>
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
                      {conv.requires_human && (
                        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-[var(--accent-blue)] rounded-full border-2 border-[var(--bg-secondary)]" title="Needs response" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className={`text-sm font-medium ${conv.requires_human ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {conv.lead_name || 'Unknown'}
                        </p>
                        <span className="text-xs text-[var(--text-muted)]">
                          {conv.last_message_at
                            ? new Date(conv.last_message_at).toLocaleString()
                            : ''}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{conv.last_message}</p>
                      {conv.requires_human && (
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
                  <p className="text-sm text-[var(--text-muted)]">{selectedConversation.lead_phone}</p>
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
                {threadLoading ? (
                  <div className="py-8 flex justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-blue)]" />
                  </div>
                ) : !thread?.length ? (
                  <p className="text-sm text-[var(--text-muted)] text-center py-8">
                    No messages in this conversation yet.
                  </p>
                ) : (
                  thread.map((msg) => {
                    // `direction` is the ledger's own inbound/outbound flag; an
                    // outbound message is ours (sent), inbound is the contact.
                    const outbound = msg.direction === 'outbound';
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                            outbound
                              ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white'
                              : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                          }`}
                        >
                          <p className="text-sm break-words">
                            {msg.body ?? <span className="italic opacity-70">No message body recorded</span>}
                          </p>
                          <p
                            className={`text-xs mt-1 ${outbound ? 'opacity-70' : 'text-[var(--text-muted)]'}`}
                          >
                            {new Date(msg.created_at).toLocaleString()}
                            {msg.status ? ` · ${msg.status}` : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* The composer is intentionally DISABLED rather than wired up here.
                `POST /api/conversations/message` exists and works, but it
                enqueues real outbound SMS/email to a real contact, gated by
                consent checks and the AI-credit gate. Enabling it is a product
                decision that needs explicit approval, so the control states its
                own status instead of silently discarding what the user typed. */}
              <div className="p-4 border-t border-[var(--border-subtle)]">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    disabled
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Sending from this view isn't available yet."
                    title="Message sending from the inbox is not yet enabled."
                    aria-label="Compose a message (not yet available)"
                    className="flex-1 px-4 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-muted)] placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-70"
                  />
                  <button
                    disabled
                    aria-label="Send message (not yet available)"
                    title="Message sending from the inbox is not yet enabled."
                    className="btn-gradient px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
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
              <p className="text-sm text-[var(--text-muted)]">{selectedConversation.lead_phone}</p>
            </div>

            {/* Was hardcoded: Stage "Interested", Lead Score 85, Property
                "123 Main St, Miami FL" — the same for every conversation, and
                not backed by any field the API returns. Now shows the real
                status, and omits what genuinely is not known rather than
                inventing a value. */}
            <div className="space-y-3 py-4 border-t border-[var(--border-subtle)]">
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Channel</p>
                <p className="text-sm text-[var(--text-primary)] capitalize">
                  {selectedConversation.channel || 'unknown'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Status</p>
                <p className="text-sm text-[var(--text-primary)]">
                  {selectedConversation.status || 'unknown'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Needs Response</p>
                <p className="text-sm text-[var(--text-primary)]">
                  {selectedConversation.requires_human ? 'Yes' : 'No'}
                </p>
              </div>
            </div>

            {/* These three had no handler and never did anything. Removed rather
                than left as buttons that look actionable but are inert. */}
            <div className="space-y-2 pt-4 border-t border-[var(--border-subtle)]">
              <Link
                href={`/leads?id=${selectedConversation.lead_id}`}
                className="block w-full py-2 rounded-lg bg-[var(--bg-tertiary)] text-center text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
              >
                View Contact
              </Link>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
