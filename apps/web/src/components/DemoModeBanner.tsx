'use client';

/**
 * Phase T — persistent amber DEMO-MODE banner. Shows only when the `twilioDemo`
 * flag is ON. Copy states the safety property plainly (allowlist-only), so the
 * "cheaper/higher-limit" framing is an informed choice, not a false promise.
 */
import { useQuery } from '@tanstack/react-query';

export default function DemoModeBanner() {
  const { data } = useQuery<{ flags: Record<string, boolean> }>({
    queryKey: ['beta-flags'],
    queryFn: async () => {
      const res = await fetch('/api/settings/beta-flags');
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
  });

  if (!data?.flags?.twilioDemo) return null;

  return (
    <div
      data-testid="demo-mode-banner"
      className="w-full bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
      role="status"
    >
      DEMO MODE — messages deliver only to your verified numbers. There is no cheap A2P bypass;
      demo is allowlist-only.
    </div>
  );
}
