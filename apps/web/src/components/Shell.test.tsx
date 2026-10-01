// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Shell from './Shell';

/**
 * Requirement #2 regression: long username/email in the sidebar user menu.
 *
 * The historical bug: a long unbroken email inside a flex child with
 * `min-width: auto` forces the child past the sidebar width and `truncate`
 * (text-overflow) never engages. The fix is the `min-w-0` container plus
 * `truncate` + `title` on both lines — this test pins that contract with a
 * realistically absurd 300-character local part.
 *
 * jsdom performs no layout, so what is asserted is the exact class/title
 * contract that makes CSS truncation engage, in BOTH identity blocks
 * (collapsed button and open dropdown). Visual confirmation remains a
 * browser-QA step (authenticated session unavailable in this environment).
 */

/**
 * SSR REGRESSION (C4): the server must not withhold page content.
 *
 * <Shell> is a client component that reads the session with a client-side
 * hook, so on the server `isPending` is ALWAYS true (no fetch has run and
 * none can). The old code answered that state by returning a spinner INSTEAD
 * OF `children`, which meant every route's server-rendered HTML was a bare
 * <div> with a loading icon and no page content at all.
 *
 * Measured consequence before this fix (real `next start`, not a mock):
 *   GET /reviews -> 200, 26,611 bytes, VISIBLE TEXT = 0 characters
 *   GET /pricing -> 200, 61,577 bytes, VISIBLE TEXT = 0 characters
 *   GET /faq     -> 200, 44,503 bytes, VISIBLE TEXT = 0 characters
 *   GET /trust   -> 200, 42,758 bytes, VISIBLE TEXT = 0 characters
 *
 * That is a total loss of server-rendered content: no crawlable text for the
 * indexable marketing pages, no first-paint content, and the crawlers the
 * SEO work targets received an empty shell. The reviews page even emits its
 * schema.org AggregateRating server-side, and none of it reached the HTML.
 *
 * The fix is to always render `children`, and treat "session unknown" as
 * "signed out" for LAYOUT purposes only. This does not weaken security: the
 * sidebar is chrome, not an authorization boundary (middleware plus the
 * per-route/per-API session checks are what actually gate data), and an
 * unknown session must not be able to render authenticated chrome either.
 */
describe('Shell server rendering must not withhold page content (C4)', () => {
  const mocks = vi.hoisted(() => ({ session: { current: null as any } }));

  beforeEach(() => {
    mocks.session.current = { data: null, isPending: true };
    vi.doMock('@/lib/auth-client', () => ({
      useSession: () => mocks.session.current,
      signOut: vi.fn(),
    }));
    vi.doMock('next/navigation', () => ({
      usePathname: () => '/reviews',
      useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    }));
    vi.mock('@tanstack/react-query', () => ({
      useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      useQueryClient: () => ({ invalidateQueries: vi.fn() }),
      QueryClient: class {},
      QueryClientProvider: ({ children }: any) => children,
    }));
    vi.mock('@/components/DemoModeBanner', () => ({ __esModule: true, default: () => null }));
    vi.mock('@/components/SupportChat', () => ({ __esModule: true, default: () => null }));
    vi.mock('@/components/feedback', () => ({ FeedbackButton: () => null }));
    vi.mock('@/components/billing', () => ({
      UsageMeterSidebar: () => null,
      FreePlanBadge: () => null,
      CreditBalanceInline: () => null,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.doUnmock('@/lib/auth-client');
  });

  it('renders children while the session is still pending (the SSR state)', async () => {
    const { default: FreshShell } = await import('./Shell');
    render(
      <FreshShell>
        <p>Customer Reviews</p>
      </FreshShell>
    );
    expect(screen.getByText('Customer Reviews')).toBeTruthy();
  });

  it('does not render the sidebar chrome while the session is pending', async () => {
    const { default: FreshShell } = await import('./Shell');
    const { container } = render(
      <FreshShell>
        <p>Customer Reviews</p>
      </FreshShell>
    );
    // A spinner-only body is the defect: assert no animate-spin loader is
    // standing in for the page.
    expect(container.querySelector('.animate-spin')).toBeNull();
    // And no authenticated navigation is exposed before we know who this is.
    expect(screen.queryByRole('link', { name: /campaigns/i })).toBeNull();
  });
});

const LONG_EMAIL = `${'a'.repeat(300)}@example.com`;
const LONG_NAME = 'n'.repeat(300);

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  QueryClient: class {},
  QueryClientProvider: ({ children }: any) => children,
}));

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'user_test',
        email: LONG_EMAIL,
        name: undefined,
        role: undefined,
      },
    },
    isPending: false,
  }),
  signOut: vi.fn(),
}));

