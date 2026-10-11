'use client';

/**
 * REQUIREMENT SET V3 — crate shop UI: open earned crates, collect cosmetics,
 * equip one. roman.agent.md 1276 asks for "optional crates/rewards" and 1275
 * "dashboard skins"; the cosmetics dropped here are exactly those skins/frames/
 * badges. They are cosmetic-only and never convert to money or AI credits.
 *
 * HONESTY RULES THIS PAGE ENFORCES (mirrors app/rewards)
 * ------------------------------------------------------
 * 1. NOTHING HERE CONVERTS TO MONEY. Every reward shown is a cosmetic key or
 *    XP. No cash value, credit amount, or "expected return" is ever rendered.
 * 2. CRATES ARE EARNED, NOT BOUGHT. There is no purchase path on this page —
 *    a crate can only be opened once per day and the server enforces it. The
 *    UI merely reflects `canOpen` from the API.
 * 3. Gamification OFF renders as "turned off", not a generic failure: the
 *    API returns 404 (not 403) so the feature's existence is not disclosed.
 * 4. Server is authoritative. `canOpen`, the dropped cosmetic and `xpAwarded`
 *    all come from the API; this page never recomputes or guesses them. A
 *    mutation refetches rather than optimistically inventing a result, so the
 *    UI can never claim a prize the backend refused.
 */
import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { MetricValue } from '@/components/ui/MetricValue';
import { cosmeticFor } from '@/app/api/utils/crates';
import { Loader2, Package, Sparkles, CheckCircle2, Info } from 'lucide-react';

interface AvailableCrate {
  key: string;
  name: string;
  canOpen: boolean;
  opensToday: number;
}

interface InventoryItem {
  cosmeticKey: string;
  rarity: string;
  isEquipped: boolean;
}

interface CratesData {
  availableCrates: AvailableCrate[];
  inventory: InventoryItem[];
  equipped: InventoryItem[];
  xp: number;
}

interface OpenResult {
  cosmeticKey: string;
  cosmeticName: string;
  rarity: string;
  xpAwarded: number;
}

/**
 * Read an error response's JSON body without swallowing a parse failure —
 * identical contract to `app/rewards/page.tsx`: a non-JSON body is logged, not
 * hidden, so a proxy/502 is diagnosable instead of masquerading as the API.
 */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error || fallback;
  } catch (cause) {
    console.error(`[crates] non-JSON error body (HTTP ${res.status})`, cause);
    return fallback;
  }
}

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/crates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, 'Request failed'));
  }
  return res.json();
}

type CrateAction = { action: 'open'; crateKey: string } | { action: 'equip'; cosmeticKey: string };

export default function CratesPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [lastDrop, setLastDrop] = useState<OpenResult | null>(null);

  const {
    data: crates,
    isLoading,
    error,
  } = useQuery<CratesData>({
    queryKey: ['crates'],
    queryFn: async () => {
      const res = await fetch('/api/crates');
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'Crates are turned off for your account.'
            : await errorMessage(res, 'Could not load your crates.'),
        );
      }
      return res.json();
    },
    enabled: !!session,
    retry: false,
  });

  const act = useMutation({
    mutationFn: (variables: CrateAction) => post(variables),
    onSuccess: async (result, variables) => {
      if (variables.action === 'open') {
        setLastDrop(result as OpenResult);
      }
      await queryClient.invalidateQueries({ queryKey: ['crates'] });
    },
  });

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">Crates</h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          Open earned crates to collect cosmetics — avatar frames, badges and
          dashboard skins. Rewards are cosmetic and experience-based; they never
          convert to money or AI credits.
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : error ? (
        <GlassCard className="py-12 text-center">
          <p className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
            {error instanceof Error ? error.message : 'Could not load your crates.'}
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            You can turn crates back on in Settings → Preferences.
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <GlassCard className="text-center">
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Total XP
              </p>
              <MetricValue value={crates?.xp ?? 0} />
            </GlassCard>
            <GlassCard className="text-center">
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Cosmetics owned
              </p>
              <MetricValue value={crates?.inventory?.length ?? 0} />
            </GlassCard>
            <GlassCard className="text-center">
              <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Equipped
              </p>
              <MetricValue value={crates?.equipped?.[0] ? 1 : 0} />
            </GlassCard>
          </div>

          {/* Available crates — earned, one open per day, never purchasable. */}
          <GlassCard className="mb-6">
            <div className="mb-1 flex items-center gap-2">
              <Package className="h-5 w-5 text-[var(--accent-blue)]" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Available crates
              </h2>
            </div>
            <p className="mb-4 flex items-start gap-2 text-sm text-[var(--text-muted)]">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Crates are earned from your activity, not bought. Each crate can
                be opened once per day.
              </span>
            </p>
            {!crates?.availableCrates?.length ? (
              <p className="text-sm text-[var(--text-muted)]">
                No crates are available right now.
              </p>
            ) : (
              <ul className="space-y-2">
                {crates.availableCrates.map((crate) => (
                  <li
                    key={crate.key}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] p-3"
                  >
                    <p className="font-medium text-[var(--text-primary)]">{crate.name}</p>
                    <button
                      type="button"
                      disabled={act.isPending || !crate.canOpen}
                      onClick={() => act.mutate({ action: 'open', crateKey: crate.key })}
                      className="rounded-lg bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {crate.canOpen ? 'Open' : 'Opened today'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {lastDrop && (
            <GlassCard className="mb-6 flex items-center gap-3 border-[var(--accent-blue)]">
              <Sparkles className="h-6 w-6 text-[var(--accent-blue)]" />
              <div>
                <p className="font-semibold text-[var(--text-primary)]">
                  You unboxed {lastDrop.cosmeticName}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  {lastDrop.rarity} · +{lastDrop.xpAwarded} XP
                </p>
              </div>
            </GlassCard>
          )}

          {act.isError && (
            <p className="mb-6 text-sm text-red-400">
              {act.error instanceof Error ? act.error.message : 'That action failed.'}
            </p>
          )}

          {/* Inventory — equip one cosmetic (dashboard skin / frame / badge). */}
          <GlassCard>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[var(--accent-blue)]" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Your cosmetics
              </h2>
            </div>
            <p className="mb-4 text-sm text-[var(--text-muted)]">
              Equip one cosmetic to show it off. Equipping a new one replaces the
              previous choice.
            </p>
            {!crates?.inventory?.length ? (
              <p className="text-sm text-[var(--text-muted)]">
                You have not unboxed any cosmetics yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {crates.inventory.map((item) => {
                  const def = cosmeticFor(item.cosmeticKey);
                  return (
                    <li
                      key={item.cosmeticKey}
                      className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] p-3"
                    >
                      <div>
                        <p className="font-medium text-[var(--text-primary)]">
                          {def?.name ?? item.cosmeticKey}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {def?.description ?? item.rarity}
                        </p>
                      </div>
                      {item.isEquipped ? (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <CheckCircle2 className="h-4 w-4" /> Equipped
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={act.isPending}
                          onClick={() =>
                            act.mutate({ action: 'equip', cosmeticKey: item.cosmeticKey })
                          }
                          className="rounded-lg bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Equip
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
}
