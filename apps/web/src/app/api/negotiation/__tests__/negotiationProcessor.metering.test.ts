/**
 * AI CREDIT METERING FOR AUTOMATED NEGOTIATION.
 *
 * Negotiation runs as a BACKGROUND job on an inbound counter-offer. The
 * requirement is NOT "block when out of credits" - that would silently stop
 * negotiating and strand live deals, which is a worse outcome than a
 * deterministic answer. The requirement is: meter the provider call, and
 * degrade to the fallback that already exists for provider outages.
 *
 * That distinction is the whole design here, and it is what these tests pin:
 * an exhausted plan must produce a USABLE counter-offer, never a stalled job
 * and never an empty message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` factories are hoisted above these declarations, so every mock the
// factories reference must be created with `vi.hoisted` (the convention used
// across this repo) or the factory throws "Cannot access X before initialization"
// and the file silently collects ZERO tests.
const { mockSql, mockCallAI, mockAuthorizeAiRequest, mockRelease } = vi.hoisted(() => {
  const sql: any = vi.fn(async () => []);
  sql.transaction = vi.fn(async () => []);
  return {
    mockSql: sql,
    mockCallAI: vi.fn(),
    mockAuthorizeAiRequest: vi.fn(),
    mockRelease: vi.fn(),
  };
});

vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn: vi.fn(async () => false) }));
vi.mock('@/app/api/utils/pipelineOrchestrator', () => ({ createActionItem: vi.fn() }));

vi.mock('@/app/api/utils/ai-provider', () => ({
  callAI: (...a: unknown[]) => mockCallAI(...a),
}));

vi.mock('@/app/api/utils/aiCreditGate', () => ({
  authorizeAiRequest: (...a: unknown[]) => mockAuthorizeAiRequest(...a),
}));

import {
  extractPriceFromMessage,
  generateNegotiationProse,
} from '../../utils/negotiationProcessor';

function allowCredits() {
  mockAuthorizeAiRequest.mockResolvedValue({
    ok: true,
    bucket: 'included',
    caps: { monthly: 100, weekly: 25, daily: 5 },
    keys: {},
    release: mockRelease,
  });
}

function denyCredits(reason = 'no_credits') {
  mockAuthorizeAiRequest.mockResolvedValue({
    ok: false,
    reason,
    message: 'You have used all your AI credits for this period.',
    caps: { monthly: 0, weekly: 0, daily: 0 },
    keys: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRelease.mockResolvedValue(undefined);
  allowCredits();
});

describe('extractPriceFromMessage metering', () => {
  it('does not consult the gate when no organizationId is supplied', async () => {
    // Un-gated legacy callers keep their exact previous behaviour.
    const result = await extractPriceFromMessage('Can you do $250,000 for it?', 'seller');
    expect(mockAuthorizeAiRequest).not.toHaveBeenCalled();
    expect(result.hasPrice).toBe(true);
  });

  it('answers a clear price from the regex path without spending a credit', async () => {
    // The fast path runs BEFORE the gate: a parseable price needs no AI, so it
    // must not consume a credit even on an exhausted plan.
    denyCredits();
    const result = await extractPriceFromMessage('Can you do $250,000?', 'seller', 'org_1');

    expect(mockAuthorizeAiRequest).not.toHaveBeenCalled();
    expect(mockCallAI).not.toHaveBeenCalled();
    expect(result.hasPrice).toBe(true);
    expect(result.priceCents).toBe(250_000_00);
  });

  it('gates, and escalates for human review instead of calling the provider when denied', async () => {
    denyCredits();
    // No parseable price -> would otherwise have gone to the provider.
    const result = await extractPriceFromMessage(
      'maybe something in the low hundreds of thousands?',
      'seller',
      'org_1'
    );

    expect(mockAuthorizeAiRequest).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeAiRequest.mock.calls[0][0]).toBe('org_1');
    expect(mockCallAI).not.toHaveBeenCalled();
    expect(result.hasPrice).toBe(false);
    expect(result.needsEscalation).toBe(true);
    expect(result.escalationReason).toBe('ai_credits_exhausted');
  });

  it('spends a credit when allowed and the provider succeeds', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        hasPrice: true,
        priceCents: 275_000_00,
        priceText: '$275,000',
        confidence: 0.9,
        sentiment: 'countering',
        needsEscalation: false,
      }),
      model: 'stub',
    });

    const result = await extractPriceFromMessage('some vague wording', 'seller', 'org_1');

    expect(mockAuthorizeAiRequest).toHaveBeenCalledTimes(1);
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(result.priceCents).toBe(275_000_00);
    // A successful provider call genuinely consumed the credit.
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('refunds the credit when the provider fails', async () => {
    mockCallAI.mockRejectedValue(new Error('provider 500'));

    const result = await extractPriceFromMessage('vague', 'seller', 'org_1');

    expect(result.hasPrice).toBe(false);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an accounting error rather than spending unmetered', async () => {
    denyCredits('accounting_error');
    const result = await extractPriceFromMessage('vague wording', 'seller', 'org_1');

    expect(mockCallAI).not.toHaveBeenCalled();
    expect(result.needsEscalation).toBe(true);
  });
});

describe('generateNegotiationProse metering', () => {
  const gen = (org?: string) =>
    generateNegotiationProse('seller', 250_000_00, 200_000_00, 250_000_00, 2, 'balanced', org);

  it('returns a usable counter-offer when gated + denied, never an empty string', async () => {
    denyCredits();
    const prose = await gen('org_1');

    expect(mockCallAI).not.toHaveBeenCalled();
    // The counter must remain sendable: real text plus the offer slot the
    // downstream injector depends on.
    expect(prose.length).toBeGreaterThan(0);
    expect(prose).toContain('{OFFER}');
  });

  it('refunds the credit when the provider fails', async () => {
    mockCallAI.mockRejectedValue(new Error('provider 500'));

    const prose = await gen('org_1');

    expect(prose).toContain('{OFFER}');
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('does not refund on success', async () => {
    mockCallAI.mockResolvedValue({ text: 'Sounds fair, {OFFER} works for us.', model: 'stub' });

    const prose = await gen('org_1');

    expect(prose).toContain('{OFFER}');
    expect(mockRelease).not.toHaveBeenCalled();
  });
});
