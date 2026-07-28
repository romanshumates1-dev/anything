/**
 * emailDriver — CAN-SPAM enforcement + the transmit hop.
 *
 * Email is the channel that can run TODAY (no carrier registration, no prior
 * consent). What it does require is composition duties the TCPA never imposed,
 * and each unmet duty is a statutory violation at up to $53,088 per message —
 * so canSpamGuard must make them structurally impossible, not merely
 * discouraged. These tests pin every duty, including the two that LOOK
 * compliant in code review and are not compliant in the inbox: an unsubscribe
 * URL or postal address present in the object but absent from the body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { dispatchGate } = vi.hoisted(() => ({
  dispatchGate: vi.fn(async () => ({ allow: true, timezones: [] }) as any),
}));
vi.mock('@/app/api/utils/dispatchGate', () => ({ dispatchGate }));

import { canSpamGuard, sendEmail, withCanSpamFooter, type EmailMessage } from '../emailDriver';

const UNSUB = 'https://dealflow.example/unsubscribe?t=abc';
const POSTAL = '123 Main St, Louisville, KY 40202';

const msg = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  to: 'buyer@example.com',
  subject: 'Cash offer on your property',
  body: `Hi there — interested in a cash offer?\n\nUnsubscribe: ${UNSUB}\n${POSTAL}`,
  unsubscribeUrl: UNSUB,
  postalAddress: POSTAL,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  dispatchGate.mockResolvedValue({ allow: true, timezones: [] });
  delete process.env.EMAIL_PROVIDER_URL;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMAIL_PROVIDER_URL;
});

describe('canSpamGuard — every duty is a hard refusal', () => {
  it('passes a fully compliant message', () => {
    expect(canSpamGuard(msg())).toEqual({ ok: true });
  });

  it('refuses a missing unsubscribe URL (7704(a)(3))', () => {
    const v = canSpamGuard(msg({ unsubscribeUrl: '' }));
    expect(v).toMatchObject({ ok: false });
    expect((v as any).reason).toMatch(/unsubscribe URL/i);
  });

  it('refuses a non-http unsubscribe URL', () => {
    const v = canSpamGuard(msg({ unsubscribeUrl: 'mailto:stop@x.com' }));
    expect((v as any).reason).toMatch(/must be http/i);
  });

  it('refuses when the unsubscribe URL is set but MISSING FROM THE BODY', () => {
    // Looks compliant in code review; is not compliant in the inbox.
    const v = canSpamGuard(msg({ body: 'Hi there, no footer here. ' + POSTAL }));
    expect((v as any).reason).toMatch(/not present in the body/);
  });

  it('refuses a missing postal address (7704(a)(5)(A)(iii))', () => {
    const v = canSpamGuard(msg({ postalAddress: '  ' }));
    expect((v as any).reason).toMatch(/physical postal address/i);
  });

  it('refuses when the postal address is set but MISSING FROM THE BODY', () => {
    const v = canSpamGuard(msg({ body: `Hi there.\nUnsubscribe: ${UNSUB}` }));
    expect((v as any).reason).toMatch(/postal address is not present in the body/);
  });

  it('refuses an absent subject (7704(a)(2))', () => {
    expect((canSpamGuard(msg({ subject: '   ' })) as any).reason).toMatch(/subject/i);
  });

  it('refuses an empty body', () => {
    expect((canSpamGuard(msg({ body: '' })) as any).reason).toMatch(/body/i);
  });

  it('refuses a malformed recipient address', () => {
    for (const bad of ['', 'not-an-email', 'a@b', 'a b@c.com']) {
      expect((canSpamGuard(msg({ to: bad })) as any).ok, `to=${bad}`).toBe(false);
    }
  });
});

describe('sendEmail — order of operations', () => {
  it('BLOCKS a non-compliant message before touching the gate or a provider', () => {
    return sendEmail(msg({ unsubscribeUrl: '' })).then((r) => {
      expect(r.status).toBe('blocked');
      expect((r as any).reason).toMatch(/^CAN-SPAM:/);
      expect(dispatchGate).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it('calls the gate on the EMAIL channel with the address as the key', async () => {
    await sendEmail(msg());
    expect(dispatchGate).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', email: 'buyer@example.com' })
    );
  });

  it('reports suppression when the gate denies (unsubscribed)', async () => {
    dispatchGate.mockResolvedValue({
      allow: false,
      code: 'DNC',
      reason: 'Recipient unsubscribed',
      timezones: [],
    });
    const r = await sendEmail(msg());
    expect(r).toMatchObject({ status: 'suppressed', gateCode: 'DNC' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendEmail — provider seam', () => {
  it('uses the MOCK path when EMAIL_PROVIDER_URL is unset, and says so', async () => {
    const r = await sendEmail(msg());
    expect(r).toEqual({ status: 'dispatched', provider: 'mock' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to the configured provider and returns its message id', async () => {
    process.env.EMAIL_PROVIDER_URL = 'https://provider.example/send';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: 'ses-123' }) });

    const r = await sendEmail(msg());
    expect(r).toEqual({ status: 'dispatched', provider: 'provider', providerId: 'ses-123' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://provider.example/send');
    expect(JSON.parse((init as any).body).to).toBe('buyer@example.com');
  });

  it('fails (not dispatched) on a provider non-2xx', async () => {
    process.env.EMAIL_PROVIDER_URL = 'https://provider.example/send';
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const r = await sendEmail(msg());
    expect(r.status).toBe('failed');
  });

  it('fails (not dispatched) on a network error', async () => {
    process.env.EMAIL_PROVIDER_URL = 'https://provider.example/send';
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const r = await sendEmail(msg());
    expect(r).toMatchObject({ status: 'failed', errorMessage: 'ETIMEDOUT' });
  });
});

describe('withCanSpamFooter', () => {
  it('makes a bare body pass the guard', () => {
    const body = withCanSpamFooter('Hi there — cash offer?', {
      unsubscribeUrl: UNSUB,
      postalAddress: POSTAL,
    });
    expect(canSpamGuard(msg({ body }))).toEqual({ ok: true });
  });

  it('is idempotent — does not duplicate an existing footer', () => {
    const once = withCanSpamFooter('Hi', { unsubscribeUrl: UNSUB, postalAddress: POSTAL });
    const twice = withCanSpamFooter(once, { unsubscribeUrl: UNSUB, postalAddress: POSTAL });
    expect(twice).toBe(once);
    expect(twice.match(new RegExp(UNSUB.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&'), 'g'))).toHaveLength(1);
  });

  it('adds only the missing half', () => {
    const body = withCanSpamFooter(`Hi ${POSTAL}`, {
      unsubscribeUrl: UNSUB,
      postalAddress: POSTAL,
    });
    expect(body).toContain(UNSUB);
    expect(body.match(new RegExp(POSTAL.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&'), 'g'))).toHaveLength(1);
  });
});
