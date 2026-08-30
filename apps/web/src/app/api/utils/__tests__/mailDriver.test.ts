/**
 * mailDriver — the registration-free seller channel.
 *
 * Two properties matter here:
 *  1. NO telephony rule may touch a mail send. Mail is not a call and not
 *     email; if a DNC listing or quiet hours blocked it, the one channel that
 *     works without A2P would be broken by rules that do not apply to it.
 *  2. The guard is a SPEND guard, not a compliance guard. Every piece costs
 *     ~55c, so an undeliverable address must fail before printing — at 10,000
 *     pieces a 5% bad-address rate is ~$275 burnt with no signal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { dispatchGate } = vi.hoisted(() => ({
  dispatchGate: vi.fn(async () => ({ allow: true, timezones: [] }) as any),
}));
vi.mock('@/app/api/utils/dispatchGate', () => ({ dispatchGate }));

import {
  mailAddressGuard,
  sendMail,
  estimateMailCampaign,
  DEFAULT_UNIT_COST_CENTS,
  type MailPiece,
} from '../mailDriver';

const GOOD = '123 Main St, Louisville, KY 40202';
const RETURN = 'DealFlow AI, 500 W Market St, Louisville, KY 40202';

const piece = (over: Partial<MailPiece> = {}): MailPiece => ({
  to: GOOD,
  body: 'We buy houses in your area. Interested in a cash offer?',
  returnAddress: RETURN,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  dispatchGate.mockResolvedValue({ allow: true, timezones: [] });
  delete process.env.MAIL_PROVIDER_URL;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MAIL_PROVIDER_URL;
});

describe('mailAddressGuard — a spend guard', () => {
  it('passes a complete address', () => {
    expect(mailAddressGuard(piece())).toEqual({ ok: true });
  });

  it('accepts ZIP+4', () => {
    expect(mailAddressGuard(piece({ to: '123 Main St, Louisville, KY 40202-1234' })).ok).toBe(true);
  });

  it('rejects an address with no ZIP', () => {
    const v = mailAddressGuard(piece({ to: '123 Main St, Louisville, KY' }));
    expect((v as any).reason).toMatch(/no ZIP/i);
  });

  it('rejects an address with no state', () => {
    const v = mailAddressGuard(piece({ to: '123 Main Street, Louisville 40202' }));
    expect((v as any).reason).toMatch(/state/i);
  });

  it('rejects a city/state/ZIP with no street number to deliver to', () => {
    const v = mailAddressGuard(piece({ to: 'Louisville, KY 40202' }));
    expect((v as any).reason).toMatch(/street\/box number/i);
  });

  it('rejects empty and stub addresses', () => {
    expect(mailAddressGuard(piece({ to: '' })).ok).toBe(false);
    expect(mailAddressGuard(piece({ to: 'KY 40202' })).ok).toBe(false);
  });

  it('requires body copy and a return address', () => {
    expect((mailAddressGuard(piece({ body: '  ' })) as any).reason).toMatch(/body/i);
    expect((mailAddressGuard(piece({ returnAddress: '' })) as any).reason).toMatch(/return address/i);
  });
});

describe('sendMail — order of operations', () => {
  it('BLOCKS an undeliverable piece before the gate or any provider spend', async () => {
    const r = await sendMail(piece({ to: 'Louisville, KY' }));
    expect(r.status).toBe('blocked');
    expect(dispatchGate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls the gate on the MAIL channel with the postal address as the key', async () => {
    await sendMail(piece());
    expect(dispatchGate).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'mail', mailingAddress: GOOD })
    );
  });

  it('reports suppression when the recipient opted out of mail', async () => {
    dispatchGate.mockResolvedValue({
      allow: false,
      code: 'DNC',
      reason: 'Recipient opted out of mail',
      timezones: [],
    });
    const r = await sendMail(piece());
    expect(r).toMatchObject({ status: 'suppressed', gateCode: 'DNC' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendMail — provider seam and cost', () => {
  it('uses the MOCK path when MAIL_PROVIDER_URL is unset, and still reports cost', async () => {
    // A dry run must produce a real budget number before money is committed.
    const r = await sendMail(piece());
    expect(r).toEqual({ status: 'dispatched', provider: 'mock', costCents: DEFAULT_UNIT_COST_CENTS });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honours an explicit unit cost', async () => {
    const r = await sendMail(piece({ unitCostCents: 70 }));
    expect((r as any).costCents).toBe(70);
  });

  it('POSTs to the configured provider and returns its id', async () => {
    process.env.MAIL_PROVIDER_URL = 'https://mail.example/send';
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'psc_123' }) });

    const r = await sendMail(piece());
    expect(r).toMatchObject({ status: 'dispatched', provider: 'provider', providerId: 'psc_123' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toBe(GOOD);
  });

  it('fails (never dispatched) on a provider non-2xx', async () => {
    process.env.MAIL_PROVIDER_URL = 'https://mail.example/send';
    fetchMock.mockResolvedValue({ ok: false, status: 402, json: async () => ({}) });
    expect((await sendMail(piece())).status).toBe('failed');
  });

  it('fails on a network error rather than reporting a send', async () => {
    process.env.MAIL_PROVIDER_URL = 'https://mail.example/send';
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    expect((await sendMail(piece())).status).toBe('failed');
  });
});

describe('estimateMailCampaign — see the bill before printing', () => {
  it('budgets only the MAILABLE pieces and surfaces the rest', () => {
    const pieces = [
      piece(),
      piece({ to: '9 Oak St, Louisville, KY 40203' }),
      piece({ to: 'Louisville, KY' }), // undeliverable
    ];
    const e = estimateMailCampaign(pieces, 55);
    expect(e.mailable).toBe(2);
    expect(e.undeliverable).toBe(1);
    expect(e.totalCostCents).toBe(110);
    expect(e.totalCostUsd).toBe(1.1);
  });

  it('prices a 10,000-piece campaign at the default unit cost', () => {
    const pieces = Array.from({ length: 10000 }, () => piece());
    const e = estimateMailCampaign(pieces);
    expect(e.mailable).toBe(10000);
    expect(e.totalCostUsd).toBe(5500); // 10,000 x 55c
  });

  it('costs nothing when every address is undeliverable', () => {
    const e = estimateMailCampaign([piece({ to: 'nowhere' })]);
    expect(e.mailable).toBe(0);
    expect(e.totalCostCents).toBe(0);
  });
});