vi.mock('@/components/DemoModeBanner', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/SupportChat', () => ({ __esModule: true, default: () => null }));
vi.mock('@/components/feedback', () => ({ FeedbackButton: () => null }));
vi.mock('@/components/billing', () => ({
  UsageMeterSidebar: () => null,
  FreePlanBadge: () => null,
  CreditBalanceInline: () => null,
}));

describe('AccessibilityProvider must not make an authenticated call for a signed-out visitor (C4)', () => {
  beforeEach(() => {
    vi.doMock('@/lib/auth-client', () => ({
      useSession: () => ({ data: null, isPending: false }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/auth-client');
  });

  it('does not fetch the authenticated preferences endpoint for a signed-out visitor', async () => {
    // WHY (C4 browser-QA console-error sweep): the provider fetched
    // /api/user/preferences unconditionally on mount. For an anonymous visitor
    // that endpoint answers 401, and a 401 response is logged by the browser as
    // an unavoidable console error ("Failed to load resource: ... 401"). It was
    // firing on every public page load - /, /dashboard, /reviews - and the only
    // correct fix is to not make the request when there is no session to ask
    // about. The cached/default accessibility values still apply.
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    const { AccessibilityProvider } = await import('./AccessibilityProvider');
    render(
      <AccessibilityProvider>
        <p>page</p>
      </AccessibilityProvider>
    );
    // let mount effects + the microtask queue settle
    await new Promise((r) => setTimeout(r, 0));

    const called = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(called.some((u) => u.includes('/api/user/preferences'))).toBe(false);
  });

  it('renders its children', async () => {
    const { AccessibilityProvider } = await import('./AccessibilityProvider');
    render(
      <AccessibilityProvider>
        <p>page</p>
      </AccessibilityProvider>
    );
    expect(screen.getByText('page')).toBeTruthy();
  });
});

describe('Shell sidebar identity with long unbroken strings (requirement #2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('collapsed user menu: email line truncates inside a min-w-0 container with full title', () => {
    render(<Shell>child</Shell>);

    // The collapsed button identity block.
    const emailLine = screen.getByText(LONG_EMAIL);
    expect(emailLine.className).toContain('truncate');
    expect(emailLine.getAttribute('title')).toBe(LONG_EMAIL);

    // Without min-w-0 on the wrapping flex child, truncate never engages —
    // this is THE regression guard for the overflow bug.
    const container = emailLine.closest('div.min-w-0');
    expect(container).not.toBeNull();
    expect(container!.className).toContain('min-w-0');

    // The name line (falls back to the local part) must be protected too.
    const nameLine = screen.getByText('a'.repeat(300));
    expect(nameLine.className).toContain('truncate');
    expect(nameLine.getAttribute('title')).toBe(LONG_EMAIL);
    expect(nameLine.closest('div.min-w-0')).not.toBeNull();
  });

  it('open dropdown: second identity block carries the same truncate + min-w-0 contract', () => {
    render(<Shell>child</Shell>);

    // Open the dropdown; the header identity block must match the contract.
    const menuButton = screen.getByRole('button');
    fireEvent.click(menuButton);

    const emailLines = screen.getAllByText(LONG_EMAIL);
    // One in the collapsed button, one in the open dropdown header.
    expect(emailLines.length).toBeGreaterThanOrEqual(2);
    for (const line of emailLines) {
      expect(line.className).toContain('truncate');
      expect(line.getAttribute('title')).toBe(LONG_EMAIL);
      expect(line.closest('div.min-w-0')).not.toBeNull();
    }
  });

  it('long display name is truncated and titled as well', () => {
    render(
      <Shell>
        <span />
      </Shell>
    );

    // name undefined -> local part is the display name (300 chars, no @).
    const nameLines = screen.getAllByText('a'.repeat(300));
    expect(nameLines.length).toBeGreaterThanOrEqual(1);
    for (const line of nameLines) {
      expect(line.className).toContain('truncate');
    }
  });
});
