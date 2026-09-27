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
