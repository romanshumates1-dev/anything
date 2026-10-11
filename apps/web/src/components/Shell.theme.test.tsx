// @vitest-environment jsdom
/**
 * Proves the equipped cosmetic theme GENUINELY reaches the DOM — the fix for
 * the "decorative control" gap where equipping a dashboard skin / sidebar theme
 * flipped a badge but changed nothing on screen.
 *
 * The Shell resolves the equipped theme via the pure cosmeticTheme mapping and
 * applies it as CSS custom properties on its root container, so the accent vars
 * cascade to every child. This test renders the real Shell with a mocked
 * `["crates"]` query and asserts the root container carries the theme's var.
 *
 * Isolated from Shell.test.tsx on purpose: that suite's global react-query mock
 * returns `undefined` for every key, so it cannot exercise the theme path.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const CRATE_DATA = {
  availableCrates: [],
  inventory: [],
  equipped: [{ cosmeticKey: 'dashboard-theme:nebula', rarity: 'rare', isEquipped: true }],
  xp: 0,
};

describe('Shell applies the equipped cosmetic theme to the root container', () => {
  beforeEach(() => {
    vi.doMock('@/lib/auth-client', () => ({
      useSession: () => ({ data: { user: { id: 'u1', email: 'a@b.co', name: 'A' } }, isPending: false }),
      signOut: vi.fn(),
    }));
    vi.doMock('next/navigation', () => ({
      usePathname: () => '/dashboard',
      useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    }));
    vi.doMock('@/lib/userPreferences', () => ({ useUserPreferences: () => ({ data: undefined }) }));
    vi.doMock('@tanstack/react-query', () => ({
      useQuery: (options: any) =>
        Array.isArray(options?.queryKey) && options.queryKey[0] === 'crates'
          ? { data: CRATE_DATA, isLoading: false, error: null }
          : { data: undefined, isLoading: false, error: null },
      useQueryClient: () => ({ invalidateQueries: vi.fn() }),
      QueryClient: class {},
      QueryClientProvider: ({ children }: any) => children,
    }));
    vi.doMock('@/components/DemoModeBanner', () => ({ __esModule: true, default: () => null }));
    vi.doMock('@/components/SupportChat', () => ({ __esModule: true, default: () => null }));
    vi.doMock('@/components/feedback', () => ({ FeedbackButton: () => null }));
    vi.doMock('@/components/billing', () => ({
      UsageMeterSidebar: () => null,
      FreePlanBadge: () => null,
      CreditBalanceInline: () => null,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock('@/lib/auth-client');
    vi.doUnmock('next/navigation');
    vi.doUnmock('@/lib/userPreferences');
    vi.doUnmock('@tanstack/react-query');
    vi.doUnmock('@/components/DemoModeBanner');
    vi.doUnmock('@/components/SupportChat');
    vi.doUnmock('@/components/feedback');
    vi.doUnmock('@/components/billing');
  });

  it('sets the theme accent CSS variable on the root container', async () => {
    const { default: FreshShell } = await import('./Shell');
    const { container } = render(<FreshShell>child</FreshShell>);
    const root = container.querySelector('.min-h-screen') as HTMLElement;
    expect(root).not.toBeNull();
    // nebula's --accent-blue from cosmeticTheme.ts
    expect(root.style.getPropertyValue('--accent-blue')).toBe('#7c3aed');
  });
});
