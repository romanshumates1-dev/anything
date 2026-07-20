"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { SidebarProvider, Sidebar, SidebarInset, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import DemoModeBanner from "@/components/DemoModeBanner";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();

  // Health
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      const res = await fetch("/api/system/health");
      if (!res.ok) throw new Error("Failed to fetch health");
      return res.json();
    },
    // render client-only
    staleTime: 30_000,
  });

  // Campaigns to detect any Test Mode (optional endpoint, fallback safe)
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const res = await fetch("/api/campaigns");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
    retry: 0,
  });

  const anyTest = Array.isArray(campaigns) && campaigns.some((c: any) => c.test_mode === true || c.testMode === true);

  // Pending approvals count (best-effort)
  const { data: approvals } = useQuery({
    queryKey: ["approvals-count"],
    queryFn: async () => {
      const res = await fetch("/api/approvals/count");
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    retry: 0,
  });

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) {
    // Let pages handle redirect; show nothing client-side when unauthenticated
    return <>{children}</>;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex bg-gray-50">
        <Sidebar side="left" variant="sidebar" collapsible="icon">
          <div className="p-3">
            <SidebarHeader>
              <div className="text-lg font-semibold">DealFlow AI</div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Navigation</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/dashboard">Dashboard</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/campaigns">Campaigns</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/inbox">Conversations</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/approvals">
                        <span>
                          Approvals {approvals?.count ? <Badge>{approvals.count}</Badge> : null}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/leads">Contacts</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/crm">CRM</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/lead-finder">Lead Finder</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/contracts">Contracts</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/analytics">Analytics</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/settings/users">Users</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/settings">Settings</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link href="/health">System Health</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
          </div>
        </Sidebar>

        <SidebarInset className="flex-1">
          <header className="sticky top-0 z-20 bg-white border-b">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex h-16 items-center justify-between">
                <div className="flex items-center gap-4">
                  {healthLoading ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      <span className="text-sm text-gray-500">Checking system</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`inline-block h-3 w-3 rounded-full ${health?.status === 'healthy' ? 'bg-green-500' : 'bg-amber-500'}`}
                      />
                      <span className="text-sm text-gray-600">{health?.status ?? 'unknown'}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {anyTest && (
                    <div className="bg-amber-100 text-amber-800 px-3 py-1 rounded font-semibold">TEST MODE</div>
                  )}

                  <div className="text-sm text-gray-600">{session?.user?.email}</div>
                </div>
              </div>
            </div>
          </header>

          <DemoModeBanner />
          <main className="py-6">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">{children}</div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
