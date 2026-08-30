"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useSession, signOut } from "@/lib/auth-client";
import { StatusDot } from "@/components/ui/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Loader2, LayoutDashboard, Megaphone, Search, Users, MessageSquare, FileText, CheckCircle, BarChart3, Calendar, Activity, Settings, ChevronDown, UserCog, TrendingUp, Filter, Wallet, Shield, LogOut, CreditCard, Trophy, Award, Sparkles, Zap, User } from "lucide-react";
import DemoModeBanner from "@/components/DemoModeBanner";

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/lead-finder', label: 'Lead Finder', icon: Search },
  { href: '/leads', label: 'Contacts', icon: Users },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/contracts', label: 'Contracts', icon: FileText },
  { href: '/payouts', label: 'Payouts', icon: Wallet },
  { href: '/approvals', label: 'Approvals', icon: CheckCircle, badge: true },
  { type: 'separator' as const },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/analytics/advanced', label: 'CRM Analytics', icon: TrendingUp },
  { href: '/funnel', label: 'Funnel', icon: Filter },
  { href: '/campaigns/planner', label: 'Planner', icon: Calendar },
  { type: 'separator' as const },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/achievements', label: 'Achievements', icon: Award },
  { type: 'separator' as const },
  { href: '/system-health', label: 'System Health', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
  { type: 'admin-separator' as const },
  { href: '/admin', label: 'Admin Panel', icon: Shield, adminOnly: true },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      router.push("/");
    } catch (error) {
      console.error("Sign out failed:", error);
      setIsSigningOut(false);
    }
  }, [router]);

  // Fetch subscription info for user menu
  const { data: subscription } = useQuery({
    queryKey: ["user-subscription"],
    queryFn: async () => {
      const res = await fetch("/api/subscriptions");
      if (!res.ok) return null;
      return res.json();
    },
    retry: 0,
    enabled: !!session,
  });

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
            // Handle admin separator - only show if user is admin
            // Cast user to include role field (defined in auth config additionalFields)
            const userWithRole = session?.user as { role?: string } | undefined;
            if (item.type === 'admin-separator') {
              if (userWithRole?.role !== 'ADMIN') return null;
              return (
                <div key={idx} className="my-4">
                  <div className="border-t border-[var(--border-subtle)]" />
                  <div className="mt-3 mb-2 px-3">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-purple)]">
                      Admin
                    </span>
                  </div>
                </div>
              );
            }
            if (item.type === 'separator') {
              return <div key={idx} className="my-4 border-t border-[var(--border-subtle)]" />;
            }
            // Skip admin-only items for non-admins
            if (item.adminOnly && userWithRole?.role !== 'ADMIN') {
              return null;
            }
            const Icon = item.icon!;
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            const isAdminItem = item.adminOnly;
            return (
              <Link
                key={item.href}
                href={item.href!}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? isAdminItem
                      ? 'bg-[var(--accent-purple)]/10 text-[var(--accent-purple)] border-l-2 border-[var(--accent-purple)] -ml-[2px] pl-[14px]'
                      : 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-l-2 border-[var(--accent-blue)] -ml-[2px] pl-[14px]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <Icon className={`h-5 w-5 ${isAdminItem && !isActive ? 'text-[var(--accent-purple)]/70' : ''}`} />
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
        <div className="p-3 border-t border-[var(--border-subtle)] relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          >
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
            <ChevronDown className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* User Dropdown Menu */}
          {userMenuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg shadow-lg overflow-hidden z-50">
              {/* User Info Header */}
              <div className="px-4 py-3 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent-blue)] to-[var(--accent-purple)] flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {session.user?.email?.[0]?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {session.user?.name || session.user?.email?.split('@')[0]}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{session.user?.email}</p>
                  </div>
                  {(session.user as { role?: string })?.role && (
                    <Badge className={`text-xs ${(session.user as { role?: string })?.role === 'ADMIN' ? 'bg-[var(--accent-purple)]/20 text-[var(--accent-purple)]' : 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'}`}>
                      {(session.user as { role?: string })?.role}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Profile Link */}
              <Link
                href="/profile"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <User className="h-4 w-4" />
                <span>View Profile</span>
              </Link>

              {/* Subscription & Credits */}
              <div className="px-4 py-2.5 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-muted)]">Subscription</span>
                  <Badge className="text-xs bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]">
                    {subscription?.plan_name || subscription?.tier || 'Free'}
                  </Badge>
                </div>
                {subscription?.limits?.credits !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Credits</span>
                    <span className="text-xs font-medium text-[var(--text-secondary)]">
                      <CreditCard className="h-3 w-3 inline mr-1" />
                      {subscription.limits.credits.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Separator */}
              <div className="border-t border-[var(--border-subtle)]" />

              {/* Gamification Links */}
              <Link
                href="/leaderboard"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Trophy className="h-4 w-4" />
                <span>Leaderboard</span>
              </Link>
              <Link
                href="/achievements"
                onClick={() => setUserMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Award className="h-4 w-4" />
                <span>Achievements</span>
              </Link>

              {/* Separator */}
              <div className="border-t border-[var(--border-subtle)]" />

              {/* Sign Out */}
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors disabled:opacity-50"
              >
                {isSigningOut ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Signing out...</span>
                  </>
                ) : (
                  <>
                    <LogOut className="h-4 w-4" />
                    <span>Sign Out</span>
                  </>
                )}
              </button>
            </div>
          )}
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
