"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { StatusDot } from "@/components/ui/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Loader2, LayoutDashboard, Megaphone, Search, Users, MessageSquare, FileText, CheckCircle, BarChart3, Calendar, Activity, Settings, ChevronDown, UserCog, TrendingUp, Filter } from "lucide-react";
import DemoModeBanner from "@/components/DemoModeBanner";

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/lead-finder', label: 'Lead Finder', icon: Search },
  { href: '/leads', label: 'Contacts', icon: Users },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/approvals', label: 'Approvals', icon: CheckCircle, badge: true },
  { type: 'separator' as const },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/analytics/advanced', label: 'CRM Analytics', icon: TrendingUp },
  { href: '/funnel', label: 'Funnel', icon: Filter },
  { href: '/campaigns/planner', label: 'Planner', icon: Calendar },
  { href: '/system-health', label: 'System Health', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/settings/users', label: 'Users', icon: UserCog },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();

  const { data: health } = useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      const res = await fetch("/api/system/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
    staleTime: 30_000,
    enabled: !!session,
  });

  const { data: approvals } = useQuery({
    queryKey: ["approvals-count"],
    queryFn: async () => {
      const res = await fetch("/api/approvals/count");
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    retry: 0,
    enabled: !!session,
  });

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex bg-[var(--bg-primary)]">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
              <span className="text-white font-bold text-sm">DF</span>
            </div>
            <span className="text-lg font-semibold text-[var(--text-primary)]">DealFlow AI</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item, idx) => {
            if (item.type === 'separator') {
              return <div key={idx} className="my-4 border-t border-[var(--border-subtle)]" />;
            }
            const Icon = item.icon!;
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href!}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-l-2 border-[var(--accent-blue)] -ml-[2px] pl-[14px]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
                {item.badge && approvals?.count > 0 && (
                  <Badge className="ml-auto bg-[var(--color-error)] text-white text-xs px-1.5 py-0.5">
                    {approvals.count}
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Usage Meter */}
        <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[var(--text-muted)]">SMS Usage</span>
            <span className="text-[var(--text-secondary)]">75%</span>
          </div>
          <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div className="h-full w-3/4 bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full" />
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">Pro Plan</p>
        </div>

        {/* User Menu */}
        <div className="p-3 border-t border-[var(--border-subtle)]">
          <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {session.user?.email?.[0]?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {session.user?.name || session.user?.email?.split('@')[0]}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">{session.user?.email}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-6 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <StatusDot status={health?.status === 'healthy' ? 'success' : 'warning'} />
            <span className="text-sm text-[var(--text-secondary)]">
              {health?.status === 'healthy' ? 'All systems operational' : 'System degraded'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/campaigns/wizard"
              className="btn-gradient px-4 py-2 rounded-lg text-sm font-medium"
            >
              Launch Campaign
            </Link>
          </div>
        </header>

        <DemoModeBanner />

        {/* Page Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
