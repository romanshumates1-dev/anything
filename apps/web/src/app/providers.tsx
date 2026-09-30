'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useState } from 'react';
import { AccessibilityProvider } from '@/components/AccessibilityProvider';

// Create a client that persists across re-renders
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

export function Providers({ children }: { children: ReactNode }) {
  // Initialize query client once
  const [queryClient] = useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {/*
        Mounted at the ROOT so accessibility applies app-wide, including the
        marketing pages (which render outside <Shell>) and the settings screen
        itself - a dyslexic user must be able to read the control they used to
        turn the setting on.
      */}
      <AccessibilityProvider>
        {children}
        <Toaster position="bottom-right" />
      </AccessibilityProvider>
    </QueryClientProvider>
  );
}
