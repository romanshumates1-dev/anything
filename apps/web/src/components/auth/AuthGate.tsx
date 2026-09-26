/**
 * AuthGate — central guard for authenticated client pages.
 *
 * Replaces the 29+ copy-pasted `if (!session) redirect('/account/signin')`
 * blocks with one behavior:
 *
 *   loading (isPending)        → spinner
 *   transient fetch error      → retry state (NOT a redirect — auth state is
 *                                UNKNOWN, and bouncing to signin is the
 *                                "random sign-out" bug)
 *   genuinely signed out       → redirect('/account/signin')
 *                                (data:null + error:null)
 *   authenticated              → render children
 *
 * Pages keep their own data fetching; this gate only owns the auth decision.
 * Server components (async pages calling auth.api.getSession directly) are
 * unaffected — their session read is authoritative, not a client fetch.
 */
'use client';

import { Loader2 } from 'lucide-react';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/auth-client';

export function AuthGate({ children }: { children: ReactNode }) {
  const { data: session, isPending, isSessionError, retrySession } = useSession();

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (isSessionError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-gray-500">
          Couldn&apos;t verify your session. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={retrySession}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  return <>{children}</>;
}
