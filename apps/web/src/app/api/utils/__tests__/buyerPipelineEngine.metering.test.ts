/**
 * AI CREDIT METERING FOR UNATTENDED AUTOMATION.
 *
 * `classifyBuyerResponse` runs on every inbound buyer reply with no human in
 * the loop. The requirement is the same one that drove the negotiation fix:
 * meter the provider call, but never let exhausted credits break automation.
 *
 * The failure that must not happen: a buyer replies "interested, what can you
 * offer?" and an exhausted plan causes them to be staged COOL/LOST instead of
 * HOT. That is a real lost deal, and it is worse than the provider cost.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('@/app/api/utils/emailProviders', () => ({ sendEmailAuto: vi.fn() }));
vi.mock('@/app/api/utils/smsOutreachEngine', () => ({ sendPipelineSMS: vi.fn() }));

vi.mock('@/app/api/utils/ai-provider', () => ({
  callAI: (...a: unknown[]) => mockCallAI(...a),
}));
vi.mock('@/app/api/utils/aiCreditGate', () => ({
  authorizeAiRequest: (...a: unknown[]) => mockAuthorizeAiRequest(...a),
}));

import { classifyBuyerResponse } from '../buyerPipelineEngine';

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

describe('classifyBuyerResponse metering', () => {
  it('is ungated when no organizationId is supplied (legacy callers unchanged)', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        interestLevel: 'HOT',
        buyerType: 'cash',
        timeline: 'immediate',
        priceRange: null,
        propertyTypes: [],
        nextAction: 'Send details',
        confidence: 0.9,
      }),
      model: 'stub',
    });

    const result = await classifyBuyerResponse('I am interested, send details');

    expect(mockAuthorizeAiRequest).not.toHaveBeenCalled();
    expect(result.interestLevel).toBe('HOT');
  });

  it('charges the supplied organization and never calls the provider when denied', async () => {
    denyCredits();

    const result = await classifyBuyerResponse('What can you offer for this?', undefined, 'org_1');

    expect(mockAuthorizeAiRequest).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeAiRequest.mock.calls[0][0]).toBe('org_1');
    expect(mockCallAI).not.toHaveBeenCalled();
    // Still a usable classification - the keyword fallback ran.
    expect(result).toBeTruthy();
    expect(result.interestLevel).toBeTruthy();
    expect(typeof result.nextAction).toBe('string');
  });

  it('fails closed on an accounting error rather than spending unmetered', async () => {
    denyCredits('accounting_error');

    const result = await classifyBuyerResponse('send me the contract', undefined, 'org_1');

    expect(mockCallAI).not.toHaveBeenCalled();
    expect(result.interestLevel).toBeTruthy();
  });

  it('spends a credit when allowed and the provider succeeds', async () => {
    mockCallAI.mockResolvedValue({
      text: JSON.stringify({
        interestLevel: 'HOT',
        buyerType: 'cash',
        timeline: 'immediate',
        priceRange: null,
        propertyTypes: ['SFR'],
        nextAction: 'Send the assignment contract',
        confidence: 0.92,
      }),
      model: 'stub',
    });

    const result = await classifyBuyerResponse('ready to move', undefined, 'org_1');

    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(result.interestLevel).toBe('HOT');
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('refunds the credit when the provider fails', async () => {
    mockCallAI.mockRejectedValue(new Error('provider 500'));

    const result = await classifyBuyerResponse('is this still available?', undefined, 'org_1');

    expect(result).toBeTruthy();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('still stages an obviously-interested buyer as HOT without spending a credit', async () => {
    // This is the regression that matters commercially: an exhausted plan must
    // not lose a ready buyer. The keyword fallback has to carry it.
    denyCredits();

    const result = await classifyBuyerResponse(
      'I want to buy this property now, send the contract',
      undefined,
      'org_1'
    );

    expect(mockCallAI).not.toHaveBeenCalled();
    expect(result.interestLevel).toBe('HOT');
  });
});