/**
 * Security regression: the e-sign webhook must NOT accept forged "signed" events in
 * production when the deployment is running the mock provider.
 *
 * `MockEsignProvider.verifyWebhook()` returns `true` for ANY signature (documented in
 * esignProvider.ts), and the webhook selects the provider from `ESIGN_PROVIDER`, which
 * DEFAULTS to 'mock'. Without an explicit production guard, an unauthenticated attacker
 * could POST a crafted `signed` event for any contract id and drive the contract status
 * machine to SIGNED/COUNTERSIGNED.
 *
 * This mirrors the guard already applied to /api/payments/webhook (ALLOW_MOCK_PAYMENT_WEBHOOKS).
 * It was found by an adversarial route scan: `/api/esign/webhook` had no equivalent guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/app/api/utils/sql', () => ({ default: vi.fn().mockResolvedValue([]) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/services/esignProvider', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getEsignProvider: vi.fn() };
});
vi.mock('@/app/api/services/stripeProvider', () => ({
  getStripeProvider: vi.fn(() => ({ refundPayment: vi.fn() })),
}));
vi.mock('@/app/api/services/contractNotifications', () => ({
  onBuyerAssignmentSigned: vi.fn(),
  sendContractAlert: vi.fn(),
}));

import { getEsignProvider } from '@/app/api/services/esignProvider';
import { POST } from '@/app/api/esign/webhook/route';

const ORIGINAL_ENV = { ...process.env };

function signedEvent() {
  return JSON.stringify({
    event_type: 'signed',
    envelope_id: 'env_attacker',
    contract_id: 'contract_victim',
    event_id: 'evt_attacker_1',
    signed_at: new Date().toISOString(),
  });
}

function makeRequest(body: string) {
  return new Request('http://localhost/api/esign/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-esign-signature': 'totally-made-up' },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('esign webhook — forged-signature protection in production', () => {
  it('refuses to process a forged signed event in production when running the mock provider', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ESIGN_PROVIDER = 'mock';
    delete process.env.ALLOW_MOCK_ESIGN_WEBHOOKS;

    // The mock provider would happily verify anything — the guard must stop us first.
    vi.mocked(getEsignProvider).mockReturnValue({ verifyWebhook: () => true } as never);

    const res = await POST(makeRequest(signedEvent()));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it('refuses even when ESIGN_PROVIDER is UNSET (the dangerous default)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ESIGN_PROVIDER;
    delete process.env.ALLOW_MOCK_ESIGN_WEBHOOKS;

    vi.mocked(getEsignProvider).mockReturnValue({ verifyWebhook: () => true } as never);

    const res = await POST(makeRequest(signedEvent()));
    expect(res.status).toBe(503);
  });

  it('allows the mock provider in production ONLY when explicitly opted in', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ESIGN_PROVIDER = 'mock';
    process.env.ALLOW_MOCK_ESIGN_WEBHOOKS = '1';

    vi.mocked(getEsignProvider).mockReturnValue({ verifyWebhook: () => true } as never);

    const res = await POST(makeRequest(signedEvent()));
    // Passes the guard; then fails later on the contract lookup (mocked sql -> []).
    expect(res.status).not.toBe(503);
  });

  it('is NOT restricted outside production (dev workflow keeps working)', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ESIGN_PROVIDER = 'mock';
    delete process.env.ALLOW_MOCK_ESIGN_WEBHOOKS;

    vi.mocked(getEsignProvider).mockReturnValue({ verifyWebhook: () => true } as never);

    const res = await POST(makeRequest(signedEvent()));
    expect(res.status).not.toBe(503);
  });

  it('does not restrict a REAL provider in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ESIGN_PROVIDER = 'docusign';
    delete process.env.ALLOW_MOCK_ESIGN_WEBHOOKS;

    vi.mocked(getEsignProvider).mockReturnValue({ verifyWebhook: () => true } as never);

    const res = await POST(makeRequest(signedEvent()));
    expect(res.status).not.toBe(503);
  });
});
