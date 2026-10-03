// @vitest-environment jsdom
/**
 * Requirement SET A — frontend half. See PLACEHOLDER_BODY.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import SupportChat from './SupportChat';

const flush = () => new Promise((r) => setTimeout(r, 0));

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('SupportChat frontend states (Set A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom implements no layout, so Element.prototype.scrollIntoView is
    // absent. Real browsers always have it; stubbing keeps the suite honest
    // about what it cannot measure (actual scrolling) without masking real
    // component errors.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('empty state: welcome message and quick actions are shown before any exchange', () => {
    render(<SupportChat />);
    fireEvent.click(screen.getByRole('button', { name: /open support chat/i }));

    expect(screen.getByText(/i'm the dealflow ai assistant/i)).toBeTruthy();
    expect(screen.getByText(/quick questions:/i)).toBeTruthy();
    // The set requires the human-escalation escape hatch to be visible.
    expect(screen.getByRole('button', { name: /talk to human/i })).toBeTruthy();
  });

  it('loading state: a "Thinking..." indicator appears while the request is in flight', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { release = res; })));

    render(<SupportChat />);
    fireEvent.click(screen.getByRole('button', { name: /open support chat/i }));
    fireEvent.change(screen.getByPlaceholderText(/type your message/i), {
      target: { value: 'How do campaigns work?' },
    });
    fireEvent.submit(screen.getByPlaceholderText(/type your message/i).closest('form')!);

    // The loading indicator must exist BEFORE the response resolves.
    expect(await screen.findByText(/thinking/i)).toBeTruthy();
    // Input and send are disabled while loading — a double-submit guard.
    expect((screen.getByPlaceholderText(/type your message/i) as HTMLInputElement).disabled).toBe(true);

    release(jsonResponse(200, { content: 'Campaigns send sequences.' }));
    await flush();
    await waitFor(() => expect(screen.queryByText(/thinking/i)).toBeNull());
    expect(screen.getByText('Campaigns send sequences.')).toBeTruthy();
  });

  it('error + retry: a 503 surfaces the API message and the user can send again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'Unable to process your message right now' }))
      .mockResolvedValueOnce(jsonResponse(200, { content: 'Recovered.' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SupportChat />);
    fireEvent.click(screen.getByRole('button', { name: /open support chat/i }));
    const input = screen.getByPlaceholderText(/type your message/i);

    fireEvent.change(input, { target: { value: 'first try' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(screen.getByText(/unable to process your message right now/i)).toBeTruthy(),
    );

    // RETRY: the input must be re-enabled and a second send must reach the API.
    const afterError = screen.getByPlaceholderText(/type your message/i) as HTMLInputElement;
    expect(afterError.disabled).toBe(false);
    fireEvent.change(afterError, { target: { value: 'second try' } });
    fireEvent.submit(afterError.closest('form')!);
    await waitFor(() => expect(screen.getByText('Recovered.')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rate limit (429): the API message is shown, not a generic failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(429, { error: 'AI limit reached for your plan' }))),
    );

    render(<SupportChat />);
    fireEvent.click(screen.getByRole('button', { name: /open support chat/i }));
    fireEvent.change(screen.getByPlaceholderText(/type your message/i), {
      target: { value: 'one more' },
    });
    fireEvent.submit(screen.getByPlaceholderText(/type your message/i).closest('form')!);

    await waitFor(() =>
      expect(screen.getByText(/ai limit reached for your plan/i)).toBeTruthy(),
    );
  });

  it('unauthorized (401): the user is told to sign in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(401, { error: 'Authentication required' }))),
    );

    render(<SupportChat />);
    fireEvent.click(screen.getByRole('button', { name: /open support chat/i }));
    fireEvent.change(screen.getByPlaceholderText(/type your message/i), {
      target: { value: 'hello' },
    });
    fireEvent.submit(screen.getByPlaceholderText(/type your message/i).closest('form')!);

    await waitFor(() =>
      expect(screen.getByText(/authentication required/i)).toBeTruthy(),
    );
  });

  it('escalation exposes the canonical support contact, not a hard-coded copy', async () => {
    const { SUPPORT_EMAIL, SUPPORT_PHONE } = await import('@/lib/contact');
    render(<SupportChat />);
    fireEvent.click(screen.getByRole('button', { name: /open support chat/i }));
    fireEvent.click(screen.getByRole('button', { name: /talk to human/i }));

    await waitFor(() => {
      expect(screen.getByText(new RegExp(SUPPORT_EMAIL, 'i'))).toBeTruthy();
      expect(
        screen.getByText(new RegExp(SUPPORT_PHONE.replace(/[()]/g, '\\$&'), 'i')),
      ).toBeTruthy();
    });
  });

  it('Escape closes the dialog (keyboard accessibility)', async () => {
    render(<SupportChat />);
    const trigger = screen.getByRole('button', { name: /open support chat/i });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /open support chat/i }).getAttribute('aria-expanded'),
      ).toBe('false'),
    );
  });
});
